import { useEffect, useState } from 'react';
import { runLookup } from '../core/runner';
import { describeError, fileNameFor } from '../core/publish';
import { listRuns } from '../core/store';
import { getTemplate } from '../core/templates';
import type { LookupDefinition, RunSummary, Settings } from '../core/types';
import { usageFor } from '../core/usage';
import { CodeBlock, fmtTime, Messages, StatusBadge, TargetList } from './components';
import { HELP } from './help';

const SOURCE_SHORT: Record<string, string> = {
  search: 'Cribl Search',
  http: 'HTTP API',
  csv: 'CSV',
  splunk_staging: 'Splunk (staging)',
  splunk_rest: 'Splunk REST',
};

interface Props {
  defs: LookupDefinition[];
  settings: Settings;
  onEdit: (def: LookupDefinition) => void;
  /** removePublished: also delete the lookup from where it was published. */
  onDelete: (def: LookupDefinition, removePublished: boolean) => Promise<void>;
  onNew: () => void;
  onChanged: () => Promise<void>;
  onOpenGuide?: (id: string) => void;
}

export function LookupList({ defs, settings, onEdit, onDelete, onNew, onChanged, onOpenGuide }: Props) {
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<RunSummary | null>(null);
  const [historyFor, setHistoryFor] = useState<LookupDefinition | null>(null);
  const [usageOf, setUsageOf] = useState<LookupDefinition | null>(null);
  const [error, setError] = useState('');

  async function run(def: LookupDefinition) {
    setRunning(def.id);
    setProgress([]);
    setResult(null);
    setError('');
    try {
      const r = await runLookup(def, settings, 'manual', (m) => setProgress((p) => [...p, m]));
      setResult(r);
      await onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRunning(null);
    }
  }

  if (historyFor) return <RunHistory def={historyFor} onBack={() => setHistoryFor(null)} />;

  return (
    <div>
      <div className="lm-row lm-between">
        <h2>Lookups</h2>
        <button type="button" className="lm-btn lm-btn-primary" onClick={onNew}>
          New lookup
        </button>
      </div>

      {defs.length > 0 && <SummaryBar defs={defs} />}
      {defs.length === 0 ? (
        <div className="lm-empty">
          <p>No lookups yet.</p>
          <p className="lm-hint lm-lead">{HELP.overview}</p>
          <ol className="lm-steps">
            {HELP.gettingStarted.map((g, i) => (
              <li key={g.title}>
                <span className="lm-step-num">{i + 1}</span>
                <div>
                  <strong>{g.title}</strong>
                  <div className="lm-hint">{g.text}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="lm-row lm-center">
            <button type="button" className="lm-btn lm-btn-primary" onClick={onNew}>
              Create your first lookup
            </button>
            {onOpenGuide && (
              <button type="button" className="lm-btn" onClick={() => onOpenGuide('quick-start')}>
                Read the quick start
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="lm-table-wrap">
          <table className="lm-table">
            <thead>
              <tr>
                <th>Lookup</th>
                <th>Type</th>
                <th>Source</th>
                <th>Publishes to</th>
                <th>Schedule</th>
                <th>Last run</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {defs.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.title}</strong>
                    <div className="lm-hint">{fileNameFor(d)}</div>
                  </td>
                  <td>{getTemplate(d.enrichment).label}</td>
                  <td>{SOURCE_SHORT[d.source.type]}</td>
                  <td>
                    {[d.targets.search ? 'Search' : null, ...d.targets.streamGroups].filter(Boolean).join(', ') || '—'}
                    {d.published && d.published.name !== d.name && <div className="lm-hint">Still published as {d.published.name}.csv</div>}
                  </td>
                  <td>
                    {d.scheduleMinutes ? `Every ${d.scheduleMinutes >= 60 ? `${d.scheduleMinutes / 60} h` : `${d.scheduleMinutes} min`}` : 'Manual'}
                    {d.scheduling?.error && <div className="lm-hint lm-err-text">Schedule not set up — edit to see why</div>}
                  </td>
                  <td>
                    <StatusBadge status={d.lastRun?.status} />
                    {d.lastRun && (
                      <div className="lm-hint">
                        {d.lastRun.rows} rows · {fmtTime(d.lastRun.finishedAt)}
                      </div>
                    )}
                  </td>
                  <td className="lm-nowrap">
                    <button type="button" className="lm-btn lm-btn-primary lm-btn-small" disabled={!!running} onClick={() => run(d)}>
                      {running === d.id ? 'Running…' : 'Run now'}
                    </button>{' '}
                    <button type="button" className="lm-btn lm-btn-small" onClick={() => onEdit(d)}>
                      Edit
                    </button>{' '}
                    <button type="button" className="lm-btn lm-btn-small" onClick={() => setHistoryFor(d)}>
                      History
                    </button>{' '}
                    <button type="button" className="lm-btn lm-btn-small" onClick={() => setUsageOf(usageOf?.id === d.id ? null : d)}>
                      Use
                    </button>{' '}
                    <DeleteButton def={d} onDelete={onDelete} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lm-hint">When deleting, you can keep the published lookups or remove them from Search and the Stream groups.</p>
        </div>
      )}

      {usageOf && <UsagePanel def={usageOf} onClose={() => setUsageOf(null)} />}

      {running && (
        <div className="lm-panel" aria-live="polite">
          <strong>Running…</strong>
          <ul className="lm-log">
            {progress.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <Messages kind="error" items={[error]} />}
      {result && (
        <div className="lm-panel">
          <div className="lm-row">
            <strong>Result:</strong> <StatusBadge status={result.status} /> <span>{result.rows} rows</span>
          </div>
          <TargetList targets={result.targets} />
          <details>
            <summary>Run log</summary>
            <ul className="lm-log">
              {result.messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

function RunHistory({ def, onBack }: { def: LookupDefinition; onBack: () => void }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    listRuns(def.id).then(setRuns, (e) => setError(describeError(e)));
  }, [def.id]);

  return (
    <div>
      <div className="lm-row lm-between">
        <h2>History: {def.title}</h2>
        <button type="button" className="lm-btn" onClick={onBack}>
          Back
        </button>
      </div>
      {error && <Messages kind="error" items={[error]} />}
      {runs === null ? (
        <p>Loading…</p>
      ) : runs.length === 0 ? (
        <p className="lm-hint">No runs yet.</p>
      ) : (
        runs.map((r) => (
          <div key={r.runId} className="lm-panel">
            <div className="lm-row">
              <StatusBadge status={r.status} />
              <span>{fmtTime(r.finishedAt)}</span>
              <span className="lm-hint">
                {r.trigger} · {r.rows} rows{r.previousRows !== undefined ? ` (previously ${r.previousRows})` : ''} · {((r.finishedAt - r.startedAt) / 1000).toFixed(1)} s
                {r.appVersion ? ` · v${r.appVersion}` : ''}
              </span>
            </div>
            <TargetList targets={r.targets} />
            <details>
              <summary>Log</summary>
              <ul className="lm-log">
                {r.messages.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </details>
          </div>
        ))
      )}
    </div>
  );
}

function DeleteButton({ def, onDelete }: { def: LookupDefinition; onDelete: (d: LookupDefinition, removePublished: boolean) => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const p = def.published;
  const where = p ? [p.search ? 'Search' : null, ...p.streamGroups].filter(Boolean).join(', ') : '';
  if (!asking)
    return (
      <button type="button" className="lm-btn lm-btn-small lm-btn-danger-ghost" onClick={() => setAsking(true)}>
        Delete
      </button>
    );
  return (
    <span className="lm-confirm">
      {p && (
        <button type="button" className="lm-btn lm-btn-small lm-btn-danger" title={`Remove ${p.name}.csv from ${where}`} onClick={() => { setAsking(false); onDelete(def, true); }}>
          Delete and remove from {where}
        </button>
      )}
      <button type="button" className="lm-btn lm-btn-small lm-btn-danger" onClick={() => { setAsking(false); onDelete(def, false); }}>
        {p ? 'Delete definition only' : 'Delete definition'}
      </button>
      <button type="button" className="lm-btn lm-btn-small" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

function SummaryBar({ defs }: { defs: LookupDefinition[] }) {
  const failing = defs.filter((d) => d.lastRun && (d.lastRun.status === 'failed' || d.lastRun.status === 'blocked' || d.lastRun.status === 'partial')).length;
  const scheduled = defs.filter((d) => d.scheduleMinutes > 0).length;
  const rows = defs.reduce((n, d) => n + (d.lastRun?.rows ?? 0), 0);
  const stat = (label: string, value: string | number, tone = '') => (
    <div className={`lm-stat ${tone}`}>
      <div className="lm-stat-value">{value}</div>
      <div className="lm-hint">{label}</div>
    </div>
  );
  return (
    <div className="lm-stats" aria-label="Summary">
      {stat('Lookups', defs.length)}
      {stat('Scheduled', scheduled)}
      {stat('Rows published', rows.toLocaleString())}
      {stat('Need attention', failing, failing ? 'lm-stat-warn' : '')}
    </div>
  );
}

function UsagePanel({ def, onClose }: { def: LookupDefinition; onClose: () => void }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const u = usageFor(def, fields);
  return (
    <div className="lm-panel" aria-label={`Use ${def.title}`}>
      <div className="lm-row lm-between">
        <strong>Use “{def.title}” in Stream and Search</strong>
        <button type="button" className="lm-btn lm-btn-small" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="lm-grid">
        {u.inFields.map((f) => (
          <label key={f.lookupField} className="lm-field">
            <span className="lm-label">Event field matched to “{f.lookupField}”</span>
            <input value={f.eventField} onChange={(e) => setFields({ ...fields, [f.lookupField]: e.target.value })} />
          </label>
        ))}
      </div>
      <CodeBlock label="Cribl Stream: Lookup function (pipeline JSON)" code={JSON.stringify(u.streamFunction, null, 2)} />
      <CodeBlock label="Cribl Search: enrich results" code={u.searchQuery} />
      <ul className="lm-hint">
        {u.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
