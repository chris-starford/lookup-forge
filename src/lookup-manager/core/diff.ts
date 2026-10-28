// Compare a new lookup version with the one currently published.

import { parseCsv } from './csv';
import { keyLabel, rowKey } from './keys';
import { getLookupContent } from './cribl';
import { fileNameFor } from './publish';
import type { LookupDefinition, RowDiff, Settings } from './types';

export function diffRows(
  before: Record<string, string>[],
  after: Record<string, string>[],
  key: string | string[],
  columns: string[],
  comparedWith: string,
): RowDiff {
  const keys = Array.isArray(key) ? key : [key];
  const old = new Map(before.map((r) => [rowKey(r, keys), r]));
  const seen = new Set<string>();
  const diff: RowDiff = { comparedWith, added: [], removed: [], changed: [], unchanged: 0 };
  for (const r of after) {
    const k = rowKey(r, keys);
    seen.add(k);
    const o = old.get(k);
    if (!o) {
      diff.added.push(r);
      continue;
    }
    const cols = columns.filter((c) => (o[c] ?? '') !== (r[c] ?? ''));
    if (cols.length) diff.changed.push({ key: keyLabel(r, keys), columns: cols, before: o, after: r });
    else diff.unchanged++;
  }
  for (const [k, r] of old) if (!seen.has(k)) diff.removed.push(r);
  return diff;
}

export const diffSummary = (d: RowDiff) =>
  `${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed, ${d.unchanged} unchanged (compared with ${d.comparedWith})`;

/** Read the currently published version: first from a Stream group it was published to, otherwise from Search. */
export async function readPublished(def: LookupDefinition, settings: Settings): Promise<{ rows: Record<string, string>[]; from: string } | null> {
  const p = def.published;
  if (!p || p.name !== def.name) return null;
  const file = fileNameFor(def);
  const places = [...p.streamGroups.map((g) => ({ group: g, label: `Stream: ${g}` })), ...(p.search ? [{ group: settings.searchGroup, label: 'Search' }] : [])];
  for (const pl of places) {
    try {
      return { rows: parseCsv(await getLookupContent(pl.group, file)), from: pl.label };
    } catch {
      /* try the next place */
    }
  }
  return null;
}
