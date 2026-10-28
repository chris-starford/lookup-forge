// Every Cribl API call the App makes lives in this file.
// Paths follow the Cribl API docs (Create and Update Lookups, Commit and Deploy, Search and Retrieve Results).
// If an endpoint behaves differently in your Workspace, fix it here and update config/policies.yml to match.

// UI code runs in the sandboxed iframe, where only fetches to window.CRIBL_API_URL are proxied to Cribl
// (auth injected, /kvstore scoped to this App). Backend functions have no window and use relative paths.
// Resolved per call in case CRIBL_API_URL is injected after this module loads.
let loggedBase = false;
function apiBase(): string {
  const injected =
    typeof window !== 'undefined' ? (window as unknown as { CRIBL_API_URL?: string }).CRIBL_API_URL : undefined;
  const base = (injected || '/api/v1').replace(/\/+$/, '');
  if (!loggedBase && typeof window !== 'undefined') {
    loggedBase = true;
    console.info('[lookup-manager] API base:', base);
  }
  return base;
}

export class CriblApiError extends Error {
  status: number;
  path: string;
  body: string;
  constructor(status: number, path: string, body: string) {
    super(`Cribl API ${status} on ${path}: ${body.slice(0, 300)}`);
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${apiBase()}${path}`, init);
  if (!res.ok) throw new CriblApiError(res.status, path, await res.text().catch(() => ''));
  return res;
}

async function json<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await call(path, init);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

const enc = encodeURIComponent;
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Many Cribl responses wrap results in { items: [...] }. */
function first<T = any>(r: any): T {
  return (r && Array.isArray(r.items) ? r.items[0] : r) as T;
}

// ---------------------------------------------------------------- Worker Groups

export interface GroupInfo {
  id: string;
  type?: string;
  isSearch?: boolean;
  isFleet?: boolean;
  onPrem?: boolean;
  workerCount?: number;
  configVersion?: string;
  description?: string;
}

export async function listStreamGroups(): Promise<GroupInfo[]> {
  const r = await json<{ items: GroupInfo[] }>('/master/groups');
  return (r.items ?? []).filter((g) => !g.isSearch && !g.isFleet && (g.type === undefined || g.type === 'stream'));
}

/** Number of uncommitted changes in a group, or undefined when the API does not report it.
 *  A plain `fields=git` returns no git block in Cribl.Cloud, so try the specific field names. */
const PENDING_FIELD_FORMS = ['git.commit,git.localChanges,git.log', 'git.localChanges', 'git'];

export async function getPendingChanges(group: string): Promise<number | undefined> {
  for (const fields of PENDING_FIELD_FORMS) {
    try {
      const r = first<any>(await json(`/master/groups/${enc(group)}?fields=${enc(fields)}`));
      const n = r?.git?.localChanges;
      if (typeof n === 'number') return n;
    } catch {
      /* try the next form */
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- Lookups (Stream groups, and Search when supported)

export interface LookupInfo {
  id: string;
  size?: number;
  rows?: number;
  mode?: string;
  description?: string;
  version?: string;
}

export async function listLookups(group: string): Promise<LookupInfo[]> {
  const r = await json<{ items: LookupInfo[] }>(`/m/${enc(group)}/system/lookups`);
  return r.items ?? [];
}

/** Step 1: upload the CSV. Returns the temporary file name to reference when creating or replacing the lookup. */
export async function uploadLookupFile(group: string, fileName: string, csv: string): Promise<string> {
  const r = await json<{ filename: string }>(`/m/${enc(group)}/system/lookups?filename=${enc(fileName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/csv' },
    body: csv,
  });
  const tmp = first<{ filename: string }>(r)?.filename;
  if (!tmp) throw new Error(`Upload of ${fileName} to ${group} did not return a file name.`);
  return tmp;
}

export async function createLookup(group: string, id: string, tmpFile: string, description: string, mode: 'memory' | 'disk') {
  const body: Record<string, unknown> = { id, fileInfo: { filename: tmpFile }, description };
  if (mode === 'disk') body.mode = 'disk';
  return json(`/m/${enc(group)}/system/lookups`, jsonInit('POST', body));
}

export async function replaceLookup(group: string, id: string, tmpFile: string, description: string, mode: 'memory' | 'disk') {
  const body: Record<string, unknown> = { id, fileInfo: { filename: tmpFile }, description };
  if (mode === 'disk') body.mode = 'disk';
  return json(`/m/${enc(group)}/system/lookups/${enc(id)}`, jsonInit('PATCH', body));
}

export async function deleteLookup(group: string, id: string): Promise<void> {
  await call(`/m/${enc(group)}/system/lookups/${enc(id)}`, { method: 'DELETE' });
}

export async function getLookupContent(group: string, id: string): Promise<string> {
  const res = await call(`/m/${enc(group)}/system/lookups/${enc(id)}/content?raw=1`);
  return res.text();
}

// ---------------------------------------------------------------- Commit and deploy

export interface CommitResult {
  id: string;
  /** Every file the commit created or modified, as reported by Cribl. */
  files: string[];
}

/**
 * Commits changes for one group. Pass `files` to commit only those paths (selective commit);
 * without it, every pending change in the group is committed.
 */
export async function commitGroup(group: string, message: string, files?: string[]): Promise<CommitResult> {
  const body: Record<string, unknown> = { message, group };
  if (files && files.length) body.files = files;
  const r = first<any>(await json('/version/commit', jsonInit('POST', body)));
  const id = r?.commit ?? r?.commitId;
  if (!id) throw new Error(`Commit for ${group} did not return a commit ID.`);
  const f = r?.files ?? {};
  const list = [...(f.created ?? []), ...(f.modified ?? []), ...(f.deleted ?? [])].map(String);
  return { id, files: list };
}

export async function deployGroup(group: string, version: string) {
  return json(`/master/groups/${enc(group)}/deploy`, jsonInit('PATCH', { version }));
}

// ---------------------------------------------------------------- Cribl Search jobs

/** The Search API needs a single-line query that starts with the `cribl` operator. */
export function normalizeSearchQuery(q: string): string {
  const flat = q
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .join(' ');
  if (/^(cribl\s|\$|externaldata\b|print\b|range\b|let\b|set\b)/i.test(flat)) return flat;
  return `cribl ${flat}`;
}

export async function startSearch(searchGroup: string, query: string, earliest: string, latest: string): Promise<string> {
  const r = first<{ id: string }>(
    await json(`/m/${enc(searchGroup)}/search/jobs`, jsonInit('POST', { query: normalizeSearchQuery(query), earliest, latest, sampleRate: 1 })),
  );
  if (!r?.id) throw new Error('Cribl Search did not return a job ID.');
  return r.id;
}

export async function searchStatus(searchGroup: string, jobId: string): Promise<string> {
  const r = first<{ status: string }>(await json(`/m/${enc(searchGroup)}/search/jobs/${enc(jobId)}/status`));
  return r?.status ?? 'unknown';
}

/** Returns one page of results. The first NDJSON line is job metadata, not an event. */
export async function searchResultsPage(
  searchGroup: string,
  jobId: string,
  limit: number,
  offset: number,
): Promise<{ meta: any; events: Record<string, unknown>[] }> {
  const res = await call(`/m/${enc(searchGroup)}/search/jobs/${enc(jobId)}/results?limit=${limit}&offset=${offset}`, {
    headers: { Accept: 'application/x-ndjson' },
  });
  const lines = (await res.text()).split('\n').filter((l) => l.trim());
  let meta: any = {};
  const events: Record<string, unknown>[] = [];
  lines.forEach((l, i) => {
    const o = JSON.parse(l);
    if (i === 0 && ('isFinished' in o || 'job' in o || 'totalEventCount' in o)) meta = o;
    else events.push(o);
  });
  return { meta, events };
}

// ---------------------------------------------------------------- Stream collectors and jobs

/** A saved collector's full configuration (used as a template). */
export async function getSavedCollector(group: string, id: string): Promise<Record<string, any>> {
  const r = first<Record<string, any>>(await json(`/m/${enc(group)}/lib/jobs/${enc(id)}`));
  if (!r || !r.collector) throw new Error(`Collector "${id}" in ${group} was not found or has no collector configuration.`);
  return r;
}

/** Start an ad hoc run of a collector configuration. Returns the job ID. */
export async function startCollectorJob(group: string, config: Record<string, any>): Promise<string> {
  const r = await json<any>(`/m/${enc(group)}/jobs`, jsonInit('POST', config));
  const id = Array.isArray(r?.items) ? (typeof r.items[0] === 'string' ? r.items[0] : r.items[0]?.id) : r?.id;
  if (!id) throw new Error('Cribl did not return a job ID for the collector run.');
  return String(id);
}

export async function getJobStatus(group: string, jobId: string): Promise<string> {
  const r = first<any>(await json(`/m/${enc(group)}/jobs/${enc(jobId)}`));
  return String(r?.status?.state ?? r?.status ?? r?.state ?? 'unknown');
}

// ---------------------------------------------------------------- Cribl Search saved (scheduled) searches
// Not declared in config/policies.yml on purpose: with user-based permissions these run as the signed-in
// member, so the scheduled search keeps that member's dataset access.

export interface SavedSearch {
  id: string;
  name: string;
  description?: string;
  query: string;
  earliest: string;
  latest: string;
  schedule?: { enabled: boolean; cronSchedule: string; tz?: string; keepLastN?: number };
}

export async function getSavedSearch(searchGroup: string, id: string): Promise<SavedSearch | null> {
  try {
    return first<SavedSearch>(await json(`/m/${enc(searchGroup)}/search/saved/${enc(id)}`));
  } catch (e) {
    if (e instanceof CriblApiError && e.status === 404) return null;
    throw e;
  }
}

/** Create or fully replace a saved search (PATCH needs the complete representation). */
export async function upsertSavedSearch(searchGroup: string, s: SavedSearch): Promise<void> {
  const body = { ...s, query: normalizeSearchQuery(s.query) };
  const existing = await getSavedSearch(searchGroup, s.id);
  if (existing) await json(`/m/${enc(searchGroup)}/search/saved/${enc(s.id)}`, jsonInit('PATCH', body));
  else await json(`/m/${enc(searchGroup)}/search/saved`, jsonInit('POST', body));
}

export async function deleteSavedSearch(searchGroup: string, id: string): Promise<void> {
  try {
    await call(`/m/${enc(searchGroup)}/search/saved/${enc(id)}`, { method: 'DELETE' });
  } catch (e) {
    if (!(e instanceof CriblApiError && e.status === 404)) throw e;
  }
}

// ---------------------------------------------------------------- App KV store (isolated per App)

export async function kvGet(key: string): Promise<string | undefined> {
  const res = await fetch(`${apiBase()}/kvstore/${enc(key)}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new CriblApiError(res.status, `/kvstore/${key}`, await res.text().catch(() => ''));
  const text = await res.text();
  return text === '' ? undefined : text;
}

export async function kvPut(key: string, value: string, encrypted = false): Promise<void> {
  const res = await fetch(`${apiBase()}/kvstore/${enc(key)}${encrypted ? '?encrypted=true' : ''}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: value,
  });
  if (!res.ok) throw new CriblApiError(res.status, `/kvstore/${key}`, await res.text().catch(() => ''));
}

export async function kvDelete(key: string): Promise<void> {
  const res = await fetch(`${apiBase()}/kvstore/${enc(key)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new CriblApiError(res.status, `/kvstore/${key}`, await res.text().catch(() => ''));
}
