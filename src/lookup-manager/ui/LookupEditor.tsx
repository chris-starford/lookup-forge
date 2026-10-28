import { useMemo, useState } from 'react';
import { previewLookup, type PreviewResult } from '../core/runner';
import { diffSummary } from '../core/diff';
import { describeError, fileNameFor, staleLocations } from '../core/publish';
import { getTemplate, TEMPLATES, type EnrichmentTemplate } from '../core/templates';
import type { Column, ExtraSource, LookupDefinition, RowDiff, Settings } from '../core/types';
import { downloadText, Field, Messages, PreviewTable, Section } from './components';
import { GUIDE_FOR } from './guide';
import { HELP } from './help';
import { Select } from './Select';
import { blankSource, FieldMapTable, SourceForm } from './SourceForm';
import { keyLabel, keysOf } from '../core/keys';
import { lakeSources } from '../core/schedule';
import { patchDefinition } from '../core/store';
import { requestWorkerSync } from '../core/worker';

interface Props {
  initial?: LookupDefinition;
  groups: string[];
  settings: Settings;
  existingNames: string[];
  userName?: string;
  /** cleanup: old file name / targets to remove after saving (rename or deselected targets). */
  onSave: (def: LookupDefinition, cleanup: { name: string; search: boolean; streamGroups: string[] } | null) => Promise<void>;
  onCancel: () => void;
  /** Open the existing definition that already uses this file name. */
  onEditExisting?: (name: string) => void;
  /** Open a guide topic in the side panel. */
  onOpenGuide?: (id: string) => void;
}

const SCHEDULES = [
  { v: 0, label: 'Manual only' },
  { v: 15, label: 'Every 15 minutes' },
  { v: 60, label: 'Hourly' },
  { v: 360, label: 'Every 6 hours' },
  { v: 1440, label: 'Daily' },
];

/** keyColumn (first key) plus keyColumns (only when composite). */
function keysPatch(keys: string[], columns: Column[]): Pick<LookupDefinition, 'keyColumn' | 'keyColumns'> {
  const valid = keys.filter((k) => columns.some((c) => c.name === k));
  const list = valid.length ? valid : columns[0] ? [columns[0].name] : [];
  return { keyColumn: list[0] ?? '', keyColumns: list.length > 1 ? list : undefined };
}

function fromTemplate(t: EnrichmentTemplate, groups: string[], userName?: string): LookupDefinition {
  const ex = t.examples[0];
  // Keep the template's file name even if it is taken: the editor then offers to edit the existing lookup instead.
  const name = t.defaultName;
  const now = Date.now();
  return {
    id: `${name}-${now.toString(36)}`,
    name,
    title: t.label,
    description: t.summary,
    enrichment: t.type,
    columns: t.columns.map((c) => ({ ...c })),
    keyColumn: t.keyColumn,
    keyColumns: t.keyColumns ? [...t.keyColumns] : undefined,
    matchMode: t.matchMode,
    source: structuredClone(ex.source),
    fieldMap: ex.fieldMap.map((m) => ({ ...m })),
    extraSources: ex.extraSources ? structuredClone(ex.extraSources) : undefined,
    targets: { search: true, streamGroups: groups.includes('default') ? ['default'] : [], streamMode: 'auto' },
    validation: { maxDropPct: 50, maxRows: 10000, blockOnEmptyKey: false },
    scheduleMinutes: 0,
    createdBy: userName,
    createdAt: now,
    updatedAt: now,
  };
}

export function LookupEditor({ initial, groups, settings, existingNames, userName, onSave, onCancel, onEditExisting, onOpenGuide }: Props) {
  const [draft, setDraft] = useState<LookupDefinition | null>(initial ? structuredClone(initial) : null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [removeStale, setRemoveStale] = useState(true);
  const [mappingNote, setMappingNote] = useState('');

  const template = useMemo(() => (draft ? getTemplate(draft.enrichment) : null), [draft?.enrichment]);
  const otherNames = existingNames.filter((n) => n !== initial?.name);

  if (!draft) {
    return (
      <div>
        <h2>New lookup: choose the kind of enrichment</h2>
        <p className="lm-hint">Each template sets up suggested columns, a key and example sources. You can change all of it on the next screen.</p>
        <div className="lm-cards">
          {TEMPLATES.map((t) => (
            <button key={t.type} type="button" className="lm-card" onClick={() => setDraft(fromTemplate(t, groups, userName))}>
              <strong>{t.label}</strong>
              <span>{t.summary}</span>
              <span className="lm-hint">Key: {(t.keyColumns ?? [t.keyColumn]).join(' + ')} · {t.matchMode.toUpperCase()} match</span>
            </button>
          ))}
        </div>
        <div className="lm-actions">
          <button type="button" className="lm-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const set = (patch: Partial<LookupDefinition>) => setDraft({ ...draft, ...patch });

  /** Start a Splunk-through-worker request; remember it on the draft and, if the lookup is saved, in the store. */
  async function requestFor(key: string, source: LookupDefinition['source']) {
    if (source.type !== 'splunk_worker') return;
    const req = await requestWorkerSync(source, draft!.name);
    const workerRequests = { ...(draft!.workerRequests ?? {}), [key]: req };
    setDraft((d) => (d ? { ...d, workerRequests } : d));
    if (initial) await patchDefinition(initial.id, { workerRequests });
  }

  const setColumns = (columns: Column[]) => {
    const names = new Set(columns.map((c) => c.name));
    set({
      columns,
      fieldMap: draft.fieldMap.filter((m) => names.has(m.column)),
      ...keysPatch(keysOf(draft).filter((k) => names.has(k)), columns),
    });
  };

  async function runPreview() {
    setBusy(true);
    setPreview(null);
    setPreviewError('');
    setProgress([]);
    try {
      setPreview(await previewLookup(draft!, settings, (m) => setProgress((p) => [...p, m])));
    } catch (e) {
      setPreviewError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const errs: string[] = [];
    if (!draft!.title.trim()) errs.push('Give the lookup a title.');
    if (!/^[a-z][a-z0-9_]{1,62}$/.test(draft!.name)) errs.push('File name must start with a lowercase letter and use only lowercase letters, digits and underscores.');
    if (otherNames.includes(draft!.name)) errs.push(`Another lookup already uses the file name "${draft!.name}".`);
    if (!keysOf(draft!).every((k) => draft!.columns.some((c) => c.name === k))) errs.push('Choose a key column.');
    if (keysOf(draft!).length > 1 && draft!.matchMode !== 'exact') errs.push('A key made of several columns needs Exact match.');
    if (!draft!.targets.search && draft!.targets.streamGroups.length === 0) errs.push('Choose at least one target: Search or a Stream group.');
    setSaveErrors(errs);
    if (errs.length) return;
    setBusy(true);
    try {
      const next = { ...draft!, updatedAt: Date.now() };
      await onSave(next, removeStale ? staleLocations(initial, next) : null);
    } catch (e) {
      setSaveErrors([`Could not save: ${describeError(e)}`]);
    } finally {
      setBusy(false);
    }
  }

  const src = draft.source;
  const fields = preview?.sourceFields ?? [];

  return (
    <div className="lm-editor">
      <h2>{initial ? `Edit: ${initial.title}` : `New lookup: ${template?.label ?? ''}`}</h2>

      <Section title="1. Basics" help={HELP.basics} guide={GUIDE_FOR.basics} onGuide={onOpenGuide}>
        <div className="lm-grid">
          <Field label="Title">
            <input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="File name" hint={`Stream: ${fileNameFor(draft)} · Search: ${draft.name}`}>
            <input value={draft.name} onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
          </Field>
        </div>
        {otherNames.includes(draft.name) && (
          <div className="lm-msg lm-msg-warning" role="status">
            Another lookup already uses the file name <code>{draft.name}</code>. Give this one a different file name, or{' '}
            {onEditExisting ? (
              <button type="button" className="lm-btn lm-btn-small" onClick={() => onEditExisting(draft.name)}>
                edit the existing lookup
              </button>
            ) : (
              'edit the existing lookup'
            )}{' '}
            to change its source instead.
          </div>
        )}
        <Field label="Description">
          <input value={draft.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        {template && (
          <p className="lm-hint">
            <strong>In Stream:</strong> {template.streamUse} <strong>In Search:</strong> {template.searchUse}
          </p>
        )}
      </Section>

      <Section title="2. Columns and key" hint="The key column(s) are what events are matched on. The same columns are used in Stream and Search." help={HELP.columns} guide={GUIDE_FOR.columns} onGuide={onOpenGuide}>
        <table className="lm-table lm-columns">
          <thead>
            <tr>
              <th>Key</th>
              <th>Column</th>
              <th>Description</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.columns.map((c, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Use ${c.name} as key`}
                    checked={keysOf(draft).includes(c.name)}
                    onChange={(e) => {
                      const current = keysOf(draft);
                      const next = e.target.checked ? [...current, c.name] : current.filter((k) => k !== c.name);
                      set(keysPatch(next.length ? next : current, draft.columns));
                    }}
                  />
                </td>
                <td>
                  <input
                    value={c.name}
                    onChange={(e) => {
                      const name = e.target.value.replace(/[^A-Za-z0-9_]/g, '_');
                      const columns = draft.columns.map((x, j) => (j === i ? { ...x, name } : x));
                      const keyList = keysOf(draft).map((k) => (k === c.name ? name : k));
                      setDraft({
                        ...draft,
                        columns,
                        ...keysPatch(keyList, columns),
                        fieldMap: draft.fieldMap.map((m) => (m.column === c.name ? { ...m, column: name } : m)),
                      });
                    }}
                  />
                </td>
                <td>
                  <input value={c.description ?? ''} onChange={(e) => setColumns(draft.columns.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                </td>
                <td>
                  <button type="button" className="lm-btn lm-btn-small" disabled={draft.columns.length <= 1} onClick={() => setColumns(draft.columns.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="lm-row">
          <button type="button" className="lm-btn" onClick={() => setColumns([...draft.columns, { name: `column_${draft.columns.length + 1}`, description: '' }])}>
            Add column
          </button>
          <Field label="Match mode" hint="CIDR suits subnet tables. In Stream, pair CIDR with “Most specific” match.">
            <Select
              label="Match mode"
              value={draft.matchMode}
              onChange={(v) => set({ matchMode: v })}
              options={[
                { value: 'exact', label: 'Exact' },
                { value: 'cidr', label: 'CIDR' },
                { value: 'regex', label: 'Regex' },
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section title="3. Source" help={HELP.source} guide={GUIDE_FOR.source} onGuide={onOpenGuide}>
        {template && template.examples.length > 0 && (
          <div className="lm-row lm-examples">
            <span className="lm-label">Start from an example:</span>
            {template.examples.map((ex) => (
              <button
                key={ex.label}
                type="button"
                className="lm-btn lm-btn-small"
                onClick={() => {
                  setMappingNote('');
                  set({
                    source: structuredClone(ex.source),
                    fieldMap: ex.fieldMap.map((m) => ({ ...m })),
                    extraSources: ex.extraSources ? structuredClone(ex.extraSources) : undefined,
                  });
                  setPreview(null);
                }}
              >
                {ex.label}
              </button>
            ))}
          </div>
        )}
        <SourceForm
          src={src}
          settings={settings}
          idPrefix="main"
          groups={groups}
          workerRequest={draft.workerRequests?.main}
          onRequestWorker={src.type === 'splunk_worker' ? () => requestFor('main', src) : undefined}
          onChange={(next) => {
            if (next.type !== src.type) {
              // A mapping only fits the source it was written for: start again from same-name fields.
              setPreview(null);
              setMappingNote(draft.fieldMap.length ? 'The source type changed, so the field mapping was reset to use same-named fields. Review section 4.' : '');
              set({ source: next, fieldMap: [] });
            } else set({ source: next });
          }}
        />

        <div className="lm-actions">
          <button type="button" className="lm-btn lm-btn-primary" disabled={busy} onClick={runPreview}>
            {busy ? 'Working…' : 'Test source and preview'}
          </button>
        </div>
        {busy && progress.length > 0 && <p className="lm-hint">{progress[progress.length - 1]}</p>}
        {previewError && <Messages kind="error" items={[previewError]} />}
      </Section>

      <Section title="4. Map source fields to columns" help={HELP.mapping} guide={GUIDE_FOR.mapping} onGuide={onOpenGuide} hint='Leave blank to use the field with the same name. Start with "=" for a fixed value, e.g. "=servicenow". Dot paths like "owned_by.name" read nested fields.'>
        {mappingNote && <Messages kind="warning" items={[mappingNote]} />}
        <FieldMapTable
          columns={draft.columns}
          keyColumns={keysOf(draft)}
          fieldMap={draft.fieldMap}
          fields={fields}
          listId="lm-fields-main"
          onChange={(fieldMap) => {
            setMappingNote('');
            set({ fieldMap });
          }}
        />
        {fields.length === 0 && <p className="lm-hint">Run “Test source and preview” to see the source’s field names here.</p>}
      </Section>

      <Section
        title="4b. Additional sources (optional)"
        help={HELP.extraSources}
        guide={GUIDE_FOR.extraSources}
        onGuide={onOpenGuide}
        hint="Merged into the main source in order. The main source's values always win; additional sources fill empty columns, and can add rows whose key the main source doesn't have."
      >
        {(draft.extraSources ?? []).map((ex, i) => {
          const update = (patch: Partial<ExtraSource>) =>
            set({ extraSources: (draft.extraSources ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={ex.id} className="lm-panel" aria-label={`Additional source ${i + 1}`}>
              <div className="lm-row lm-between">
                <Field label={`Additional source ${i + 1}: name`}>
                  <input value={ex.label} onChange={(e) => update({ label: e.target.value })} />
                </Field>
                <span className="lm-row">
                  <button type="button" className="lm-btn lm-btn-small" disabled={i === 0} onClick={() => {
                    const list = [...(draft.extraSources ?? [])];
                    [list[i - 1], list[i]] = [list[i], list[i - 1]];
                    set({ extraSources: list });
                  }}>
                    Move up
                  </button>
                  <button type="button" className="lm-btn lm-btn-small lm-btn-danger-ghost" onClick={() => {
                    const list = (draft.extraSources ?? []).filter((_, j) => j !== i);
                    set({ extraSources: list.length ? list : undefined });
                    setPreview(null);
                  }}>
                    Remove source
                  </button>
                </span>
              </div>
              <SourceForm
                src={ex.source}
                settings={settings}
                idPrefix={ex.id}
                groups={groups}
                workerRequest={draft.workerRequests?.[ex.id]}
                onRequestWorker={ex.source.type === 'splunk_worker' ? () => requestFor(ex.id, ex.source) : undefined}
                onChange={(next) => update(next.type !== ex.source.type ? { source: next, fieldMap: [] } : { source: next })}
              />
              <label className="lm-check">
                <input type="checkbox" checked={ex.addNewKeys} onChange={(e) => update({ addNewKeys: e.target.checked })} />
                Add rows whose key isn't in the sources above (otherwise only fill empty columns)
              </label>
              <div className="lm-hint">Map this source's fields to the lookup columns:</div>
              <FieldMapTable
                columns={draft.columns}
                keyColumns={keysOf(draft)}
                fieldMap={ex.fieldMap}
                fields={preview?.extraFields?.[ex.id] ?? []}
                listId={`lm-fields-${ex.id}`}
                onChange={(fieldMap) => update({ fieldMap })}
              />
            </div>
          );
        })}
        <button
          type="button"
          className="lm-btn"
          onClick={() =>
            set({
              extraSources: [
                ...(draft.extraSources ?? []),
                {
                  id: `src${Date.now().toString(36)}`,
                  label: `Source ${(draft.extraSources?.length ?? 0) + 2}`,
                  source: blankSource('search', settings),
                  fieldMap: [],
                  addNewKeys: false,
                },
              ],
            })
          }
        >
          Add a source
        </button>
        {(draft.extraSources?.length ?? 0) > 0 && <p className="lm-hint">“Test source and preview” reads every source and shows the merged result.</p>}
      </Section>

      {preview && (
        <Section title="Preview">
          <p>
            {preview.sourceRows} source row(s) → <strong>{preview.transform.rows.length}</strong> lookup row(s).
          </p>
          {preview.transform.merges && (
            <ul className="lm-log">
              {preview.transform.merges.map((m) => (
                <li key={m.label}>
                  Merged “{m.label}”: {m.input} row(s) read, {m.filled} empty cell(s) filled, {m.added} new row(s) added.
                </li>
              ))}
            </ul>
          )}
          <Messages kind="error" items={preview.transform.errors} />
          <Messages kind="warning" items={preview.transform.warnings} />
          {preview.diff && <DiffView diff={preview.diff} keys={keysOf(draft)} />}
          {preview.transform.rows.length > 0 && <PreviewTable columns={draft.columns.map((c) => c.name)} rows={preview.transform.rows} />}
          {preview.csv && (
            <button type="button" className="lm-btn" onClick={() => downloadText(fileNameFor(draft), preview.csv)}>
              Download CSV
            </button>
          )}
        </Section>
      )}

      <Section title="5. Publish to" help={HELP.publish} guide={GUIDE_FOR.publish} onGuide={onOpenGuide}>
        <label className="lm-check">
          <input type="checkbox" checked={draft.targets.search} onChange={(e) => set({ targets: { ...draft.targets, search: e.target.checked } })} />
          Cribl Search (use in Lake searches)
        </label>
        <div className="lm-hint">Cribl Stream worker groups:</div>
        {groups.length === 0 && <p className="lm-hint">No Stream groups found (check Settings › Diagnostics).</p>}
        {groups.map((g) => (
          <label key={g} className="lm-check">
            <input
              type="checkbox"
              checked={draft.targets.streamGroups.includes(g)}
              onChange={(e) =>
                set({
                  targets: {
                    ...draft.targets,
                    streamGroups: e.target.checked ? [...draft.targets.streamGroups, g] : draft.targets.streamGroups.filter((x) => x !== g),
                  },
                })
              }
            />
            {g}
          </label>
        ))}
        {(() => {
          const stale = staleLocations(initial, draft);
          if (!stale) return null;
          const where = [stale.search ? 'Search' : null, ...stale.streamGroups].filter(Boolean).join(', ');
          return (
            <div className="lm-msg lm-msg-warning">
              <label className="lm-check">
                <input type="checkbox" checked={removeStale} onChange={(e) => setRemoveStale(e.target.checked)} />
                When saving, remove the previously published <code>{stale.name}.csv</code> from: {where}
              </label>
              <span className="lm-hint">Pipelines that use that file stop enriching until they point at the new one.</span>
            </div>
          );
        })()}
        <Field label="Stream storage mode" hint="In-memory loads into every worker process; use disk for large tables.">
          <Select
            label="Stream storage mode"
            value={draft.targets.streamMode}
            onChange={(v) => set({ targets: { ...draft.targets, streamMode: v } })}
            options={[
              { value: 'auto', label: 'Automatic (disk above 100,000 rows or 10 MB)' },
              { value: 'memory', label: 'In memory' },
              { value: 'disk', label: 'Disk-based' },
            ]}
          />
        </Field>
      </Section>

      <Section title="6. Safety checks and schedule" help={HELP.safety} guide={GUIDE_FOR.safety} onGuide={onOpenGuide}>
        <div className="lm-grid">
          <Field label="Block if rows drop by more than (%)" hint="Compared with the last successful run. 0 turns this off.">
            <input type="number" min={0} max={100} value={draft.validation.maxDropPct} onChange={(e) => set({ validation: { ...draft.validation, maxDropPct: Number(e.target.value) } })} />
          </Field>
          <Field label="Maximum rows" hint="Up to 1,000,000. Above 10,000 rows, Search publishing needs the lookups API (no export fallback) and scheduled Lake sources are capped at 10,000.">
            <input type="number" min={1} max={1000000} value={draft.validation.maxRows} onChange={(e) => set({ validation: { ...draft.validation, maxRows: Number(e.target.value) } })} />
          </Field>
          <Field label="Schedule" hint="Needs the App's backend function (see README).">
            <Select label="Schedule" value={draft.scheduleMinutes} onChange={(v) => set({ scheduleMinutes: v })} options={SCHEDULES.map((x) => ({ value: x.v, label: x.label }))} />
          </Field>
        </div>
        {draft.scheduleMinutes > 0 && (
          <p className="lm-hint">
            {lakeSources(draft).length
              ? `Saving creates ${lakeSources(draft).length} Cribl Search scheduled search(es), saved as you, that refresh staging lookups for the Lake-based sources. The App's backend function then merges, validates and publishes every 15 minutes when due, and skips publishing when nothing changed. Staging is limited to 10,000 rows per source.`
              : 'The App backend function refreshes this lookup every 15 minutes when due, and skips publishing when nothing changed.'}
          </p>
        )}
        {initial?.scheduling?.error && <Messages kind="error" items={[initial.scheduling.error]} />}
        <label className="lm-check">
          <input type="checkbox" checked={draft.validation.blockOnEmptyKey} onChange={(e) => set({ validation: { ...draft.validation, blockOnEmptyKey: e.target.checked } })} />
          Block publishing if any row has an empty key (otherwise those rows are dropped)
        </label>
      </Section>

      <Messages kind="error" items={saveErrors} />
      <div className="lm-actions lm-sticky">
        <button type="button" className="lm-btn lm-btn-primary" disabled={busy} onClick={save}>
          Save lookup
        </button>
        <button type="button" className="lm-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function DiffView({ diff, keys }: { diff: RowDiff; keys: string[] }) {
  const none = !diff.added.length && !diff.removed.length && !diff.changed.length;
  return (
    <div className="lm-panel">
      <strong>Changes compared with the published version</strong>
      <p className="lm-hint">{diffSummary(diff)}</p>
      {none ? (
        <p className="lm-hint">No differences: publishing would not change the data.</p>
      ) : (
        <details>
          <summary>Show changes</summary>
          <ul className="lm-log">
            {diff.added.slice(0, 20).map((r) => (
              <li key={`a-${keyLabel(r, keys)}`}>+ {keyLabel(r, keys)}</li>
            ))}
            {diff.removed.slice(0, 20).map((r) => (
              <li key={`r-${keyLabel(r, keys)}`}>− {keyLabel(r, keys)}</li>
            ))}
            {diff.changed.slice(0, 20).map((c) => (
              <li key={`c-${c.key}`}>
                ~ {c.key}: {c.columns.map((col) => `${col} "${c.before[col] ?? ''}" → "${c.after[col] ?? ''}"`).join(', ')}
              </li>
            ))}
          </ul>
          {diff.added.length + diff.removed.length + diff.changed.length > 60 && <p className="lm-hint">Showing the first 20 of each kind.</p>}
        </details>
      )}
    </div>
  );
}
