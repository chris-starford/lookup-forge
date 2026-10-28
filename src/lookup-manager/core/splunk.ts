// Splunk REST helpers for the direct route (Splunk reachable from Cribl.Cloud through the App proxy).
// The Splunk host must be declared in config/proxies.yml or authorized under App Settings > External API Access,
// with the token injected by the proxy (headers.inject + an encrypted KV entry). App code never sends credentials.

import type { Row, SplunkRestSource } from './types';

export interface SplunkLookupInfo {
  name: string;
  kind: 'file' | 'definition';
  app?: string;
  owner?: string;
  sharing?: string;
  /** For definitions: the CSV file or KV-store collection behind it. */
  detail?: string;
}

const trimBase = (u: string) => u.replace(/\/+$/, '');

/** Splunk's export endpoint needs a generating command or an explicit "search". */
export function splunkSearchString(q: string): string {
  const t = q.trim();
  if (!t) return '';
  return t.startsWith('|') || /^search\s/i.test(t) ? t : `search ${t}`;
}

export function splunkSearchFor(source: SplunkRestSource): string {
  return (source.mode ?? 'lookup') === 'spl' ? splunkSearchString(source.spl ?? '') : source.splunkLookup.trim() ? `| inputlookup ${source.splunkLookup.trim()}` : '';
}

function httpHint(status: number): string {
  if (status === 401) return ' Splunk rejected the credentials: check the token injected for this host.';
  if (status === 403) return ' The host or path may not be authorized for this App (App Settings > External API Access), or the token lacks permission.';
  return '';
}

/** Run a search through Splunk's export endpoint and return the result rows. */
export async function runSplunkSearch(source: SplunkRestSource, onProgress?: (m: string) => void): Promise<Row[]> {
  const search = splunkSearchFor(source);
  if (!search) throw new Error((source.mode ?? 'lookup') === 'spl' ? 'Enter a Splunk search.' : 'Enter or browse for a Splunk lookup.');
  const params = new URLSearchParams({ search, output_mode: 'json' });
  if ((source.mode ?? 'lookup') === 'spl') {
    params.set('earliest_time', source.earliest || '-24h');
    params.set('latest_time', source.latest || 'now');
  }
  onProgress?.(`Running in Splunk: ${search.length > 120 ? search.slice(0, 117) + '...' : search}`);
  const res = await fetch(`${trimBase(source.baseUrl)}/services/search/v2/jobs/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Splunk returned HTTP ${res.status}.${httpHint(res.status)}`);
  const rows: Row[] = [];
  const problems: string[] = [];
  for (const line of (await res.text()).split('\n')) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (Array.isArray(o?.messages)) {
      for (const m of o.messages) if (m?.type === 'FATAL' || m?.type === 'ERROR') problems.push(String(m.text ?? m.type));
    }
    if (o?.result && o.preview !== true) rows.push(o.result as Row);
  }
  if (rows.length === 0 && problems.length) throw new Error(`Splunk: ${problems.join('; ')}`);
  problems.forEach((p) => onProgress?.(`Splunk message: ${p}`));
  onProgress?.(`Splunk returned ${rows.length} row(s).`);
  return rows;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Splunk returned HTTP ${res.status}.${httpHint(res.status)}`);
  return res.json();
}

/** List lookup files and lookup definitions visible to the token, across all apps. */
export async function listSplunkLookups(baseUrl: string): Promise<SplunkLookupInfo[]> {
  const base = trimBase(baseUrl);
  const files = await getJson(`${base}/servicesNS/-/-/data/lookup-table-files?output_mode=json&count=0`);
  const out: SplunkLookupInfo[] = (files?.entry ?? []).map((e: any) => ({
    name: String(e.name),
    kind: 'file' as const,
    app: e.acl?.app,
    owner: e.acl?.owner,
    sharing: e.acl?.sharing,
  }));
  try {
    const defs = await getJson(`${base}/servicesNS/-/-/data/transforms/lookups?output_mode=json&count=0`);
    for (const e of defs?.entry ?? []) {
      const c = e.content ?? {};
      out.push({
        name: String(e.name),
        kind: 'definition',
        app: e.acl?.app,
        owner: e.acl?.owner,
        sharing: e.acl?.sharing,
        detail: c.collection ? `KV store: ${c.collection}` : c.filename ? `file: ${c.filename}` : c.external_type || undefined,
      });
    }
  } catch {
    /* definitions are optional; files are enough to continue */
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
