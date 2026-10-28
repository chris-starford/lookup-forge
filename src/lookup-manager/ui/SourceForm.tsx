// Reusable source settings and column mapping, used for the main source and every additional source.

import { useState } from 'react';
import { describeError } from '../core/publish';
import { listSplunkLookups, type SplunkLookupInfo } from '../core/splunk';
import type { Column, FieldMap, Settings, SourceConfig, SourceType, WorkerRequest } from '../core/types';
import { readCatalog, requestCatalog } from '../core/worker';
import { Field, Messages } from './components';
import { Select } from './Select';

/** Above this size the content is summarised instead of shown in an editable box. */
const LARGE_TEXT = 200 * 1024;
const formatBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
const countLines = (t: string) => {
  let n = 0;
  for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) n++;
  return n + 1;
};

/** Read an uploaded file: detect the format from its name, decompress .gz. */
export async function readUploadedFile(f: File): Promise<{ content: string; format: 'csv' | 'tsv' | 'json' | 'ndjson'; fileName: string }> {
  const gz = /\.gz$/i.test(f.name);
  const base = f.name.replace(/\.gz$/i, '');
  let text: string;
  if (gz) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress .gz files. Decompress it first.');
    text = await new Response(f.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else text = await f.text();
  const ext = (base.split('.').pop() ?? '').toLowerCase();
  const format = ext === 'tsv' ? 'tsv' : ext === 'json' ? (text.trimStart().startsWith('[') ? 'json' : 'ndjson') : ext === 'ndjson' || ext === 'jsonl' ? 'ndjson' : 'csv';
  return { content: text, format, fileName: f.name };
}

export const SOURCE_LABELS: Record<SourceType, string> = {
  search: 'Cribl Search query (Lake data)',
  http: 'HTTP(S) API',
  csv: 'File or pasted data (CSV, TSV, JSON, NDJSON, .gz)',
  splunk_staging: 'Splunk lookup via Lake staging (laptop / hybrid worker)',
  splunk_rest: 'Splunk (direct REST API, e.g. Splunk Cloud): lookup file or SPL query',
  splunk_worker: "Splunk through a Stream worker (for a Splunk Cribl.Cloud can't reach): lookup file or SPL query",
};

export function blankSource(type: SourceType, settings: Settings): SourceConfig {
  switch (type) {
    case 'search':
      return { type, query: 'dataset="your_dataset"\n| summarize count() by your_key', earliest: '-24h', latest: 'now' };
    case 'http':
      return { type, url: 'https://', method: 'GET', format: 'json', dataPath: '' };
    case 'csv':
      return { type, content: '' };
    case 'splunk_staging':
      return { type, dataset: settings.splunkStagingDataset, splunkLookup: '', earliest: '-24h' };
    case 'splunk_rest':
      return { type, baseUrl: 'https://YOUR_STACK.splunkcloud.com:8089', mode: 'lookup', splunkLookup: '', spl: '', earliest: '-24h', latest: 'now' };
    case 'splunk_worker':
      return {
        type,
        group: '',
        collectorId: 'splunk_lookup_template',
        dataset: settings.splunkStagingDataset,
        mode: 'lookup',
        splunkLookup: '',
        spl: '',
        earliest: '-24h',
        latest: 'now',
      };
  }
}

export function SourceForm({
  src,
  settings,
  onChange,
  idPrefix = 'src',
  workerRequest,
  onRequestWorker,
  groups = [],
}: {
  src: SourceConfig;
  settings: Settings;
  onChange: (next: SourceConfig) => void;
  idPrefix?: string;
  /** Latest Splunk-through-worker request for this source. */
  workerRequest?: WorkerRequest;
  /** Start a Splunk-through-worker request for this source. */
  onRequestWorker?: () => Promise<void>;
  /** Stream Worker Groups, for the Splunk-through-worker group picker. */
  groups?: string[];
}) {
  const [splunkList, setSplunkList] = useState<SplunkLookupInfo[] | null>(null);
  const [catalog, setCatalog] = useState<SplunkLookupInfo[] | null>(null);
  const [catalogMsg, setCatalogMsg] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMsg, setRequestMsg] = useState('');
  const [fileError, setFileError] = useState('');
  const [splunkListError, setSplunkListError] = useState('');
  const [splunkFilter, setSplunkFilter] = useState('');
  const [splunkListBusy, setSplunkListBusy] = useState(false);
  const setSource = (patch: Partial<SourceConfig>) => onChange({ ...src, ...patch } as SourceConfig);

  return (
    <>
        <Field label="Source type">
          <Select
            label="Source type"
            value={src.type}
            onChange={(v) => onChange(blankSource(v, settings))}
            options={(Object.keys(SOURCE_LABELS) as SourceType[]).map((t) => ({ value: t, label: SOURCE_LABELS[t] }))}
          />
        </Field>

        {src.type === 'search' && (
          <>
            <Field label="Cribl Search query" hint="Write it as you would in Cribl Search. The app adds the column mapping and, if needed, the export to Search.">
              <textarea rows={6} className="lm-code" value={src.query} onChange={(e) => setSource({ query: e.target.value })} />
            </Field>
            <div className="lm-grid">
              <Field label="Earliest">
                <input value={src.earliest} onChange={(e) => setSource({ earliest: e.target.value })} />
              </Field>
              <Field label="Latest">
                <input value={src.latest} onChange={(e) => setSource({ latest: e.target.value })} />
              </Field>
            </div>
          </>
        )}

        {src.type === 'http' && (
          <>
            <Field label="URL" hint="The host must be in proxies.yml or authorized by an administrator (App Settings > External API Access). Credentials are injected by the proxy, never typed here.">
              <input value={src.url} onChange={(e) => setSource({ url: e.target.value })} />
            </Field>
            <div className="lm-grid">
              <Field label="Method">
                <Select
                  label="Method"
                  value={src.method}
                  onChange={(v) => setSource({ method: v })}
                  options={[
                    { value: 'GET', label: 'GET' },
                    { value: 'POST', label: 'POST' },
                  ]}
                />
              </Field>
              <Field label="Response format">
                <Select
                  label="Response format"
                  value={src.format}
                  onChange={(v) => setSource({ format: v })}
                  options={[
                    { value: 'json', label: 'JSON' },
                    { value: 'ndjson', label: 'NDJSON' },
                    { value: 'csv', label: 'CSV' },
                  ]}
                />
              </Field>
              {src.format === 'json' && (
                <Field label="Records path" hint='Field holding the list, e.g. "result" or "data.items". Empty if the response is a list.'>
                  <input value={src.dataPath ?? ''} onChange={(e) => setSource({ dataPath: e.target.value })} />
                </Field>
              )}
            </div>
            {src.method === 'POST' && (
              <Field label="Request body (JSON)">
                <textarea rows={4} className="lm-code" value={src.body ?? ''} onChange={(e) => setSource({ body: e.target.value })} />
              </Field>
            )}
          </>
        )}

        {src.type === 'csv' && (
          <>
            <div className="lm-grid">
              <Field label="Format">
                <Select
                  label="Format"
                  value={src.format ?? 'csv'}
                  onChange={(v) => setSource({ format: v })}
                  options={[
                    { value: 'csv', label: 'CSV (comma-separated, first line is the header)' },
                    { value: 'tsv', label: 'TSV (tab-separated, first line is the header)' },
                    { value: 'json', label: 'JSON (an array of objects)' },
                    { value: 'ndjson', label: 'NDJSON / JSON Lines (one object per line)' },
                  ]}
                />
              </Field>
              <Field label="Upload a file" hint="CSV, TSV, JSON or NDJSON; .gz files are decompressed in the browser.">
                <input
                  type="file"
                  aria-label="Upload a lookup file"
                  accept=".csv,.tsv,.txt,.json,.ndjson,.jsonl,.gz,text/csv,application/json"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setFileError('');
                    try {
                      setSource(await readUploadedFile(f));
                    } catch (err) {
                      setFileError(describeError(err));
                    }
                  }}
                />
              </Field>
            </div>
            {fileError && <Messages kind="error" items={[fileError]} />}
            {src.content.length > LARGE_TEXT ? (
              <div className="lm-panel" role="status">
                <strong>{src.fileName ?? 'Content'}</strong> · {formatBytes(src.content.length)} · about {countLines(src.content).toLocaleString()} lines
                <p className="lm-hint">Too large to edit here; upload a new file to replace it. First lines:</p>
                <pre className="lm-code lm-pre">{src.content.slice(0, 1200)}</pre>
              </div>
            ) : (
              <Field label="Content" hint="Paste the content, or upload a file above.">
                <textarea rows={8} className="lm-code" value={src.content} onChange={(e) => setSource({ content: e.target.value })} />
              </Field>
            )}
          </>
        )}

        {src.type === 'splunk_staging' && (
          <>
            <p className="lm-hint">
              Rows are written to a Lake dataset by a Stream REST Collector on a worker that can reach Splunk (for example a hybrid worker on the same network as Splunk). Each
              event needs <code>splunk_lookup</code> and <code>sync_id</code> fields. Only the latest sync is used. See the README for the collector setup.
            </p>
            <div className="lm-grid">
              <Field label="Lake dataset">
                <input value={src.dataset} onChange={(e) => setSource({ dataset: e.target.value })} />
              </Field>
              <Field label="Splunk lookup name" hint="As written to splunk_lookup, e.g. assets_by_str">
                <input value={src.splunkLookup} onChange={(e) => setSource({ splunkLookup: e.target.value })} />
              </Field>
              <Field label="Look back">
                <input value={src.earliest} onChange={(e) => setSource({ earliest: e.target.value })} />
              </Field>
            </div>
          </>
        )}

        {src.type === 'splunk_rest' && (
          <>
            <p className="lm-hint">
              Calls Splunk's REST API directly. The Splunk host must be authorized for this App with its token injected by the proxy (see README). Cribl.Cloud cannot reach a
              Splunk running on a laptop; for that, use the Lake staging source.
            </p>
            <Field label="Splunk management URL" hint="Usually port 8089, e.g. https://acme.splunkcloud.com:8089">
              <input value={src.baseUrl} onChange={(e) => setSource({ baseUrl: e.target.value })} />
            </Field>
            <div className="lm-row" role="radiogroup" aria-label="Splunk source mode">
              <label className="lm-check">
                <input type="radio" name={`${idPrefix}-splunk-mode`} checked={(src.mode ?? 'lookup') === 'lookup'} onChange={() => setSource({ mode: 'lookup' })} />
                Existing Splunk lookup
              </label>
              <label className="lm-check">
                <input type="radio" name={`${idPrefix}-splunk-mode`} checked={src.mode === 'spl'} onChange={() => setSource({ mode: 'spl' })} />
                Splunk search (SPL) results
              </label>
            </div>

            {(src.mode ?? 'lookup') === 'lookup' ? (
              <>
                <div className="lm-row">
                  <Field label="Splunk lookup" hint="Lookup file (e.g. cmdb_assets.csv) or lookup definition (including KV-store lookups)">
                    <input value={src.splunkLookup} onChange={(e) => setSource({ splunkLookup: e.target.value })} />
                  </Field>
                  <button
                    type="button"
                    className="lm-btn"
                    disabled={splunkListBusy}
                    onClick={async () => {
                      setSplunkListBusy(true);
                      setSplunkListError('');
                      try {
                        setSplunkList(await listSplunkLookups(src.baseUrl));
                      } catch (e) {
                        setSplunkListError(describeError(e));
                      } finally {
                        setSplunkListBusy(false);
                      }
                    }}
                  >
                    {splunkListBusy ? 'Loading…' : 'Browse Splunk lookups'}
                  </button>
                </div>
                {splunkListError && <Messages kind="error" items={[splunkListError]} />}
                {splunkList && (
                  <LookupPicker
                    list={splunkList}
                    filter={splunkFilter}
                    onFilter={setSplunkFilter}
                    onUse={(name) => {
                      setSource({ splunkLookup: name });
                      setSplunkList(null);
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <Field label="Splunk search (SPL)" hint='Any search that returns a table, e.g. "index=assets | stats latest(os) as os by ip, host". A leading "search" is added when needed.'>
                  <textarea rows={5} className="lm-code" value={src.spl ?? ''} onChange={(e) => setSource({ spl: e.target.value })} />
                </Field>
                <div className="lm-grid">
                  <Field label="Earliest">
                    <input value={src.earliest ?? '-24h'} onChange={(e) => setSource({ earliest: e.target.value })} />
                  </Field>
                  <Field label="Latest">
                    <input value={src.latest ?? 'now'} onChange={(e) => setSource({ latest: e.target.value })} />
                  </Field>
                </div>
              </>
            )}
          </>
        )}

        {src.type === 'splunk_worker' && (
          <>
            <p className="lm-hint">
              For a Splunk that Cribl.Cloud cannot reach (for example on a private network or a laptop). The App starts a one-off run of a saved REST Collector on a worker that can reach Splunk;
              the rows arrive in the Lake staging dataset, usually 5–20 minutes later. Set up the collector template as in docs/SPLUNK_SYNC.md, Part 2.
            </p>
            <div className="lm-grid">
              <Field label="Worker Group" hint="A group whose workers can reach Splunk, often a hybrid group on the same network.">
                {groups.length ? (
                  <Select
                    label="Worker Group"
                    value={src.group}
                    onChange={(v) => setSource({ group: v })}
                    options={[{ value: '', label: 'Choose a Worker Group…' }, ...groups.map((g) => ({ value: g, label: g }))]}
                  />
                ) : (
                  <input value={src.group} onChange={(e) => setSource({ group: e.target.value })} />
                )}
              </Field>
              <Field label="Collector template ID" hint="Saved REST Collector with a search request parameter">
                <input value={src.collectorId} onChange={(e) => setSource({ collectorId: e.target.value })} />
              </Field>
              <Field label="Staging dataset">
                <input value={src.dataset} onChange={(e) => setSource({ dataset: e.target.value })} />
              </Field>
            </div>
            <div className="lm-row" role="radiogroup" aria-label="Splunk worker source mode">
              <label className="lm-check">
                <input type="radio" name={`${idPrefix}-worker-mode`} checked={src.mode === 'lookup'} onChange={() => setSource({ mode: 'lookup' })} />
                Existing Splunk lookup
              </label>
              <label className="lm-check">
                <input type="radio" name={`${idPrefix}-worker-mode`} checked={src.mode === 'spl'} onChange={() => setSource({ mode: 'spl' })} />
                Splunk search (SPL) results
              </label>
            </div>
            {src.mode === 'lookup' ? (
              <>
                <Field label="Splunk lookup name" hint="Lookup file or definition, e.g. cmdb_assets.csv">
                  <input value={src.splunkLookup} onChange={(e) => setSource({ splunkLookup: e.target.value })} />
                </Field>
                <div className="lm-row">
                  <button
                    type="button"
                    className="lm-btn lm-btn-small"
                    disabled={catalogBusy}
                    onClick={async () => {
                      setCatalogBusy(true);
                      setCatalogMsg('');
                      try {
                        const req = await requestCatalog(src.group, src.collectorId);
                        setCatalogMsg(`Lookup list requested from Splunk (sync ${req.syncId}). Use “Show lookup list” in 5–20 minutes.`);
                      } catch (e) {
                        setCatalogMsg(describeError(e));
                      } finally {
                        setCatalogBusy(false);
                      }
                    }}
                  >
                    Request lookup list from Splunk
                  </button>
                  <button
                    type="button"
                    className="lm-btn lm-btn-small"
                    disabled={catalogBusy}
                    onClick={async () => {
                      setCatalogBusy(true);
                      setCatalogMsg('');
                      try {
                        setCatalog(await readCatalog(src.group, src.dataset, settings));
                      } catch (e) {
                        setCatalogMsg(describeError(e));
                      } finally {
                        setCatalogBusy(false);
                      }
                    }}
                  >
                    Show lookup list
                  </button>
                </div>
                {catalogMsg && <p className="lm-hint" role="status">{catalogMsg}</p>}
                {catalog && (
                  <LookupPicker
                    list={catalog}
                    filter={splunkFilter}
                    onFilter={setSplunkFilter}
                    onUse={(name) => {
                      setSource({ splunkLookup: name });
                      setCatalog(null);
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <Field label="Splunk search (SPL)" hint="Any search that returns a table.">
                  <textarea rows={5} className="lm-code" value={src.spl ?? ''} onChange={(e) => setSource({ spl: e.target.value })} />
                </Field>
                <div className="lm-grid">
                  <Field label="Earliest">
                    <input value={src.earliest ?? '-24h'} onChange={(e) => setSource({ earliest: e.target.value })} />
                  </Field>
                  <Field label="Latest">
                    <input value={src.latest ?? 'now'} onChange={(e) => setSource({ latest: e.target.value })} />
                  </Field>
                </div>
              </>
            )}
            {onRequestWorker && (
              <div className="lm-panel">
                <div className="lm-row">
                  <button
                    type="button"
                    className="lm-btn"
                    disabled={requestBusy}
                    onClick={async () => {
                      setRequestBusy(true);
                      setRequestMsg('');
                      try {
                        await onRequestWorker();
                      } catch (e) {
                        setRequestMsg(describeError(e));
                      } finally {
                        setRequestBusy(false);
                      }
                    }}
                  >
                    {requestBusy ? 'Requesting…' : 'Request from Splunk now'}
                  </button>
                  <span className="lm-hint" role="status">
                    {workerRequest
                      ? `Last requested ${new Date(workerRequest.requestedAt).toLocaleString()} (sync ${workerRequest.syncId}). Preview uses that request's rows once they reach Lake.`
                      : 'Not requested yet.'}
                  </span>
                </div>
                {requestMsg && <Messages kind="error" items={[requestMsg]} />}
              </div>
            )}
          </>
        )}

    </>
  );
}

export function FieldMapTable({
  columns,
  keyColumns,
  fieldMap,
  fields,
  listId,
  onChange,
}: {
  columns: Column[];
  keyColumns: string[];
  fieldMap: FieldMap[];
  fields: string[];
  listId: string;
  onChange: (next: FieldMap[]) => void;
}) {
  const value = (col: string) => fieldMap.find((m) => m.column === col)?.source ?? '';
  const setValue = (col: string, source: string) => onChange([...fieldMap.filter((m) => m.column !== col), ...(source ? [{ column: col, source }] : [])]);
  return (
    <>
      <datalist id={listId}>
        {fields.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <table className="lm-table lm-map">
        <thead>
          <tr>
            <th>Column</th>
            <th>Source field or =value</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.name}>
              <td>
                {c.name}
                {keyColumns.includes(c.name) && <span className="lm-tag">key</span>}
              </td>
              <td>
                <input list={listId} aria-label={`Map ${c.name}`} placeholder={c.name} value={value(c.name)} onChange={(e) => setValue(c.name, e.target.value)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function LookupPicker({ list, filter, onFilter, onUse }: { list: SplunkLookupInfo[]; filter: string; onFilter: (v: string) => void; onUse: (name: string) => void }) {
  return (
    <div className="lm-panel">
      <div className="lm-row lm-between">
        <strong>{list.length} lookup(s) in Splunk</strong>
        <input placeholder="Filter" aria-label="Filter Splunk lookups" value={filter} onChange={(e) => onFilter(e.target.value)} style={{ maxWidth: 260 }} />
      </div>
      <div className="lm-table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
        <table className="lm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>App</th>
              <th>Owner / sharing</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list
              .filter((l) => !filter || `${l.name} ${l.app ?? ''} ${l.detail ?? ''}`.toLowerCase().includes(filter.toLowerCase()))
              .map((l) => (
                <tr key={`${l.kind}:${l.app}:${l.name}`}>
                  <td>
                    {l.name}
                    {l.detail && <div className="lm-hint">{l.detail}</div>}
                  </td>
                  <td>{l.kind === 'file' ? 'File' : 'Definition'}</td>
                  <td>{l.app ?? '—'}</td>
                  <td>
                    {l.owner ?? '—'}
                    {l.sharing ? ` / ${l.sharing}` : ''}
                  </td>
                  <td>
                    <button type="button" className="lm-btn lm-btn-small" aria-label={`Use ${l.name}`} onClick={() => onUse(l.name)}>
                      Use
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
