// Lookup Manager — shared types used by the UI and the backend runner.

export type EnrichmentType =
  | 'asset'
  | 'identity'
  | 'service_port'
  | 'ip_subnet'
  | 'threat_intel'
  | 'vulnerability'
  | 'custom';

/** How Cribl matches an event field against the lookup key. */
export type MatchMode = 'exact' | 'cidr' | 'regex';

export interface Column {
  name: string;
  description?: string;
}

export interface SearchSource {
  type: 'search';
  /** Cribl Search query (KQL). Multi-line is fine; the app flattens it. */
  query: string;
  earliest: string;
  latest: string;
}

export interface HttpSource {
  type: 'http';
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  format: 'json' | 'ndjson' | 'csv';
  /** Dot path to the array of records inside a JSON response, e.g. "data.items". Empty if the response is an array. */
  dataPath?: string;
}

export interface CsvSource {
  type: 'csv';
  content: string;
  /** Format of the pasted or uploaded content. Defaults to csv. */
  format?: 'csv' | 'tsv' | 'json' | 'ndjson';
  /** Set by the store when large content is kept in separate KV entries. */
  contentRef?: { prefix: string; chunks: number; bytes: number };
  /** Name of the uploaded file, for display. */
  fileName?: string;
}

/** Splunk lookup rows that a Stream REST Collector has written to a Lake staging dataset. */
export interface SplunkStagingSource {
  type: 'splunk_staging';
  dataset: string;
  splunkLookup: string;
  earliest: string;
}

/** Splunk REST API called directly through the App proxy (for Splunk Cloud or any reachable Splunk). */
export interface SplunkRestSource {
  type: 'splunk_rest';
  /** e.g. https://acme.splunkcloud.com:8089 */
  baseUrl: string;
  /** "lookup" reads an existing lookup with | inputlookup; "spl" runs any search that returns a table. Defaults to "lookup". */
  mode?: 'lookup' | 'spl';
  /** Lookup file or definition name, for mode "lookup". */
  splunkLookup: string;
  /** Search, for mode "spl". A leading "search" is added when the query does not start with "|" or "search". */
  spl?: string;
  earliest?: string;
  latest?: string;
}

/** Splunk reached through a Stream worker that can see it (for example a hybrid worker on a private network): the App starts a one-off
 *  run of a saved REST Collector with the search filled in; rows arrive in the Lake staging dataset. */
export interface SplunkWorkerSource {
  type: 'splunk_worker';
  /** Worker Group whose workers can reach Splunk. */
  group: string;
  /** Saved REST Collector used as the template (see docs/SPLUNK_SYNC.md, Part 2). */
  collectorId: string;
  /** Lake staging dataset the collector's rows land in. */
  dataset: string;
  mode: 'lookup' | 'spl';
  splunkLookup: string;
  spl?: string;
  earliest?: string;
  latest?: string;
}

export type SourceConfig =
  | SearchSource
  | HttpSource
  | CsvSource
  | SplunkStagingSource
  | SplunkRestSource
  | SplunkWorkerSource;

/** A request sent to Splunk through a worker, waiting for its rows to reach Lake. */
export interface WorkerRequest {
  syncId: string;
  jobId?: string;
  requestedAt: number;
}

export type SourceType = SourceConfig['type'];

/** Maps one lookup column to a field in the source rows. A source starting with "=" is a literal value. */
export interface FieldMap {
  column: string;
  source: string;
}

/** An additional source: fills empty columns for keys the lookup already has, and can add new keys. */
export interface ExtraSource {
  id: string;
  label: string;
  source: SourceConfig;
  fieldMap: FieldMap[];
  /** Add rows whose key the main (and earlier) sources don't have. */
  addNewKeys: boolean;
}

export interface Targets {
  /** Publish to Cribl Search (Lake searches). */
  search: boolean;
  /** Stream Worker Group IDs to publish to. */
  streamGroups: string[];
  /** Stream storage mode. "auto" picks disk for large tables. */
  streamMode: 'memory' | 'disk' | 'auto';
}

export interface ValidationRules {
  /** Block publishing when the row count falls by more than this percentage versus the last successful run. 0 disables. */
  maxDropPct: number;
  /** Block publishing above this many rows. */
  maxRows: number;
  /** Block publishing when any row has an empty key. Otherwise those rows are dropped with a warning. */
  blockOnEmptyKey: boolean;
}

export interface LookupDefinition {
  id: string;
  /** File name without extension, used in Stream (name.csv) and Search (name). */
  name: string;
  title: string;
  description: string;
  enrichment: EnrichmentType;
  columns: Column[];
  /** First (or only) key column. */
  keyColumn: string;
  /** All key columns when the key is composite (e.g. ["port", "protocol"]). Absent or one entry = single key. */
  keyColumns?: string[];
  matchMode: MatchMode;
  source: SourceConfig;
  fieldMap: FieldMap[];
  /** Optional sources merged into the main one, in order. The main source's values always win. */
  extraSources?: ExtraSource[];
  targets: Targets;
  validation: ValidationRules;
  /** Minutes between scheduled runs. 0 means manual only. */
  scheduleMinutes: number;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
  lastRun?: RunSummary;
  /** Where this lookup currently exists, as far as the App knows (updated after each run). */
  published?: PublishedState;
  /** Cribl Search scheduled searches the App manages for this lookup's Lake-based sources. */
  scheduling?: SchedulingState;
  /** Latest Splunk-through-worker request per source ("main" or an additional source's id). */
  workerRequests?: Record<string, WorkerRequest>;
  /** App version that last saved this definition (for future migrations). */
  savedWithVersion?: string;
}

export interface SchedulingState {
  savedSearches: { sourceKey: string; id: string; stagingLookup: string }[];
  cron?: string;
  syncedAt: number;
  error?: string;
}

/** The file name and targets where a lookup was last published successfully. */
export interface PublishedState {
  name: string;
  search: boolean;
  streamGroups: string[];
  updatedAt: number;
}

/** Row-level differences between the published lookup and a new version. */
export interface RowDiff {
  /** Where the current version was read from, e.g. "Stream: default". */
  comparedWith: string;
  added: Record<string, string>[];
  removed: Record<string, string>[];
  changed: { key: string; columns: string[]; before: Record<string, string>; after: Record<string, string> }[];
  unchanged: number;
}

export type RunStatus = 'success' | 'partial' | 'blocked' | 'failed' | 'preview';

export interface TargetResult {
  target: string;
  status: 'ok' | 'error' | 'skipped';
  detail: string;
}

export interface RunSummary {
  runId: string;
  lookupId: string;
  startedAt: number;
  finishedAt: number;
  status: RunStatus;
  rows: number;
  previousRows?: number;
  trigger: 'manual' | 'schedule' | 'preview';
  messages: string[];
  targets: TargetResult[];
  /** App version that performed the run. */
  appVersion?: string;
}

export interface Settings {
  /** Cribl Search group ID. */
  searchGroup: string;
  /** Refuse to commit a Stream group that already has other uncommitted changes. */
  blockIfPendingChanges: boolean;
  /** Default Lake staging dataset for Splunk lookup rows. */
  splunkStagingDataset: string;
  /** Dataset the diagnostics search reads one event from. Use one every App user can read. */
  diagnosticsDataset: string;
}

export const DEFAULT_SETTINGS: Settings = {
  searchGroup: 'default_search',
  blockIfPendingChanges: true,
  splunkStagingDataset: 'lookup_staging',
  diagnosticsDataset: '$vt_dummy',
};

export type Row = Record<string, unknown>;

export interface TransformResult {
  rows: Record<string, string>[];
  errors: string[];
  warnings: string[];
  stats: { input: number; output: number; duplicates: number; emptyKeys: number };
  /** Per extra source: input rows, cells filled into existing rows, rows added. */
  merges?: { label: string; input: number; filled: number; added: number }[];
}

/** Raw rows read from one extra source, with how to map and merge them. */
export interface ExtraInput {
  label: string;
  rows: Row[];
  fieldMap: FieldMap[];
  addNewKeys: boolean;
}
