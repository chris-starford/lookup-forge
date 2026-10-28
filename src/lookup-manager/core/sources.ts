// Read raw rows from each kind of source.

import { parseCsv } from './csv';
import { searchResultsPage, searchStatus, startSearch } from './cribl';
import { runSplunkSearch } from './splunk';
import { getPath } from './transform';
import type { Row, Settings, SourceConfig } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Lake stores many events as a JSON object in _raw (for example rows sent through HEC). The Search UI unpacks
 * that automatically, but API results may not, so unpack it here. Fields already present on the event win.
 */
export function unpackJsonRaw(row: Row): Row {
  const raw = row._raw;
  if (typeof raw !== 'string') return row;
  const t = raw.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return row;
  try {
    const parsed = JSON.parse(t);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return row;
    const out: Row = { ...(parsed as Row) };
    for (const [k, v] of Object.entries(row)) if (v !== undefined && v !== null && v !== '') out[k] = v;
    return out;
  } catch {
    return row;
  }
}

export interface ReadOptions {
  settings: Settings;
  /** Stop reading after this many rows (the caller validates the limit). */
  maxRows: number;
  /** Give up waiting for a search job after this many milliseconds. */
  searchTimeoutMs?: number;
  onProgress?: (msg: string) => void;
}

/** Run a Cribl Search query to completion and return its events. */
export async function runSearch(query: string, earliest: string, latest: string, opts: ReadOptions): Promise<Row[]> {
  const group = opts.settings.searchGroup;
  const jobId = await startSearch(group, query, earliest, latest);
  opts.onProgress?.(`Search job ${jobId} started.`);
  const deadline = Date.now() + (opts.searchTimeoutMs ?? 5 * 60_000);
  let status = 'queued';
  let delay = 1000;
  while (Date.now() < deadline) {
    status = await searchStatus(group, jobId);
    if (status === 'completed') break;
    if (status === 'failed' || status === 'canceled') throw new Error(`Search job ${jobId} ${status}.`);
    await sleep(delay);
    delay = Math.min(delay * 1.5, 5000);
  }
  if (status !== 'completed') throw new Error(`Search job ${jobId} did not finish in time (last status: ${status}).`);

  const pageSize = 1000;
  const rows: Row[] = [];
  for (let offset = 0; rows.length <= opts.maxRows; offset += pageSize) {
    const { meta, events } = await searchResultsPage(group, jobId, pageSize, offset);
    rows.push(...events.map(unpackJsonRaw));
    const total = typeof meta.totalEventCount === 'number' ? meta.totalEventCount : undefined;
    if (events.length < pageSize || (total !== undefined && offset + pageSize >= total)) break;
  }
  opts.onProgress?.(`Search returned ${rows.length} row(s).`);
  return rows;
}

function parseBody(text: string, format: 'json' | 'ndjson' | 'csv', dataPath?: string): Row[] {
  if (format === 'csv') return parseCsv(text);
  if (format === 'ndjson') {
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  }
  const parsed = JSON.parse(text);
  const data = dataPath ? getPath(parsed, dataPath) : parsed;
  if (!Array.isArray(data)) {
    throw new Error(dataPath ? `"${dataPath}" in the response is not a list of records.` : 'The response is not a list. Set "Records path" to the field that holds the list.');
  }
  return data as Row[];
}

/** Keep only the newest sync: the newest sync_id when rows carry one, otherwise the newest collection run by time. */
export function selectLatestSync(rows: Row[], onProgress?: (m: string) => void): Row[] {
  const withSync = rows.filter((r) => r.sync_id !== undefined && r.sync_id !== '');
  if (withSync.length > 0) {
    const latest = withSync.reduce((m, r) => (String(r.sync_id) > m ? String(r.sync_id) : m), '');
    const current = withSync.filter((r) => String(r.sync_id) === latest);
    onProgress?.(`Using sync ${latest}: ${current.length} row(s).`);
    return current;
  }
  const t = (r: Row) => Number(r._time ?? r.event_time ?? 0);
  const newest = Math.max(...rows.map(t));
  const current = rows.filter((r) => t(r) >= newest - STAGING_WINDOW_S);
  onProgress?.(`Using the most recent collection (${current.length} row(s) within ${STAGING_WINDOW_S / 60} min of ${new Date(newest * 1000).toISOString()}).`);
  return current;
}

export function stripStagingMeta(rows: Row[]): Row[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_') && !STAGING_META.has(k))));
}

/** Rows from one collector run arrive within seconds; 5 minutes leaves a wide margin. */
const STAGING_WINDOW_S = 300;
const STAGING_META = new Set(['dataset', 'datatype', 'source', 'host', 'sourcetype', 'splunk_lookup', 'sync_id', 'index', 'cribl_pipe', 'raw_json', 'event_time']);

export async function readSource(source: SourceConfig, opts: ReadOptions): Promise<Row[]> {
  switch (source.type) {
    case 'csv': {
      const fmt = source.format ?? 'csv';
      const rows = fmt === 'tsv' ? parseCsv(source.content, '\t') : fmt === 'csv' ? parseCsv(source.content) : parseBody(source.content, fmt);
      opts.onProgress?.(`${source.fileName ?? 'Content'}: ${rows.length} row(s) (${fmt.toUpperCase()}).`);
      return rows;
    }

    case 'search':
      return runSearch(source.query, source.earliest || '-24h', source.latest || 'now', opts);

    case 'http': {
      // Full URLs go through the App's server-side proxy. The host must be declared in proxies.yml
      // or authorized by an administrator under App Settings > External API Access.
      const res = await fetch(source.url, {
        method: source.method,
        headers: source.body ? { 'Content-Type': 'application/json' } : undefined,
        body: source.method === 'POST' ? source.body : undefined,
      });
      if (!res.ok) {
        const hint = res.status === 403 ? ' The host may not be authorized for this App (see App Settings > External API Access).' : '';
        throw new Error(`HTTP ${res.status} from ${new URL(source.url).host}.${hint}`);
      }
      const rows = parseBody(await res.text(), source.format, source.dataPath);
      opts.onProgress?.(`HTTP source returned ${rows.length} row(s).`);
      return rows;
    }

    case 'splunk_staging': {
      // Rows staged in a Lake dataset by a REST Collector on a worker near Splunk, or by an agent using Splunk MCP.
      // Agent syncs carry a sync_id: use the newest one. Collector syncs do not: use the newest run,
      // meaning every row within STAGING_WINDOW_S seconds of the most recent row.
      const dataset = source.dataset || opts.settings.splunkStagingDataset;
      const q = `dataset="${dataset}" splunk_lookup="${source.splunkLookup}"`;
      const rows = await runSearch(q, source.earliest || '-24h', 'now', { ...opts, maxRows: opts.maxRows * 5 });
      if (rows.length === 0) throw new Error(`No rows for Splunk lookup "${source.splunkLookup}" in dataset "${dataset}". Has the collector or agent sync run?`);
      const current = selectLatestSync(rows, opts.onProgress);
      return stripStagingMeta(current);
    }

    case 'splunk_rest':
      return runSplunkSearch(source, opts.onProgress);

    case 'splunk_worker':
      throw new Error('Splunk-through-worker sources are read by the runner, which knows the latest request.');
  }
}
