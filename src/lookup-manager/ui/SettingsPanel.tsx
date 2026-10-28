import { useState } from 'react';
import { kvGet, kvPut, listLookups, listStreamGroups } from '../core/cribl';
import { describeError } from '../core/publish';
import { runSearch } from '../core/sources';
import type { Settings } from '../core/types';
import { APP_VERSION } from '../version';
import { Field, Section } from './components';

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
}

declare global {
  interface Window {
    CRIBL_API_URL?: string;
  }
}

export function SettingsPanel({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState('');
  const [checks, setChecks] = useState<Check[]>([]);
  const [checking, setChecking] = useState(false);

  async function diagnose() {
    setChecking(true);
    setChecks([]);
    const add = (c: Check) => setChecks((x) => [...x, c]);
    const attempt = async (name: string, fn: () => Promise<string>, failAs: 'error' | 'warn' = 'error') => {
      try {
        add({ name, status: 'ok', detail: await fn() });
      } catch (e) {
        add({ name, status: failAs, detail: describeError(e) });
      }
    };

    await attempt('App KV store', async () => {
      const v = String(Date.now());
      await kvPut('lm-diag', v);
      if ((await kvGet('lm-diag')) !== v) throw new Error('Value read back did not match.');
      return 'Read and write work.';
    });
    let groups: string[] = [];
    await attempt('Stream worker groups', async () => {
      groups = (await listStreamGroups()).map((g) => g.id);
      return groups.length ? groups.join(', ') : 'None found.';
    });
    for (const g of groups) {
      await attempt(`Stream lookups API (${g})`, async () => `${(await listLookups(g)).length} lookup(s) visible.`);
    }
    await attempt(
      `Search lookups API (${draft.searchGroup})`,
      async () => `${(await listLookups(draft.searchGroup)).length} lookup(s) visible. CSV and API sources can publish to Search directly.`,
      'warn',
    );
    await attempt('Cribl Search jobs', async () => {
      const ds = draft.diagnosticsDataset || '$vt_dummy';
      try {
        const rows = await runSearch(`dataset="${ds}" | limit 1`, '-1h', 'now', { settings: draft, maxRows: 5, searchTimeoutMs: 60_000 });
        return `Test search on "${ds}" completed (${rows.length} row).`;
      } catch (e) {
        const msg = describeError(e);
        throw new Error(/disallowed by permissions/i.test(msg) ? `${msg} Set "Diagnostics dataset" to a dataset you can read, or check the App runs with user-based permissions.` : msg);
      }
    });
    await attempt(
      'Backend function (scheduled runs)',
      async () => {
        const res = await fetch(`${window.CRIBL_API_URL ?? ''}/endpoints/runLookups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ping' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}. Scheduled runs are unavailable; use Run now.`);
        return 'Available. Scheduled lookups run every 15 minutes when due.';
      },
      'warn',
    );
    setChecking(false);
  }

  return (
    <div>
      <h2>Settings</h2>
      <Section title="General">
        <div className="lm-grid">
          <Field label="Cribl Search group ID" hint="Usually default_search.">
            <input value={draft.searchGroup} onChange={(e) => setDraft({ ...draft, searchGroup: e.target.value })} />
          </Field>
          <Field label="Default Splunk staging dataset" hint="Lake dataset the Splunk REST Collector writes to.">
            <input value={draft.splunkStagingDataset} onChange={(e) => setDraft({ ...draft, splunkStagingDataset: e.target.value })} />
          </Field>
          <Field label="Diagnostics dataset" hint="Dataset the diagnostics search reads one event from, e.g. pan_traffic.">
            <input value={draft.diagnosticsDataset} onChange={(e) => setDraft({ ...draft, diagnosticsDataset: e.target.value })} />
          </Field>
        </div>
        <label className="lm-check">
          <input type="checkbox" checked={draft.blockIfPendingChanges} onChange={(e) => setDraft({ ...draft, blockIfPendingChanges: e.target.checked })} />
          Skip a Stream group that has other uncommitted changes (recommended — publishing commits the whole group)
        </label>
        <div className="lm-actions">
          <button
            type="button"
            className="lm-btn lm-btn-primary"
            onClick={async () => {
              setSaved('');
              try {
                await onSave(draft);
                setSaved('Saved.');
              } catch (e) {
                setSaved(`Could not save: ${describeError(e)}`);
              }
            }}
          >
            Save settings
          </button>
          {saved && <span className="lm-hint">{saved}</span>}
        </div>
      </Section>

      <Section title="Diagnostics" hint="Checks every API the App depends on, using your current permissions.">
        <button type="button" className="lm-btn" disabled={checking} onClick={diagnose}>
          {checking ? 'Checking…' : 'Run diagnostics'}
        </button>
        {checks.length > 0 && (
          <ul className="lm-checks">
            {checks.map((c) => (
              <li key={c.name}>
                <span className={`lm-dot lm-dot-${c.status === 'ok' ? 'ok' : c.status === 'warn' ? 'skipped' : 'error'}`} aria-hidden />
                <strong>{c.name}:</strong> {c.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="About">
        <p>
          Lookup Manager <strong>v{APP_VERSION}</strong>. See CHANGELOG.md in the App project for what changed in each version.
        </p>
      </Section>

      <Section title="How publishing works">
        <ul className="lm-hint">
          <li>
            <strong>Stream:</strong> the CSV is uploaded to each selected group, the lookup is created or replaced, then that group is committed and deployed.
          </li>
          <li>
            <strong>Search:</strong> uploaded through the lookups API when available; otherwise search-based lookups are written with <code>export mode=overwrite to lookup</code> (max 10,000
            rows).
          </li>
          <li>
            <strong>Safety:</strong> a run is blocked when keys are invalid, the row count exceeds the limit, or the count drops sharply against the last good run.
          </li>
        </ul>
      </Section>
    </div>
  );
}
