// Read → map → validate → publish. Shared by the UI ("Run now", "Preview") and the scheduled backend function.

import { APP_VERSION } from '../version';
import { toCsv } from './csv';
import { diffRows, diffSummary, readPublished } from './diff';
import { keysOf } from './keys';
import { describeError, publishToSearch, publishToStreamGroup } from './publish';
import { readStagedSource } from './schedule';
import { readSource } from './sources';
import { PendingError, readWorkerRows, requestWorkerSync } from './worker';
import { patchDefinition } from './store';
import { recordRun } from './store';
import { discoverFields, transformRows } from './transform';
import type { ExtraInput, LookupDefinition, PublishedState, RowDiff, RunStatus, RunSummary, Settings, TargetResult, TransformResult } from './types';

export interface PreviewResult {
  transform: TransformResult;
  csv: string;
  sourceFields: string[];
  sourceRows: number;
  messages: string[];
  /** Differences from the currently published version, when the App can read it. */
  diff?: RowDiff;
  /** Field names found in each extra source, by extra source id. */
  extraFields: Record<string, string[]>;
}

const newRunId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function previousGoodRows(def: LookupDefinition): number | undefined {
  const r = def.lastRun;
  return r && (r.status === 'success' || r.status === 'partial') ? r.rows : undefined;
}

export interface RunOptions {
  /** Read Lake-based sources from their staging lookups (backend, scheduled runs). */
  useStaging?: boolean;
  /** Don't publish when the new version is identical to the published one. */
  skipIfUnchanged?: boolean;
  /** Start a fresh Splunk-through-worker request for each worker source (scheduled runs). */
  requestWorkerData?: boolean;
}

/** Read and validate without publishing anything. */
export async function previewLookup(def: LookupDefinition, settings: Settings, onProgress?: (m: string) => void, options: RunOptions = {}): Promise<PreviewResult> {
  const messages: string[] = [];
  const log = (m: string) => {
    messages.push(m);
    onProgress?.(m);
  };
  const maxRows = def.validation.maxRows > 0 ? def.validation.maxRows : 100_000;
  const read = async (key: string, source: LookupDefinition['source']) => {
    if (source.type === 'splunk_worker') {
      if (options.requestWorkerData) {
        const req = await requestWorkerSync(source, def.name);
        await patchDefinition(def.id, { workerRequests: { ...(def.workerRequests ?? {}), [key]: req } }).catch(() => null);
        log(`Requested fresh data from Splunk through ${source.group} (sync ${req.syncId}); it will be used on a later run.`);
      }
      if (options.useStaging) return readStagedSource(def, key, source, settings, log);
      return readWorkerRows(source, def.name, def.workerRequests?.[key], settings, log);
    }
    return options.useStaging && (source.type === 'search' || source.type === 'splunk_staging')
      ? readStagedSource(def, key, source, settings, log)
      : readSource(source, { settings, maxRows, onProgress: log });
  };
  const raw = await read('main', def.source);
  const extras: ExtraInput[] = [];
  const extraFields: Record<string, string[]> = {};
  for (const ex of def.extraSources ?? []) {
    log(`Reading additional source "${ex.label}"...`);
    const rows = await read(ex.id, ex.source);
    extras.push({ label: ex.label, rows, fieldMap: ex.fieldMap, addNewKeys: ex.addNewKeys });
    extraFields[ex.id] = discoverFields(rows);
  }
  const transform = transformRows(def, raw, previousGoodRows(def), extras);
  for (const m of transform.merges ?? []) log(`Merged "${m.label}": ${m.input} row(s) read, ${m.filled} empty cell(s) filled, ${m.added} new row(s) added.`);
  const columns = def.columns.map((c) => c.name);
  const csv = transform.errors.length ? '' : toCsv(columns, transform.rows);
  let diff: RowDiff | undefined;
  if (!transform.errors.length) {
    const current = await readPublished(def, settings).catch(() => null);
    if (current) diff = diffRows(current.rows, transform.rows, keysOf(def), columns, current.from);
  }
  return { transform, csv, sourceFields: discoverFields(raw), sourceRows: raw.length, messages, diff, extraFields };
}

/** True when every selected target already holds the published version. */
function sameTargets(def: LookupDefinition): boolean {
  const p = def.published;
  if (!p || p.name !== def.name) return false;
  if (def.targets.search && !p.search) return false;
  return def.targets.streamGroups.every((g) => p.streamGroups.includes(g));
}

export function isDue(def: LookupDefinition, now = Date.now()): boolean {
  if (!def.scheduleMinutes || def.scheduleMinutes <= 0) return false;
  if (!def.lastRun) return true;
  return now - def.lastRun.finishedAt >= def.scheduleMinutes * 60_000 - 30_000;
}

export async function runLookup(
  def: LookupDefinition,
  settings: Settings,
  trigger: 'manual' | 'schedule',
  onProgress?: (m: string) => void,
  options: RunOptions = {},
): Promise<RunSummary> {
  const startedAt = Date.now();
  const messages: string[] = [];
  const log = (m: string) => {
    messages.push(m);
    onProgress?.(m);
  };
  const targets: TargetResult[] = [];
  let status: RunStatus = 'failed';
  let rows = 0;

  try {
    const preview = await previewLookup(def, settings, log, options);
    const t = preview.transform;
    rows = t.rows.length;
    t.warnings.forEach((w) => log(`Warning: ${w}`));
    if (preview.diff) log(`Changes: ${diffSummary(preview.diff)}.`);

    if (t.errors.length) {
      t.errors.forEach((e) => log(`Blocked: ${e}`));
      status = 'blocked';
    } else if (
      options.skipIfUnchanged &&
      preview.diff &&
      !preview.diff.added.length &&
      !preview.diff.removed.length &&
      !preview.diff.changed.length &&
      sameTargets(def)
    ) {
      log('No changes since the published version, so nothing was published.');
      status = 'success';
    } else if (!def.targets.search && def.targets.streamGroups.length === 0) {
      log('No targets are selected, so nothing was published.');
      status = 'blocked';
    } else {
      if (def.targets.search) {
        log('Publishing to Cribl Search...');
        targets.push(await publishToSearch(def, preview.csv, rows, settings));
      }
      for (const g of def.targets.streamGroups) {
        log(`Publishing to Stream group ${g}...`);
        targets.push(await publishToStreamGroup(def, preview.csv, rows, g, settings));
      }
      const ok = targets.filter((x) => x.status === 'ok').length;
      status = ok === targets.length ? 'success' : ok > 0 ? 'partial' : 'failed';
    }
  } catch (e) {
    if (e instanceof PendingError) {
      log(`Waiting: ${e.message}`);
      status = 'blocked';
    } else {
      log(`Error: ${describeError(e)}`);
      status = 'failed';
    }
  }

  const run: RunSummary = {
    runId: newRunId(),
    lookupId: def.id,
    startedAt,
    finishedAt: Date.now(),
    status,
    rows,
    previousRows: previousGoodRows(def),
    trigger,
    messages,
    targets,
    appVersion: APP_VERSION,
  };
  // Track where the lookup now exists. Keep earlier locations for the same file name: a failed target still holds its old version.
  let published: PublishedState | undefined;
  const okGroups = targets.filter((x) => x.status === 'ok' && x.target.startsWith('Stream: ')).map((x) => x.target.slice(8));
  const searchOk = targets.some((x) => x.target === 'Search' && x.status === 'ok');
  if (okGroups.length || searchOk) {
    const prev = def.published && def.published.name === def.name ? def.published : undefined;
    published = {
      name: def.name,
      search: searchOk || !!prev?.search,
      streamGroups: [...new Set([...(prev?.streamGroups ?? []), ...okGroups])],
      updatedAt: Date.now(),
    };
  }
  try {
    await recordRun(run, published);
  } catch (e) {
    onProgress?.(`Could not save the run history: ${describeError(e)}`);
  }
  return run;
}
