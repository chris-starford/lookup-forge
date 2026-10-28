// Publish a validated lookup to Cribl Stream Worker Groups and Cribl Search.

import {
  commitGroup,
  type CommitResult,
  createLookup,
  CriblApiError,
  deleteLookup,
  deployGroup,
  getPendingChanges,
  listLookups,
  replaceLookup,
  uploadLookupFile,
} from './cribl';
import { keysOf } from './keys';
import { runSearch } from './sources';
import type { LookupDefinition, Settings, TargetResult } from './types';

export const fileNameFor = (def: Pick<LookupDefinition, 'name'>) => `${def.name}.csv`;

/** Above these sizes "auto" stores a Stream lookup on disk instead of in every worker process's memory. */
export const DISK_THRESHOLD = { rows: 100_000, bytes: 10 * 1024 * 1024 };

export function streamModeFor(mode: 'memory' | 'disk' | 'auto' | undefined, rows: number, bytes: number): 'memory' | 'disk' {
  if (mode === 'memory' || mode === 'disk') return mode;
  return rows > DISK_THRESHOLD.rows || bytes > DISK_THRESHOLD.bytes ? 'disk' : 'memory';
}

/** The files Cribl writes for a lookup in a group (seen in commit diffs). */
export function lookupFilesFor(def: Pick<LookupDefinition, 'name'>, group: string): string[] {
  return [`groups/${group}/data/lookups/${def.name}.csv`, `groups/${group}/data/lookups/${def.name}.yml`];
}

export async function publishToStreamGroup(
  def: LookupDefinition,
  csv: string,
  rowCount: number,
  group: string,
  settings: Settings,
): Promise<TargetResult> {
  const target = `Stream: ${group}`;
  const file = fileNameFor(def);
  const ownFiles = lookupFilesFor(def, group);
  try {
    const mode = streamModeFor(def.targets.streamMode, rowCount, csv.length);
    const tmp = await uploadLookupFile(group, file, csv);
    const exists = (await listLookups(group)).some((l) => l.id === file);
    if (exists) await replaceLookup(group, file, tmp, def.description || def.title, mode);
    else await createLookup(group, file, tmp, def.description || def.title, mode);

    const message = `Lookup Manager: ${exists ? 'update' : 'create'} ${file} (${rowCount} rows)`;
    let commit: CommitResult;
    let note = '';
    try {
      // Commit only this lookup's own files, so other pending work in the group is never included.
      commit = await commitGroup(group, message, ownFiles);
    } catch (selectiveError) {
      // Selective commit not accepted: only fall back to a whole-group commit when it is provably safe.
      const pending = await getPendingChanges(group).catch(() => undefined);
      const ours = 2;
      if (settings.blockIfPendingChanges && (pending === undefined || pending > ours)) {
        return {
          target,
          status: 'skipped',
          detail: `The lookup was uploaded but not committed. A commit limited to its own files was refused (${describeError(selectiveError)}), and ${
            pending === undefined ? 'the group\'s other pending changes could not be checked' : `the group has ${pending - ours} other pending change(s)`
          }, so committing the whole group could include unrelated work. Commit it in Stream, or turn off the safety check in Settings.`,
        };
      }
      commit = await commitGroup(group, message);
      note = ' (whole-group commit)';
    }

    const extra = commit.files.filter((f) => !ownFiles.includes(f));
    await deployGroup(group, commit.id);
    const base = `${exists ? 'Replaced' : 'Created'} ${file}${mode === 'disk' ? ' (disk-based)' : ''}, committed ${commit.id.slice(0, 7)}${note} and deployed.`;
    if (extra.length) {
      return { target, status: 'ok', detail: `${base} Note: the commit also included ${extra.length} other file(s): ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', ...' : ''}.` };
    }
    return { target, status: 'ok', detail: base };
  } catch (e) {
    return { target, status: 'error', detail: describeError(e) };
  }
}

/** Remove a lookup file from a Stream group: delete it, commit only its own files, deploy. */
export async function unpublishFromStreamGroup(name: string, group: string, settings: Settings): Promise<TargetResult> {
  const target = `Stream: ${group}`;
  const file = `${name}.csv`;
  const ownFiles = lookupFilesFor({ name }, group);
  try {
    try {
      await deleteLookup(group, file);
    } catch (e) {
      if (e instanceof CriblApiError && e.status === 404) return { target, status: 'ok', detail: `${file} was not present.` };
      throw e;
    }
    let commit: CommitResult;
    try {
      commit = await commitGroup(group, `Lookup Manager: remove ${file}`, ownFiles);
    } catch (selectiveError) {
      const pending = await getPendingChanges(group).catch(() => undefined);
      if (settings.blockIfPendingChanges && (pending === undefined || pending > 2)) {
        return { target, status: 'skipped', detail: `${file} was deleted but not committed (${describeError(selectiveError)}). Commit the removal in Stream.` };
      }
      commit = await commitGroup(group, `Lookup Manager: remove ${file}`);
    }
    await deployGroup(group, commit.id);
    return { target, status: 'ok', detail: `Removed ${file}, committed ${commit.id.slice(0, 7)} and deployed. Pipelines that used it stop enriching until they point at another lookup.` };
  } catch (e) {
    return { target, status: 'error', detail: describeError(e) };
  }
}

export async function unpublishFromSearch(name: string, settings: Settings): Promise<TargetResult> {
  const file = `${name}.csv`;
  try {
    await deleteLookup(settings.searchGroup, file);
    return { target: 'Search', status: 'ok', detail: `Removed ${file} from ${settings.searchGroup}.` };
  } catch (e) {
    if (e instanceof CriblApiError && e.status === 404) return { target: 'Search', status: 'ok', detail: `${file} was not present.` };
    return { target: 'Search', status: 'error', detail: `${describeError(e)} Remove it under Search > Data > Lookups.` };
  }
}

/** Where a definition is published but would no longer be after an edit (rename, or a target deselected). */
export function staleLocations(before: LookupDefinition | undefined, after: LookupDefinition): { name: string; search: boolean; streamGroups: string[] } | null {
  const p = before?.published;
  if (!p) return null;
  const renamed = p.name !== after.name;
  const search = p.search && (renamed || !after.targets.search);
  const streamGroups = p.streamGroups.filter((g) => renamed || !after.targets.streamGroups.includes(g));
  return search || streamGroups.length ? { name: p.name, search, streamGroups } : null;
}

export async function removeLocations(loc: { name: string; search: boolean; streamGroups: string[] }, settings: Settings): Promise<TargetResult[]> {
  const out: TargetResult[] = [];
  if (loc.search) out.push(await unpublishFromSearch(loc.name, settings));
  for (const g of loc.streamGroups) out.push(await unpublishFromStreamGroup(loc.name, g, settings));
  return out;
}

/** Build a KQL tail that maps, de-duplicates and exports search results to a Search lookup. */
export function buildExportTail(def: LookupDefinition): string {
  const keys = keysOf(def);
  const mapFor = new Map(def.fieldMap.map((m) => [m.column, m.source]));
  const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const extend = def.columns.map((c) => {
    const src = mapFor.get(c.name) || c.name;
    return src.startsWith('=') ? `${c.name}=${q(src.slice(1))}` : `${c.name}=tostring(${src})`;
  });
  const others = def.columns.map((c) => c.name).filter((c) => !keys.includes(c));
  const by = keys.join(', ');
  const summarize = others.length ? `summarize ${others.map((c) => `${c}=take_any(${c})`).join(', ')} by ${by}` : `summarize by ${by}`;
  const desc = q(def.description || def.title || def.name);
  const nonEmpty = keys.map((k) => `isnotempty(${k})`).join(' and ');
  return ` | extend ${extend.join(', ')} | where ${nonEmpty} | ${summarize} | project ${def.columns.map((c) => c.name).join(', ')} | export mode=overwrite description=${desc} to lookup ${def.name}`;
}

/**
 * Publish to Cribl Search.
 * 1. Upload through the lookups API on the Search group when the Workspace supports it.
 * 2. Otherwise, for search-based sources, re-run the query with `export mode=overwrite to lookup`.
 */
export async function publishToSearch(def: LookupDefinition, csv: string, rowCount: number, settings: Settings): Promise<TargetResult> {
  const target = 'Search';
  const group = settings.searchGroup;
  const file = fileNameFor(def);

  let apiError: unknown;
  try {
    const existing = await listLookups(group);
    const tmp = await uploadLookupFile(group, file, csv);
    if (existing.some((l) => l.id === file)) await replaceLookup(group, file, tmp, def.description || def.title, 'memory');
    else await createLookup(group, file, tmp, def.description || def.title, 'memory');
    return { target, status: 'ok', detail: `Uploaded ${file} (${rowCount} rows) to ${group}. Check it under Search > Data > Lookups.` };
  } catch (e) {
    apiError = e;
  }

  if (def.source.type === 'search' && def.extraSources?.length) {
    return {
      target,
      status: 'skipped',
      detail: `This Workspace did not accept a lookup upload for Search (${describeError(apiError)}), and a lookup that merges several sources can't be rebuilt with the export operator. Download the CSV from the preview and add it under Search > Data > Lookups.`,
    };
  }

  if (def.source.type === 'search') {
    if (rowCount > 10000) {
      return { target, status: 'error', detail: `The Search lookups API is unavailable (${describeError(apiError)}) and export to lookup is limited to 10,000 rows.` };
    }
    try {
      const query = def.source.query + buildExportTail(def);
      await runSearch(query, def.source.earliest || '-24h', def.source.latest || 'now', { settings, maxRows: 10 });
      return { target, status: 'ok', detail: `Exported to Search lookup "${def.name}" with the export operator.` };
    } catch (e) {
      return { target, status: 'error', detail: `Export to Search failed: ${describeError(e)}` };
    }
  }

  return {
    target,
    status: 'skipped',
    detail: `This Workspace did not accept a lookup upload for Search (${describeError(apiError)}). Download the CSV from the run preview and add it under Search > Data > Lookups, or use a search-based source.`,
  };
}

export function describeError(e: unknown): string {
  if (e instanceof CriblApiError) {
    let detail: string = e.body;
    try {
      const j = JSON.parse(e.body);
      detail = j.message || j.error || e.body;
    } catch {
      /* body was not JSON */
    }
    detail = String(detail).slice(0, 200);
    if (e.status === 403) return `Permission denied on ${e.path}${detail ? `: ${detail}` : ''}. Check config/policies.yml, the App's permission mode and your role.`;
    if (e.status === 404) return `Not found: ${e.path}.`;
    return `Cribl API ${e.status} on ${e.path}: ${detail}`;
  }
  return e instanceof Error ? e.message : String(e);
}
