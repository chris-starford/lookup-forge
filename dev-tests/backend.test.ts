import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMock } from './mock-cribl';
import { onRequest } from '../backend/run-lookups';
import { saveDefinition, getDefinition } from '../src/lookup-manager/core/store';
import { getTemplate } from '../src/lookup-manager/core/templates';
import type { LookupDefinition } from '../src/lookup-manager/core/types';

const t = getTemplate('ip_subnet');
const def = (id: string, scheduleMinutes: number): LookupDefinition => ({
  id, name: id, title: id, description: '', enrichment: 'ip_subnet', columns: t.columns, keyColumn: 'cidr', matchMode: 'cidr',
  source: t.examples[0].source, fieldMap: t.examples[0].fieldMap,
  targets: { search: false, streamGroups: ['default'], streamMode: 'memory' },
  validation: { maxDropPct: 50, maxRows: 10000, blockOnEmptyKey: false }, scheduleMinutes, createdAt: 0, updatedAt: 0,
});
const call = async (body: unknown) => (await onRequest(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { invocationId: 'i1' })).json();

test('backend: ping, scheduled runs only due lookups, and runs one lookup on request', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  assert.deepEqual(await call({ action: 'ping' }), { ok: true });
  await saveDefinition(def('scheduled_subnets', 15));
  await saveDefinition(def('manual_subnets', 0));
  const r1 = await call({ scheduleId: 'run-due-lookups', scheduledFor: '2026-10-28T02:00:00Z' });
  assert.deepEqual(r1.ran.map((x: any) => x.id), ['scheduled_subnets']);
  assert.equal(r1.ran[0].status, 'success');
  const r2 = await call({ scheduleId: 'run-due-lookups' });
  assert.deepEqual(r2.ran, [], 'not due again within 15 minutes');
  const r3 = await call({ lookupId: 'manual_subnets' });
  assert.deepEqual(r3.ran.map((x: any) => x.id), ['manual_subnets']);
  assert.equal((await getDefinition('scheduled_subnets'))?.lastRun?.trigger, 'schedule');
});

test('scheduling: saved searches for Lake sources; backend publishes from staging lookups and skips unchanged', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const { syncSchedules, stagingName, removeSchedules } = await import('../src/lookup-manager/core/schedule');
  const { DEFAULT_SETTINGS } = await import('../src/lookup-manager/core/types');
  const { getTemplate: tpl } = await import('../src/lookup-manager/core/templates');
  const a = tpl('asset');
  const ex = a.examples[2]; // Splunk CMDB (staging) + observed traffic (search)
  const def: LookupDefinition = {
    id: 'assets-sched', name: 'asset_inventory', title: 'Assets', description: '', enrichment: 'asset', columns: a.columns, keyColumn: 'ip', matchMode: 'exact',
    source: ex.source, fieldMap: ex.fieldMap, extraSources: structuredClone(ex.extraSources),
    targets: { search: true, streamGroups: ['default'], streamMode: 'memory' },
    validation: { maxDropPct: 50, maxRows: 10000, blockOnEmptyKey: false }, scheduleMinutes: 60, createdAt: 0, updatedAt: 0,
  };
  const sched = await syncSchedules(def, DEFAULT_SETTINGS);
  assert.equal(sched?.error, undefined);
  assert.deepEqual(sched!.savedSearches.map((x) => x.sourceKey), ['main', 'observed']);
  const mainSS = mock.state.savedSearches.get(stagingName(def, 'main'));
  assert.equal(mainSS.schedule.cronSchedule, '5 * * * *');
  assert.ok(mainSS.query.startsWith('cribl dataset="lookup_staging" splunk_lookup="cmdb_assets.csv"'), mainSS.query);
  assert.ok(mainSS.query.endsWith(`to lookup ${stagingName(def, 'main')}`));
  const obsSS = mock.state.savedSearches.get(stagingName(def, 'observed'));
  assert.ok(obsSS.query.includes('dataset="pan_traffic"') && obsSS.query.includes('| limit 10000 | export mode=overwrite'));

  // Simulate the scheduled searches having run: staging lookups appear in Search.
  const raw = (o: object) => `"${JSON.stringify(o).replace(/"/g, '""')}"`; // CSV quoting, as the export writes it
  mock.state.lookups.default_search.set(`${stagingName(def, 'main')}.csv`, { csv: `raw_json,sync_id,event_time\n${raw({ ip: '10.10.20.50', hostname: 'WIN-SRV-FS01', criticality: 'high' })},s2,100\n${raw({ ip: '10.0.0.1', hostname: 'OLD' })},s1,50`, description: '', mode: 'memory' });
  mock.state.lookups.default_search.set(`${stagingName(def, 'observed')}.csv`, { csv: 'src_ip,src_zone,last_user\n10.10.20.50,servers,svc_backup\n10.10.10.21,trust,jsmith', description: '', mode: 'memory' });
  await saveDefinition({ ...def, scheduling: sched });

  const r1 = await call({ scheduleId: 'run-due-lookups' });
  assert.equal(r1.ran[0].status, 'success', JSON.stringify(r1));
  assert.equal(r1.ran[0].rows, 2, 'latest sync only (s2) + one observed host');
  const csv = mock.state.lookups.default.get('asset_inventory.csv')!.csv;
  assert.ok(csv.includes('10.10.20.50,WIN-SRV-FS01') && csv.includes(',servers,') && csv.includes('10.10.10.21'), csv);
  assert.ok(!mock.state.calls.some((c) => c.includes('/search/jobs')), 'backend never runs search jobs');

  // Next scheduled run with the same data: due again (force), but nothing changed, so nothing is published.
  const commitsBefore = mock.state.commits.length;
  const d = (await getDefinition('assets-sched'))!;
  await saveDefinition({ ...d, lastRun: { ...d.lastRun!, finishedAt: 0 } });
  const r2 = await call({ scheduleId: 'run-due-lookups' });
  assert.equal(r2.ran[0].status, 'success');
  assert.equal(mock.state.commits.length, commitsBefore, 'no new commits when unchanged');
  assert.ok((await getDefinition('assets-sched'))!.lastRun!.messages.some((m) => m.startsWith('No changes since the published version')));

  // Turning the schedule off removes the saved searches.
  const off = await syncSchedules({ ...def, scheduleMinutes: 0, scheduling: sched }, DEFAULT_SETTINGS);
  assert.equal(off, undefined);
  assert.equal(mock.state.savedSearches.size, 0);
  assert.deepEqual(await removeSchedules({ ...def, scheduling: sched }, DEFAULT_SETTINGS), [], 'removing again is harmless');
});
