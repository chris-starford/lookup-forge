// Lookup keys: one column, or several together (composite key, e.g. port + protocol).

const SEP = '\u241F'; // unit-separator symbol: never appears in real values

export function keysOf(def: { keyColumn: string; keyColumns?: string[] }): string[] {
  return def.keyColumns && def.keyColumns.length ? def.keyColumns : [def.keyColumn];
}

/** Internal identity of a row (for maps and sorting). */
export const rowKey = (row: Record<string, string>, keys: string[]) => keys.map((k) => row[k] ?? '').join(SEP);

/** Human-readable key, e.g. "3389 / tcp". */
export const keyLabel = (row: Record<string, string>, keys: string[]) => keys.map((k) => row[k] ?? '').join(' / ');

export const hasEmptyKey = (row: Record<string, string>, keys: string[]) => keys.some((k) => !row[k]);
