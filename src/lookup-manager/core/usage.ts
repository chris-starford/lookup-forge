// Ready-to-use snippets that show how to apply a lookup in Cribl Stream and Cribl Search.

import { keysOf } from './keys';
import { fileNameFor } from './publish';
import { getTemplate } from './templates';
import type { LookupDefinition } from './types';

export interface UsageSnippets {
  /** Event field matched against each key column (editable guesses from the template). */
  inFields: { eventField: string; lookupField: string }[];
  /** A Stream Lookup function, as it appears in a pipeline's JSON. */
  streamFunction: Record<string, unknown>;
  /** A Cribl Search query fragment. */
  searchQuery: string;
  notes: string[];
}

export function usageFor(def: LookupDefinition, eventFieldOverrides: Record<string, string> = {}): UsageSnippets {
  const t = getTemplate(def.enrichment);
  const keys = keysOf(def);
  const prefix = t.usage?.outPrefix ?? 'lkp_';
  const inFields = keys.map((k) => ({ eventField: eventFieldOverrides[k] || t.usage?.eventFields[k] || k, lookupField: k }));
  const outFields = def.columns.map((c) => c.name).filter((c) => !keys.includes(c)).map((c) => ({ lookupField: c, eventField: `${prefix}${c}` }));
  const conf: Record<string, unknown> = {
    file: fileNameFor(def),
    matchMode: def.matchMode,
    ...(def.matchMode !== 'exact' ? { matchType: 'specific' } : {}),
    ignoreCase: false,
    inFields,
    outFields,
    addToEvent: false,
  };
  const streamFunction = {
    id: 'lookup',
    filter: inFields.map((f) => f.eventField).join(' && '),
    description: `Enrich with ${def.title || def.name}`,
    conf,
  };
  const on = inFields.map((f) => `${f.eventField}=${f.lookupField}`).join(', ');
  const searchQuery = `dataset="your_dataset"\n| lookup ${def.name} on ${on}\n| project _time, ${inFields.map((f) => f.eventField).join(', ')}, ${outFields
    .slice(0, 4)
    .map((o) => o.lookupField)
    .join(', ')}`;
  const notes = [
    `In Stream, add a Lookup function to the pipeline that processes these events (Processing > Pipelines), or paste this into the pipeline's JSON. It adds ${outFields.length} field(s) prefixed "${prefix}".`,
    'Event fields that don\'t exist in your data simply produce no match; change them to your field names.',
  ];
  if (def.matchMode === 'cidr') notes.push('CIDR lookups: "matchType: specific" picks the most specific network when ranges overlap. In Cribl Search, check the lookup operator\'s documentation for CIDR matching options.');
  if (def.matchMode === 'regex') notes.push('Regex lookups: in Stream the event field is tested against each pattern in the key column.');
  if (keys.length > 1) notes.push(`Composite key: an event matches only when all of ${keys.join(', ')} match.`);
  return { inFields, streamFunction, searchQuery, notes };
}
