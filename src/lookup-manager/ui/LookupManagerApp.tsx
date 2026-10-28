import { useCallback, useEffect, useState } from 'react';
import { listStreamGroups } from '../core/cribl';
import { describeError, removeLocations } from '../core/publish';
import { lakeSources, removeSchedules, syncSchedules } from '../core/schedule';
import { deleteDefinition, getSettings, listDefinitions, patchDefinition, saveDefinition, saveSettings } from '../core/store';
import { DEFAULT_SETTINGS, type LookupDefinition, type Settings, type TargetResult } from '../core/types';
import { Messages, TargetList } from './components';
import { LookupEditor } from './LookupEditor';
import { HelpDrawer, HelpView } from './HelpView';
import { LookupList } from './LookupList';
import { SettingsPanel } from './SettingsPanel';
import { APP_VERSION } from '../version';
import './styles.css';

type View = { kind: 'list' } | { kind: 'edit'; def?: LookupDefinition } | { kind: 'settings' } | { kind: 'help'; section?: string };

declare global {
  interface Window {
    getCriblUser?: () => Promise<{ id: string; username: string; firstName?: string }>;
  }
}

export default function LookupManagerApp() {
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [defs, setDefs] = useState<LookupDefinition[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [user, setUser] = useState<string | undefined>();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [errors, setErrors] = useState<string[]>([]);
  const [helpDrawer, setHelpDrawer] = useState<string | null>(null);
  const [activity, setActivity] = useState<{ title: string; results: TargetResult[] } | null>(null);

  const reload = useCallback(async () => {
    setDefs(await listDefinitions());
  }, []);

  useEffect(() => {
    (async () => {
      const errs: string[] = [];
      try {
        setSettings(await getSettings());
        setDefs(await listDefinitions());
      } catch (e) {
        errs.push(`Could not read saved lookups from the App KV store: ${describeError(e)}`);
      }
      try {
        setGroups((await listStreamGroups()).map((g) => g.id));
      } catch (e) {
        errs.push(`Could not list Stream worker groups: ${describeError(e)}`);
      }
      try {
        const u = await window.getCriblUser?.();
        setUser(u?.username);
      } catch {
        /* identity is optional */
      }
      setErrors(errs);
      setHydrated(true);
    })();
  }, []);

  if (!hydrated) return <div className="lm-app lm-loading">Loading Lookup Forge…</div>;

  return (
    <div className="lm-app">
      <header className="lm-header">
        <div>
          <h1>
            Lookup Forge <span className="lm-version">v{APP_VERSION}</span>
          </h1>
          <p className="lm-hint">Build enrichment lookups once and publish them to Cribl Stream and Cribl Search.</p>
        </div>
        <nav className="lm-tabs" aria-label="Lookup Forge">
          <button type="button" className={view.kind === 'list' || view.kind === 'edit' ? 'lm-tab lm-tab-active' : 'lm-tab'} onClick={() => setView({ kind: 'list' })}>
            Lookups
          </button>
          <button type="button" className={view.kind === 'help' ? 'lm-tab lm-tab-active' : 'lm-tab'} onClick={() => setView({ kind: 'help' })}>
            Help
          </button>
          <button type="button" className={view.kind === 'settings' ? 'lm-tab lm-tab-active' : 'lm-tab'} onClick={() => setView({ kind: 'settings' })}>
            Settings
          </button>
        </nav>
      </header>

      <Messages kind="error" items={errors} />
      {activity && (
        <div className="lm-panel" role="status">
          <div className="lm-row lm-between">
            <strong>{activity.title}</strong>
            <button type="button" className="lm-btn lm-btn-small" onClick={() => setActivity(null)}>
              Dismiss
            </button>
          </div>
          <TargetList targets={activity.results} />
        </div>
      )}

      <main>
        {view.kind === 'list' && (
          <LookupList
            defs={defs}
            settings={settings}
            onNew={() => setView({ kind: 'edit' })}
            onOpenGuide={(id) => setView({ kind: 'help', section: id })}
            onEdit={(def) => setView({ kind: 'edit', def })}
            onChanged={reload}
            onDelete={async (def, removePublished) => {
              try {
                const results: TargetResult[] = [];
                if (removePublished && def.published) results.push(...(await removeLocations(def.published, settings)));
                const schedErrors = await removeSchedules(def, settings);
                for (const p of def.scheduling?.savedSearches ?? [])
                  results.push({ target: 'Schedule', status: schedErrors.some((x) => x.startsWith(p.id)) ? 'error' : 'ok', detail: `Removed scheduled search ${p.id}.` });
                if (results.length) setActivity({ title: `Deleted ${def.title}`, results });
                await deleteDefinition(def.id);
                await reload();
              } catch (e) {
                setErrors([`Could not delete: ${describeError(e)}`]);
              }
            }}
          />
        )}
        {view.kind === 'edit' && (
          <LookupEditor
            key={view.def?.id ?? 'new'}
            initial={view.def}
            groups={groups}
            settings={settings}
            userName={user}
            existingNames={defs.map((d) => d.name)}
            onCancel={() => setView({ kind: 'list' })}
            onOpenGuide={(id) => setHelpDrawer(id)}
            onEditExisting={(name) => {
              const existing = defs.find((d) => d.name === name);
              if (existing) setView({ kind: 'edit', def: existing });
            }}
            onSave={async (def, cleanup) => {
              await saveDefinition(def);
              const results: TargetResult[] = [];
              // Scheduled searches for Lake-based sources (created, updated or removed to match the definition).
              if (def.scheduleMinutes > 0 || def.scheduling?.savedSearches.length) {
                const scheduling = await syncSchedules(def, settings);
                await patchDefinition(def.id, { scheduling });
                if (scheduling?.error) results.push({ target: 'Schedule', status: 'error', detail: scheduling.error });
                for (const x of scheduling?.savedSearches ?? [])
                  results.push({ target: 'Schedule', status: 'ok', detail: `Scheduled search ${x.id} (${scheduling?.cron} UTC) refreshes staging lookup ${x.stagingLookup}.` });
                if (def.scheduleMinutes === 0 && !scheduling) results.push({ target: 'Schedule', status: 'ok', detail: 'Schedule turned off; scheduled searches removed.' });
                if (def.scheduleMinutes > 0 && !lakeSources(def).length) results.push({ target: 'Schedule', status: 'ok', detail: 'Refreshed by the App backend function; no scheduled search is needed for these sources.' });
              }
              if (cleanup) {
                const cleanupResults = await removeLocations(cleanup, settings);
                const removedGroups = new Set(cleanupResults.filter((r) => r.status === 'ok' && r.target.startsWith('Stream: ')).map((r) => r.target.slice(8)));
                const searchRemoved = cleanupResults.some((r) => r.target === 'Search' && r.status === 'ok');
                const p = def.published;
                if (p) {
                  const left = { ...p, search: p.search && !(cleanup.search && searchRemoved), streamGroups: p.streamGroups.filter((g) => !(cleanup.streamGroups.includes(g) && removedGroups.has(g))) };
                  await patchDefinition(def.id, { published: left.search || left.streamGroups.length ? left : undefined });
                }
                results.push(...cleanupResults);
                setActivity({ title: `Saved ${def.title}`, results });
              } else if (results.length) setActivity({ title: `Saved ${def.title}`, results });
              await reload();
              setView({ kind: 'list' });
            }}
          />
        )}
        {view.kind === 'help' && <HelpView section={view.section} />}
        {view.kind === 'settings' && (
          <SettingsPanel
            settings={settings}
            onSave={async (s) => {
              await saveSettings(s);
              setSettings(s);
            }}
          />
        )}
      </main>
      {helpDrawer && <HelpDrawer section={helpDrawer} onClose={() => setHelpDrawer(null)} />}
    </div>
  );
}
