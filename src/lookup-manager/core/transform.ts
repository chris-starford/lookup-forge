// Turn raw source rows into validated lookup rows.

import { hasEmptyKey, keyLabel, keysOf, rowKey } from './keys';
import type { ExtraInput, FieldMap, LookupDefinition, Row, TransformResult } from './types';

/** Read a dot path such as "owned_by.name" or "items.0.id". */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  if (obj && typeof obj === 'object' && path in (obj as Row)) return (obj as Row)[path];
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Row)[part];
  }
  return cur;
}

export function toCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(toCell).join(';');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).replace(/[\r\n]+/g, ' ').trim();
}

const CIDR_V4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/([0-9]|[12]\d|3[0-2]))?$/;
const CIDR_V6 = /^[0-9a-fA-F:]+(\/(\d|[1-9]\d|1[01]\d|12[0-8]))?$/;

export function isValidCidr(v: string): boolean {
  return CIDR_V4.test(v) || (v.includes(':') && CIDR_V6.test(v));
}

/** Collect field names that appear in the first rows, for the mapping editor. */
export function discoverFields(rows: Row[], sample = 50): string[] {
  const seen = new Set<string>();
  const walk = (o: unknown, prefix: string, depth: number) => {
    if (!o || typeof o !== 'object' || Array.isArray(o) || depth > 2) return;
    for (const [k, v] of Object.entries(o as Row)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p, depth + 1);
      else seen.add(p);
    }
  };
  rows.slice(0, sample).forEach((r) => walk(r, '', 0));
  return [...seen].filter((f) => !f.startsWith('_') && f !== 'cribl_breaker').sort();
}

/** Map raw rows to lookup columns: blank = same-named field, "=x" = literal, otherwise a (dot) path. */
export function mapRows(columns: string[], fieldMap: FieldMap[], input: Row[]): Record<string, string>[] {
  const mapFor = new Map(fieldMap.map((m) => [m.column, m.source]));
  return input.map((r) => {
    const out: Record<string, string> = {};
    for (const c of columns) {
      const src = mapFor.get(c);
      if (src === undefined || src === '') out[c] = toCell(getPath(r, c));
      else if (src.startsWith('=')) out[c] = src.slice(1);
      else out[c] = toCell(getPath(r, src));
    }
    return out;
  });
}

export function transformRows(
  def: Pick<LookupDefinition, 'columns' | 'keyColumn' | 'keyColumns' | 'matchMode' | 'fieldMap' | 'validation'>,
  input: Row[],
  previousRows?: number,
  extras: ExtraInput[] = [],
): TransformResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const columns = def.columns.map((c) => c.name.trim()).filter(Boolean);

  if (columns.length === 0) errors.push('The lookup has no columns.');
  const keys = keysOf(def);
  const keyNames = keys.map((k) => `"${k}"`).join(' + ');
  for (const k of keys) if (!columns.includes(k)) errors.push(`The key column "${k}" is not one of the columns.`);
  if (keys.length > 1 && def.matchMode !== 'exact') errors.push('CIDR and regex matching need a single key column. Use Exact match for a composite key.');
  const dupCols = columns.filter((c, i) => columns.indexOf(c) !== i);
  if (dupCols.length) errors.push(`Duplicate column names: ${[...new Set(dupCols)].join(', ')}.`);
  const badCols = columns.filter((c) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c));
  if (badCols.length) errors.push(`Column names must start with a letter or underscore and use only letters, digits and underscores: ${badCols.join(', ')}.`);
  if (errors.length) return { rows: [], errors, warnings, stats: { input: input.length, output: 0, duplicates: 0, emptyKeys: 0 } };

  const mapped = mapRows(columns, def.fieldMap, input);

  let emptyKeys = 0;
  const byKey = new Map<string, Record<string, string>>();
  for (const r of mapped) {
    if (hasEmptyKey(r, keys)) {
      emptyKeys++;
      continue;
    }
    byKey.set(rowKey(r, keys), r); // last occurrence wins
  }
  const duplicates = mapped.length - emptyKeys - byKey.size;

  // Merge extra sources in order: fill empty cells of existing keys; optionally add new keys. Earlier sources win.
  const merges: NonNullable<TransformResult['merges']> = [];
  for (const ex of extras) {
    const exRows = new Map<string, Record<string, string>>();
    for (const r of mapRows(columns, ex.fieldMap, ex.rows)) if (!hasEmptyKey(r, keys)) exRows.set(rowKey(r, keys), r);
    let filled = 0;
    let added = 0;
    for (const [k, r] of exRows) {
      const base = byKey.get(k);
      if (base) {
        for (const c of columns) {
          if (!base[c] && r[c]) {
            base[c] = r[c];
            filled++;
          }
        }
      } else if (ex.addNewKeys) {
        byKey.set(k, r);
        added++;
      }
    }
    merges.push({ label: ex.label, input: ex.rows.length, filled, added });
  }

  // Stable order by key, so each published version only differs where the data changed.
  const collator = new Intl.Collator(undefined, { numeric: true });
  const rows = [...byKey.values()].sort((a, b) => collator.compare(rowKey(a, keys), rowKey(b, keys)));

  if (emptyKeys > 0) {
    const msg = `${emptyKeys} row(s) had an empty ${keyNames}.`;
    if (def.validation.blockOnEmptyKey) errors.push(`${msg} Publishing is blocked by the validation rules.`);
    else warnings.push(`${msg} They were dropped.`);
  }
  if (duplicates > 0) warnings.push(`${duplicates} duplicate key(s) were merged (the last row wins), for example ${keyLabel(mapped.find((r) => !hasEmptyKey(r, keys))!, keys)}.`);

  if (def.matchMode === 'cidr') {
    const bad = rows.filter((r) => !isValidCidr(r[keys[0]]));
    if (bad.length) errors.push(`${bad.length} key(s) are not valid CIDR notation, for example "${bad[0][keys[0]]}".`);
  }
  if (def.matchMode === 'regex') {
    const bad: string[] = [];
    for (const r of rows) {
      try {
        new RegExp(r[keys[0]]);
      } catch {
        bad.push(r[keys[0]]);
      }
    }
    if (bad.length) errors.push(`${bad.length} key(s) are not valid regular expressions, for example "${bad[0]}".`);
  }

  if (rows.length === 0) errors.push('The source returned no usable rows.');
  if (def.validation.maxRows > 0 && rows.length > def.validation.maxRows) {
    errors.push(`${rows.length} rows exceeds the limit of ${def.validation.maxRows}.`);
  }
  if (previousRows && previousRows > 0 && def.validation.maxDropPct > 0) {
    const drop = ((previousRows - rows.length) / previousRows) * 100;
    if (drop > def.validation.maxDropPct) {
      errors.push(
        `Row count fell ${drop.toFixed(0)}% (from ${previousRows} to ${rows.length}), above the ${def.validation.maxDropPct}% safety limit. Check the source before publishing.`,
      );
    }
  }

  return { rows, errors, warnings, stats: { input: input.length, output: rows.length, duplicates, emptyKeys }, merges: extras.length ? merges : undefined };
}
