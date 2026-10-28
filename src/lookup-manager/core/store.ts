// Persist lookup definitions, run history and settings in the App's KV store.

import { APP_VERSION } from '../version';
import { kvDelete, kvGet, kvPut } from './cribl';
import { DEFAULT_SETTINGS, type LookupDefinition, type PublishedState, type RunSummary, type Settings } from './types';

const INDEX = 'lm-index';
const SETTINGS = 'lm-settings';
const defKey = (id: string) => `lm-def-${id}`;
const runsKey = (id: string) => `lm-runs-${id}`;
const MAX_RUNS = 20;
/** Content larger than this is kept in separate KV entries of this size. */
export const CHUNK_BYTES = 900 * 1024;
const blobKey = (prefix: string, i: number) => `${prefix}-${i}`;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await kvGet(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>(SETTINGS, {})) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await kvPut(SETTINGS, JSON.stringify(s));
}

type AnySource = LookupDefinition['source'];

/** Move large inline content out of a definition into chunked KV entries. */
async function offloadContent(id: string, key: string, src: AnySource): Promise<AnySource> {
  if (src.type !== 'csv' || src.content.length <= CHUNK_BYTES) return src;
  const prefix = `lm-blob-${id}-${key}`;
  const chunks = Math.ceil(src.content.length / CHUNK_BYTES);
  for (let i = 0; i < chunks; i++) await kvPut(blobKey(prefix, i), src.content.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
  return { ...src, content: '', contentRef: { prefix, chunks, bytes: src.content.length } };
}

async function restoreContent(src: AnySource): Promise<AnySource> {
  if (src.type !== 'csv' || !src.contentRef) return src;
  const parts: string[] = [];
  for (let i = 0; i < src.contentRef.chunks; i++) parts.push((await kvGet(blobKey(src.contentRef.prefix, i))) ?? '');
  const { contentRef: _ref, ...rest } = src;
  return { ...rest, content: parts.join('') };
}

async function deleteContent(def: LookupDefinition): Promise<void> {
  for (const src of [def.source, ...(def.extraSources ?? []).map((e) => e.source)]) {
    if (src.type === 'csv' && src.contentRef) for (let i = 0; i < src.contentRef.chunks; i++) await kvDelete(blobKey(src.contentRef.prefix, i));
  }
}

async function hydrate(def: LookupDefinition | null): Promise<LookupDefinition | null> {
  if (!def) return null;
  return {
    ...def,
    source: await restoreContent(def.source),
    extraSources: def.extraSources ? await Promise.all(def.extraSources.map(async (e) => ({ ...e, source: await restoreContent(e.source) }))) : undefined,
  };
}

export async function listDefinitions(): Promise<LookupDefinition[]> {
  const ids = await readJson<string[]>(INDEX, []);
  const defs = await Promise.all(ids.map(async (id) => hydrate(await readJson<LookupDefinition | null>(defKey(id), null))));
  return defs.filter((d): d is LookupDefinition => !!d).sort((a, b) => a.title.localeCompare(b.title));
}

export async function getDefinition(id: string): Promise<LookupDefinition | null> {
  return hydrate(await readJson<LookupDefinition | null>(defKey(id), null));
}

/** The stored form, without loading chunked content (used for small updates). */
async function getStored(id: string): Promise<LookupDefinition | null> {
  return readJson<LookupDefinition | null>(defKey(id), null);
}

export async function saveDefinition(def: LookupDefinition): Promise<void> {
  const previous = await getStored(def.id);
  if (previous) await deleteContent(previous);
  const stored: LookupDefinition = {
    ...def,
    source: await offloadContent(def.id, 'main', def.source),
    extraSources: def.extraSources
      ? await Promise.all(def.extraSources.map(async (e) => ({ ...e, source: await offloadContent(def.id, e.id, e.source) })))
      : undefined,
    savedWithVersion: APP_VERSION,
  };
  await kvPut(defKey(def.id), JSON.stringify(stored));
  const ids = await readJson<string[]>(INDEX, []);
  if (!ids.includes(def.id)) await kvPut(INDEX, JSON.stringify([...ids, def.id]));
}

export async function deleteDefinition(id: string): Promise<void> {
  const stored = await getStored(id);
  if (stored) await deleteContent(stored);
  const ids = await readJson<string[]>(INDEX, []);
  await kvPut(INDEX, JSON.stringify(ids.filter((x) => x !== id)));
  await kvDelete(defKey(id));
  await kvDelete(runsKey(id));
}

export async function listRuns(id: string): Promise<RunSummary[]> {
  return readJson<RunSummary[]>(runsKey(id), []);
}

export async function recordRun(run: RunSummary, published?: PublishedState): Promise<void> {
  const runs = await listRuns(run.lookupId);
  await kvPut(runsKey(run.lookupId), JSON.stringify([run, ...runs].slice(0, MAX_RUNS)));
  const def = await getStored(run.lookupId);
  if (def) await kvPut(defKey(def.id), JSON.stringify({ ...def, lastRun: run, ...(published ? { published } : {}) }));
}

export async function patchDefinition(id: string, patch: Partial<LookupDefinition>): Promise<LookupDefinition | null> {
  const def = await getStored(id);
  if (!def) return null;
  const next = { ...def, ...patch };
  await kvPut(defKey(id), JSON.stringify(next));
  return hydrate(next);
}
