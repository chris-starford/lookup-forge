// Scheduling for lookups with Lake-based sources.
//
// The backend function cannot read Lake datasets (backend calls use the App's declared grants, which carry no
// dataset access). So each Lake-based source gets a Cribl Search scheduled search, saved as the signed-in member,
// that writes the source's raw rows to a staging Search lookup ("lm_src_..."). The backend function then reads the
// staging lookups through the lookups API, merges, validates and publishes as usual.

import { parseCsv } from './csv';
import { deleteSavedSearch, getLookupContent, listLookups, upsertSavedSearch } from './cribl';
import { describeError } from './publish';
import { selectLatestSync, stripStagingMeta, unpackJsonRaw } from './sources';
import { workerStagingKey } from './worker';
import type { LookupDefinition, Row, SchedulingState, Settings, SourceConfig } from './types';

export const isLakeSource = (s: SourceConfig) => s.type === 'search' || s.type === 'splunk_staging' || s.type === 'splunk_worker';

export function cronFor(minutes: number): string {
  if (minutes <= 15) return '*/15 * * * *';
  if (minutes < 60) return `*/${minutes} * * * *`;
  if (minutes === 60) return '5 * * * *';
  if (minutes < 1440) return `5 */${Math.round(minutes / 60)} * * *`;
  return '15 2 * * *';
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Every Lake-based source of a definition, keyed "main" or by the additional source's id. */
export function lakeSources(def: LookupDefinition): { key: string; source: SourceConfig }[] {
  const out: { key: string; source: SourceConfig }[] = [];
  if (isLakeSource(def.source)) out.push({ key: 'main', source: def.source });
  for (const ex of def.extraSources ?? []) if (isLakeSource(ex.source)) out.push({ key: ex.id, source: ex.source });
  return out;
}

export function stagingName(def: LookupDefinition, key: string): string {
  return `lm_src_${slug(def.name).slice(0, 30)}_${slug(key).slice(0, 16)}`;
}

/** The scheduled search for one source: its raw rows, exported to the staging lookup. */
export function stagingQuery(source: SourceConfig, lookupName: string, settings: Settings, defName = ''): string {
  const tail = ` | export mode=overwrite description="Lookup Forge staging (do not edit)" to lookup ${lookupName}`;
  if (source.type === 'search') return `${source.query.trim()} | limit 10000${tail}`;
  if (source.type === 'splunk_staging') {
    const ds = source.dataset || settings.splunkStagingDataset;
    return `dataset="${ds}" splunk_lookup="${source.splunkLookup}" | extend raw_json=_raw, event_time=_time | project raw_json, sync_id, event_time | limit 10000${tail}`;
  }
  if (source.type === 'splunk_worker') {
    const ds = source.dataset || settings.splunkStagingDataset;
    return `dataset="${ds}" splunk_lookup="${workerStagingKey(source, defName)}" | extend raw_json=_raw, event_time=_time | project raw_json, sync_id, event_time | limit 10000${tail}`;
  }
  throw new Error(`Source type ${source.type} does not need a scheduled search.`);
}

/** Create, update or remove the scheduled searches a definition needs. Returns the new scheduling state. */
export async function syncSchedules(def: LookupDefinition, settings: Settings): Promise<SchedulingState | undefined> {
  const wanted = def.scheduleMinutes > 0 ? lakeSources(def) : [];
  const previous = def.scheduling?.savedSearches ?? [];
  const state: SchedulingState = { savedSearches: [], syncedAt: Date.now() };
  try {
    for (const w of wanted) {
      const name = stagingName(def, w.key);
      const src = w.source as Extract<SourceConfig, { type: 'search' | 'splunk_staging' | 'splunk_worker' }>;
      await upsertSavedSearch(settings.searchGroup, {
        id: name,
        name: `Lookup Forge: ${def.title} (${w.key})`,
        description: `Refreshes staging lookup ${name} for ${def.name}. Managed by the Lookup Forge App; edit the lookup there.`,
        query: stagingQuery(w.source, name, settings, def.name),
        earliest: src.type === 'splunk_worker' ? '-7d' : src.earliest || '-24h',
        latest: src.type === 'search' ? src.latest || 'now' : 'now',
        schedule: { enabled: true, cronSchedule: cronFor(def.scheduleMinutes), tz: 'UTC', keepLastN: 2 },
      });
      state.savedSearches.push({ sourceKey: w.key, id: name, stagingLookup: name });
    }
    state.cron = wanted.length ? cronFor(def.scheduleMinutes) : undefined;
    for (const p of previous) if (!state.savedSearches.some((x) => x.id === p.id)) await deleteSavedSearch(settings.searchGroup, p.id);
  } catch (e) {
    state.error = `Could not set up the scheduled search: ${describeError(e)}`;
  }
  return state.savedSearches.length || state.error ? state : undefined;
}

export async function removeSchedules(def: LookupDefinition, settings: Settings): Promise<string[]> {
  const errors: string[] = [];
  for (const p of def.scheduling?.savedSearches ?? []) {
    try {
      await deleteSavedSearch(settings.searchGroup, p.id);
    } catch (e) {
      errors.push(`${p.id}: ${describeError(e)}`);
    }
  }
  return errors;
}

/** Backend path: read a Lake-based source from its staging lookup instead of running a search. */
export async function readStagedSource(def: LookupDefinition, key: string, source: SourceConfig, settings: Settings, onProgress?: (m: string) => void): Promise<Row[]> {
  const name = stagingName(def, key);
  const items = await listLookups(settings.searchGroup);
  const hit = items.find((l) => l.id === name || l.id === `${name}.csv`);
  if (!hit) throw new Error(`The scheduled search has not produced staging lookup ${name} yet. It runs on the lookup's schedule; check Search > Saved Searches.`);
  const rows: Row[] = parseCsv(await getLookupContent(settings.searchGroup, hit.id));
  onProgress?.(`Read ${rows.length} row(s) from staging lookup ${hit.id}.`);
  if (source.type === 'splunk_staging' || source.type === 'splunk_worker') {
    const unpacked = rows.map((r) => unpackJsonRaw({ ...r, _raw: r.raw_json }));
    return stripStagingMeta(selectLatestSync(unpacked, onProgress));
  }
  return rows;
}
