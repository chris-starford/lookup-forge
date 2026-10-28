// Splunk through a Stream worker that can reach it (for example a hybrid worker on a private network).
//
// The App cannot reach a Splunk on a laptop, but a worker running next to it can. The App reads a saved REST
// Collector (the template), fills in the search and two fields, and starts a one-off run. The collector calls
// Splunk's export API; the splunk_lookup_staging pipeline turns each result into a staging event carrying
// splunk_lookup and sync_id; the events reach the Lake dataset; the App reads the rows for that sync_id.

import { getSavedCollector, kvGet, kvPut, startCollectorJob } from './cribl';
import { splunkSearchString } from './splunk';
import { runSearch, stripStagingMeta, unpackJsonRaw } from './sources';
import type { Row, Settings, SplunkWorkerSource, WorkerRequest } from './types';
import type { SplunkLookupInfo } from './splunk';

export const CATALOG_KEY = '__lookup_catalog__';

export class PendingError extends Error {}

/** The splunk_lookup value rows for this source are tagged with. */
export function workerStagingKey(source: SplunkWorkerSource, defName: string): string {
  return source.mode === 'spl' ? `spl_${defName}` : source.splunkLookup.trim();
}

export function workerSearch(source: SplunkWorkerSource): string {
  if (source.mode === 'spl') return splunkSearchString(source.spl ?? '');
  return source.splunkLookup.trim() ? `| inputlookup ${source.splunkLookup.trim()}` : '';
}

export const CATALOG_SEARCH =
  '| rest splunk_server=local /servicesNS/-/-/data/lookup-table-files | eval kind="file" | fields title eai:acl.app eai:acl.owner eai:acl.sharing kind' +
  ' | append [| rest splunk_server=local /servicesNS/-/-/data/transforms/lookups | eval kind="definition" | fields title eai:acl.app eai:acl.owner eai:acl.sharing kind collection filename]';

const jsLiteral = (v: string) => JSON.stringify(v); // collector values are JavaScript expressions

/** Set a {name, value} entry in an array, adding it if missing. */
function setNamed(arr: any[], name: string, value: string) {
  const hit = arr.find((x) => x && x.name === name);
  if (hit) hit.value = value;
  else arr.push({ name, value });
}

/** Find every array of {name, value} objects in the collector config that has a "search" entry. */
function findParamArrays(node: any, out: any[][] = []): any[][] {
  if (Array.isArray(node)) {
    if (node.some((x) => x && typeof x === 'object' && x.name === 'search' && 'value' in x)) out.push(node);
    node.forEach((x) => findParamArrays(x, out));
  } else if (node && typeof node === 'object') Object.values(node).forEach((v) => findParamArrays(v, out));
  return out;
}

/** Copy the template and fill in this request. Throws when the template has no "search" request parameter. */
export function patchCollector(template: Record<string, any>, req: { search: string; stagingKey: string; syncId: string; earliest?: string; latest?: string }) {
  const cfg = structuredClone(template);
  const paramArrays = findParamArrays(cfg.collector);
  if (!paramArrays.length) {
    throw new Error('The collector template has no "search" request parameter. Add one (for example search = \'| inputlookup cmdb_assets.csv\') as described in docs/SPLUNK_SYNC.md, Part 2.');
  }
  for (const arr of paramArrays) {
    setNamed(arr, 'search', jsLiteral(req.search));
    if (req.earliest) setNamed(arr, 'earliest_time', jsLiteral(req.earliest));
    if (req.latest) setNamed(arr, 'latest_time', jsLiteral(req.latest));
  }
  cfg.input = cfg.input ?? {};
  cfg.input.metadata = Array.isArray(cfg.input.metadata) ? cfg.input.metadata : [];
  setNamed(cfg.input.metadata, 'splunk_lookup', jsLiteral(req.stagingKey));
  setNamed(cfg.input.metadata, 'sync_id', jsLiteral(req.syncId));
  delete cfg.schedule; // one-off run
  cfg.run = { logLevel: 'info', expression: 'true', jobTimeout: '0', ...(cfg.run ?? {}), mode: 'run' };
  return cfg;
}

export const newSyncId = () => `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-w${Math.random().toString(16).slice(2, 6)}`;

/** Start a run for one source. Returns the request to remember. */
export async function requestWorkerSync(source: SplunkWorkerSource, defName: string): Promise<WorkerRequest> {
  if (!source.group) throw new Error('Choose the Worker Group whose workers can reach Splunk.');
  if (!source.collectorId) throw new Error('Enter the collector template ID (see the README).');
  const search = workerSearch(source);
  if (!search) throw new Error(source.mode === 'spl' ? 'Enter a Splunk search.' : 'Enter or choose a Splunk lookup.');
  const template = await getSavedCollector(source.group, source.collectorId);
  const syncId = newSyncId();
  const cfg = patchCollector(template, {
    search,
    stagingKey: workerStagingKey(source, defName),
    syncId,
    earliest: source.mode === 'spl' ? source.earliest || '-24h' : undefined,
    latest: source.mode === 'spl' ? source.latest || 'now' : undefined,
  });
  const jobId = await startCollectorJob(source.group, cfg);
  return { syncId, jobId, requestedAt: Date.now() };
}

/** Rows of one request, once Lake has them. Throws PendingError while they are still on their way. */
export async function readWorkerRows(source: SplunkWorkerSource, defName: string, req: WorkerRequest | undefined, settings: Settings, onProgress?: (m: string) => void): Promise<Row[]> {
  if (!req) throw new PendingError('No data has been requested from Splunk yet. Use "Request from Splunk now", then preview again in 5–20 minutes.');
  const key = workerStagingKey(source, defName);
  const q = `dataset="${source.dataset || settings.splunkStagingDataset}" splunk_lookup="${key}" sync_id="${req.syncId}"`;
  const rows = await runSearch(q, '-7d', 'now', { settings, maxRows: 100_000, onProgress });
  if (!rows.length) {
    const mins = Math.max(0, Math.round((Date.now() - req.requestedAt) / 60000));
    throw new PendingError(`Requested from Splunk ${mins} minute(s) ago (sync ${req.syncId}); the rows have not reached Lake yet. Lake usually takes 5–20 minutes. If nothing arrives after 30 minutes, check the collector's job in ${source.group} (Monitoring > Job Inspector).`);
  }
  onProgress?.(`Using sync ${req.syncId}: ${rows.length} row(s).`);
  return stripStagingMeta(rows.map(unpackJsonRaw));
}

// ---- lookup list (catalog) through the worker
const catalogKvKey = (group: string) => `lm-catalog-${group}`;

export async function requestCatalog(group: string, collectorId: string): Promise<WorkerRequest> {
  if (!group) throw new Error('Choose the Worker Group whose workers can reach Splunk.');
  const template = await getSavedCollector(group, collectorId);
  const syncId = newSyncId();
  const jobId = await startCollectorJob(group, patchCollector(template, { search: CATALOG_SEARCH, stagingKey: CATALOG_KEY, syncId }));
  const req = { syncId, jobId, requestedAt: Date.now() };
  await kvPut(catalogKvKey(group), JSON.stringify(req));
  return req;
}

export async function lastCatalogRequest(group: string): Promise<WorkerRequest | undefined> {
  const raw = await kvGet(catalogKvKey(group));
  return raw ? (JSON.parse(raw) as WorkerRequest) : undefined;
}

export async function readCatalog(group: string, dataset: string, settings: Settings): Promise<SplunkLookupInfo[]> {
  const req = await lastCatalogRequest(group);
  const rows = await readWorkerRows(
    { type: 'splunk_worker', group, collectorId: '', dataset, mode: 'lookup', splunkLookup: CATALOG_KEY },
    '',
    req,
    settings,
  );
  return rows
    .map((r) => ({
      name: String(r.title ?? ''),
      kind: (String(r.kind) === 'definition' ? 'definition' : 'file') as 'file' | 'definition',
      app: r['eai:acl.app'] as string | undefined,
      owner: r['eai:acl.owner'] as string | undefined,
      sharing: r['eai:acl.sharing'] as string | undefined,
      detail: r.collection ? `KV store: ${r.collection}` : r.filename ? `file: ${r.filename}` : undefined,
    }))
    .filter((l) => l.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}
