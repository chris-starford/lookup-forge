import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMock } from './mock-cribl';
import { parseCsv, toCsv } from '../src/lookup-manager/core/csv';
import { transformRows, isValidCidr } from '../src/lookup-manager/core/transform';
import { getTemplate } from '../src/lookup-manager/core/templates';
import { runLookup, previewLookup } from '../src/lookup-manager/core/runner';
import { buildExportTail } from '../src/lookup-manager/core/publish';
import { normalizeSearchQuery } from '../src/lookup-manager/core/cribl';
import { listRuns, saveDefinition, getDefinition } from '../src/lookup-manager/core/store';
import { DEFAULT_SETTINGS, type LookupDefinition } from '../src/lookup-manager/core/types';

function defFromTemplate(type: Parameters<typeof getTemplate>[0], exampleIdx = 0, over: Partial<LookupDefinition> = {}): LookupDefinition {
  const t = getTemplate(type);
  const ex = t.examples[exampleIdx];
  return {
    id: `${t.defaultName}-test`,
    name: t.defaultName,
    title: t.label,
    description: t.summary,
    enrichment: t.type,
    columns: t.columns,
    keyColumn: t.keyColumn,
    keyColumns: t.keyColumns,
    matchMode: t.matchMode,
    source: ex.source,
    fieldMap: ex.fieldMap,
    extraSources: ex.extraSources ? structuredClone(ex.extraSources) : undefined,
    targets: { search: true, streamGroups: ['default', 'chris_demo'], streamMode: 'memory' },
    validation: { maxDropPct: 50, maxRows: 10000, blockOnEmptyKey: false },
    scheduleMinutes: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

test('CSV round trip with quotes, commas and newlines', () => {
  const rows = [{ a: 'x,y', b: 'say "hi"' }, { a: 'line1\nline2', b: '' }];
  const csv = toCsv(['a', 'b'], rows);
  assert.deepEqual(parseCsv(csv), rows);
  assert.ok(!csv.endsWith('\n'), 'no trailing newline (Stream CIDR/regex lookups)');
});

test('CIDR validation', () => {
  assert.ok(isValidCidr('10.0.0.0/8'));
  assert.ok(isValidCidr('192.168.1.10'));
  assert.ok(!isValidCidr('10.0.0.0/33'));
  assert.ok(!isValidCidr('not-a-cidr'));
});

test('transform: mapping, literals, nested paths, de-duplication and empty keys', () => {
  const def = defFromTemplate('asset', 4);
  const r = transformRows(def, [
    { ip_address: '10.0.0.1', name: 'a', owned_by: { name: 'Ann' } },
    { ip_address: '10.0.0.1', name: 'a2', owned_by: { name: 'Ann' } },
    { ip_address: '', name: 'nokey' },
  ]);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].hostname, 'a2', 'last duplicate wins');
  assert.equal(r.rows[0].owner, 'Ann');
  assert.equal(r.rows[0].source_system, 'servicenow');
  assert.equal(r.stats.emptyKeys, 1);
  assert.ok(r.warnings.some((w) => w.includes('empty')));
});

test('transform: blocks a large drop in row count and invalid CIDRs', () => {
  const def = defFromTemplate('ip_subnet');
  const drop = transformRows(def, [{ cidr: '10.0.0.0/8' }], 10);
  assert.ok(drop.errors.some((e) => e.includes('fell')));
  const bad = transformRows(def, [{ cidr: '10.0.0.0/99' }]);
  assert.ok(bad.errors.some((e) => e.includes('CIDR')));
});

test('query normalization for the Search API', () => {
  assert.equal(normalizeSearchQuery('dataset="x"\n| limit 5'), 'cribl dataset="x" | limit 5');
  assert.equal(normalizeSearchQuery('cribl dataset="x"'), 'cribl dataset="x"');
  assert.equal(normalizeSearchQuery('externaldata ["https://a"]'), 'externaldata ["https://a"]');
});

test('CSV source publishes to Search (API) and two Stream groups, then commits and deploys each group', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const def = defFromTemplate('ip_subnet');
  await saveDefinition(def);
  const run = await runLookup(def, DEFAULT_SETTINGS, 'manual');
  assert.equal(run.status, 'success', JSON.stringify(run, null, 2));
  assert.equal(run.rows, 9);
  for (const g of ['default', 'chris_demo', 'default_search']) assert.ok(mock.state.lookups[g].has('ip_subnets.csv'), g);
  assert.deepEqual(mock.state.commits.map((c) => c.group), ['default', 'chris_demo']);
  assert.deepEqual(mock.state.deploys.map((d) => d.group), ['default', 'chris_demo']);
  assert.equal(mock.state.deploys[0].version, mock.state.commits[0].id);
  const csv = mock.state.lookups.default.get('ip_subnets.csv')!.csv;
  assert.ok(csv.startsWith('cidr,network_name,zone,site,vlan,owner,trust_level\n10.0.0.0/8,'), 'rows sorted by key');
  assert.equal((await listRuns(def.id)).length, 1);
  assert.equal((await getDefinition(def.id))?.lastRun?.status, 'success');

  // Second run replaces (PATCH) instead of creating.
  const run2 = await runLookup((await getDefinition(def.id))!, DEFAULT_SETTINGS, 'manual');
  assert.equal(run2.status, 'success');
  assert.ok(mock.state.calls.some((c) => c.startsWith('PATCH /api/v1/m/default/system/lookups/ip_subnets.csv')));
  assert.ok(run2.targets.every((t) => t.detail.startsWith('Replaced') || t.target === 'Search'));
});

test('selective commit: other pending work in a group is never committed', async () => {
  const mock = createMock({ pending: { chris_demo: 2 } });
  globalThis.fetch = mock.fetch as typeof fetch;
  const run = await runLookup(defFromTemplate('service_port'), DEFAULT_SETTINGS, 'manual');
  assert.equal(run.status, 'success', JSON.stringify(run, null, 2));
  const c = (mock.state.commits as any[]).find((x) => x.group === 'chris_demo');
  assert.deepEqual(c.files.sort(), ['groups/chris_demo/data/lookups/service_ports.csv', 'groups/chris_demo/data/lookups/service_ports.yml']);
  assert.equal(mock.state.dirty.chris_demo.size, 2, 'the unrelated files are still uncommitted');
  assert.ok(!run.targets.some((t) => t.detail.includes('also included')));
});

test('if selective commit is refused, a group with other pending work is skipped, a clean one falls back', async () => {
  const mock = createMock({ pending: { chris_demo: 3 }, selectiveCommit: false });
  globalThis.fetch = mock.fetch as typeof fetch;
  const run = await runLookup(defFromTemplate('service_port'), DEFAULT_SETTINGS, 'manual');
  assert.equal(run.status, 'partial');
  const cd = run.targets.find((t) => t.target === 'Stream: chris_demo')!;
  assert.equal(cd.status, 'skipped');
  assert.ok(cd.detail.includes('3 other pending change(s)'), cd.detail);
  assert.ok(!(mock.state.commits as any[]).some((x) => x.group === 'chris_demo'));
  const df = run.targets.find((t) => t.target === 'Stream: default')!;
  assert.equal(df.status, 'ok');
  assert.ok(df.detail.includes('whole-group commit'), df.detail);
});

test('search source: falls back to export-to-lookup when the Search lookups API is unavailable', async () => {
  const mock = createMock({ searchLookupApi: false });
  globalThis.fetch = mock.fetch as typeof fetch;
  const def = defFromTemplate('asset', 0, { targets: { search: true, streamGroups: ['default'], streamMode: 'memory' } });
  const run = await runLookup(def, DEFAULT_SETTINGS, 'manual');
  assert.equal(run.status, 'success', JSON.stringify(run, null, 2));
  assert.equal(run.rows, 3);
  assert.equal(mock.state.searchExports.length, 1);
  const q = mock.state.searchExports[0].query;
  assert.ok(q.startsWith('cribl dataset="pan_traffic"'), q);
  assert.ok(q.includes('ip=tostring(src_ip)') && q.includes('source_system="observed:pan_traffic"'), q);
  assert.ok(q.includes('summarize') && q.endsWith('to lookup asset_inventory'), q);
  const streamCsv = parseCsv(mock.state.lookups.default.get('asset_inventory.csv')!.csv);
  assert.equal(streamCsv[1].owner, 'svc_backup');
});

test('CSV source without the Search lookups API is skipped for Search with a clear message', async () => {
  const mock = createMock({ searchLookupApi: false });
  globalThis.fetch = mock.fetch as typeof fetch;
  const run = await runLookup(defFromTemplate('custom', 0, { targets: { search: true, streamGroups: [], streamMode: 'memory' } }), DEFAULT_SETTINGS, 'manual');
  assert.equal(run.targets[0].status, 'skipped');
  assert.equal(run.status, 'failed');
});

test('HTTP sources: Feodo Tracker list and CISA KEV with a records path', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const feodo = await previewLookup(defFromTemplate('threat_intel', 0), DEFAULT_SETTINGS);
  assert.equal(feodo.transform.rows.length, 2);
  assert.equal(feodo.transform.rows[1].threat, 'Emotet');
  assert.ok(feodo.sourceFields.includes('malware'));
  const kev = await previewLookup(defFromTemplate('vulnerability', 0), DEFAULT_SETTINGS);
  assert.equal(kev.transform.rows[0].cve, 'CVE-2024-0001');
});

test('Splunk sources: Lake staging uses only the latest sync; REST export parses results', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const base = defFromTemplate('ip_subnet');
  const staged = await previewLookup(
    { ...base, source: { type: 'splunk_staging', dataset: 'lookup_staging', splunkLookup: 'subnets', earliest: '-24h' }, fieldMap: [] },
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(staged.transform.rows.map((r) => r.cidr), ['10.10.0.0/16', '10.20.0.0/16']);
  assert.ok(!staged.sourceFields.includes('sync_id'));
  const rest = await previewLookup(
    { ...base, source: { type: 'splunk_rest', baseUrl: 'https://splunk.example.com:8089', splunkLookup: 'subnets.csv' }, fieldMap: [] },
    DEFAULT_SETTINGS,
  );
  assert.equal(rest.transform.rows.length, 2);
  assert.ok(mock.state.calls.some((c) => c.includes('splunk.example.com:8089/services/search/v2/jobs/export')));
});

test('Splunk staging without sync_id (collector) uses only the newest collection run', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const r = await previewLookup(defFromTemplate('asset', 1), DEFAULT_SETTINGS);
  assert.deepEqual(r.transform.rows.map((x) => x.hostname), ['WIN-DC01', 'WIN-SRV-FS01']);
  assert.equal(r.transform.rows[0].source_system, 'splunk:cmdb_assets');
});

test('Splunk direct: browse lists files and definitions; lookup and SPL modes; errors surface', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const { listSplunkLookups, splunkSearchString } = await import('../src/lookup-manager/core/splunk');
  const list = await listSplunkLookups('https://splunk.example.com:8089/');
  assert.deepEqual(list.map((l) => `${l.kind}:${l.name}`), ['definition:asset_lookup_by_str', 'file:cmdb_assets.csv', 'file:geo_attr_countries.csv']);
  assert.equal(list[0].detail, 'KV store: assets_by_str');

  const asset = defFromTemplate('asset', 3); // Splunk lookup, direct
  const r1 = await previewLookup({ ...asset, source: { ...(asset.source as any), baseUrl: 'https://splunk.example.com:8089' } }, DEFAULT_SETTINGS);
  assert.deepEqual(r1.transform.rows.map((x) => x.hostname), ['WIN-DC01', 'WIN-SRV-FS01'], 'sorted by ip');

  const custom = defFromTemplate('custom', 1); // Splunk search results, direct
  const src = { ...(custom.source as any), baseUrl: 'https://splunk.example.com:8089' };
  const r2 = await previewLookup({ ...custom, source: src }, DEFAULT_SETTINGS);
  assert.deepEqual(r2.transform.rows.map((x) => x.key), ['pa-hq-fw01', 'web-prod-01'], 'preview rows skipped, sorted');
  const sent = new URLSearchParams((mock.state as any).splunkCalls.at(-1).body);
  assert.ok(sent.get('search')!.startsWith('search index=*'));
  assert.equal(sent.get('earliest_time'), '-24h');

  await assert.rejects(previewLookup({ ...custom, source: { ...src, spl: '| badcommand' } }, DEFAULT_SETTINGS), /Unknown search command/);
  assert.equal(splunkSearchString('| tstats count'), '| tstats count');
  assert.equal(splunkSearchString('index=x'), 'search index=x');
});

test('Lake staging rows whose columns are only inside _raw JSON are unpacked', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const def = defFromTemplate('asset', 1);
  const r = await previewLookup({ ...def, source: { ...(def.source as any), splunkLookup: 'test_assets.csv' } }, DEFAULT_SETTINGS);
  assert.deepEqual(r.transform.errors, []);
  assert.deepEqual(r.transform.rows.map((x) => `${x.ip}:${x.hostname}:${x.criticality}`), ['10.10.20.10:WIN-DC01:critical', '10.10.20.50:WIN-SRV-FS01:high']);
  assert.ok(r.sourceFields.includes('hostname') && !r.sourceFields.includes('sync_id'));
  const { unpackJsonRaw } = await import('../src/lookup-manager/core/sources');
  assert.deepEqual(unpackJsonRaw({ _raw: '<14>syslog line', a: 1 }), { _raw: '<14>syslog line', a: 1 }, 'non-JSON _raw untouched');
  assert.equal(unpackJsonRaw({ _raw: '{"a":"inner"}', a: 'outer' }).a, 'outer', 'event fields win');
});

test('lifecycle: published locations are tracked, diffs computed, renames and removals cleaned up', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const { staleLocations, removeLocations } = await import('../src/lookup-manager/core/publish');
  const def = defFromTemplate('ip_subnet', 0, { id: 'subnets-1' });
  await saveDefinition(def);
  await runLookup(def, DEFAULT_SETTINGS, 'manual');
  let saved = (await getDefinition('subnets-1'))!;
  assert.deepEqual(saved.published, { ...saved.published!, name: 'ip_subnets', search: true, streamGroups: ['default', 'chris_demo'] });

  // Change one row and add one: the preview diff reports it against the published copy.
  const csv = (def.source as any).content.replace('HQ workstations', 'HQ laptops') + '\n172.16.0.0/12,Lab,lab,HQ,300,R&D,internal';
  const changed = { ...saved, source: { type: 'csv', content: csv } as any };
  const pv = await previewLookup(changed, DEFAULT_SETTINGS);
  assert.equal(pv.diff!.comparedWith, 'Stream: default');
  assert.deepEqual([pv.diff!.added.length, pv.diff!.removed.length, pv.diff!.changed.length], [1, 0, 1]);
  assert.deepEqual(pv.diff!.changed[0].columns, ['network_name']);
  const run2 = await runLookup(changed, DEFAULT_SETTINGS, 'manual');
  assert.ok(run2.messages.some((m) => m.startsWith('Changes: 1 added, 0 removed, 1 changed')), run2.messages.join('|'));

  // Rename + deselect chris_demo: everything published under the old name is stale.
  saved = (await getDefinition('subnets-1'))!;
  const renamed = { ...saved, name: 'network_zones', targets: { ...saved.targets, streamGroups: ['default'] } };
  assert.deepEqual(staleLocations(saved, renamed), { name: 'ip_subnets', search: true, streamGroups: ['default', 'chris_demo'] });
  assert.deepEqual(staleLocations(saved, { ...saved, targets: { ...saved.targets, streamGroups: ['default'] } }), { name: 'ip_subnets', search: false, streamGroups: ['chris_demo'] });
  assert.equal(staleLocations(saved, saved), null);

  const results = await removeLocations(staleLocations(saved, renamed)!, DEFAULT_SETTINGS);
  assert.ok(results.every((r) => r.status === 'ok'), JSON.stringify(results));
  for (const g of ['default', 'chris_demo', 'default_search']) assert.ok(!mock.state.lookups[g].has('ip_subnets.csv'), g);
  const removal = (mock.state.commits as any[]).find((c) => c.message === 'Lookup Manager: remove ip_subnets.csv' && c.group === 'chris_demo');
  assert.deepEqual(removal.files.sort(), ['groups/chris_demo/data/lookups/ip_subnets.csv', 'groups/chris_demo/data/lookups/ip_subnets.yml']);
  // Removing something already gone is fine.
  const again = await removeLocations({ name: 'ip_subnets', search: true, streamGroups: ['default'] }, DEFAULT_SETTINGS);
  assert.ok(again.every((r) => r.status === 'ok' && r.detail.includes('not present')));
});

test('combining sources: main source wins, extras fill empty cells and can add new keys', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const combined = defFromTemplate('asset', 2); // Splunk CMDB + observed traffic
  assert.equal(combined.extraSources?.length, 1);
  // Main: two CMDB hosts (from the staging mock). Extra: observed pan_traffic (10.10.10.21 jsmith trust, 10.10.20.50 svc_backup servers, 10.10.30.15 dmz).
  const r = await previewLookup(combined, DEFAULT_SETTINGS);
  assert.deepEqual(r.transform.errors, []);
  const byIp = Object.fromEntries(r.transform.rows.map((x) => [x.ip, x]));
  assert.equal(byIp['10.10.20.50'].hostname, 'WIN-SRV-FS01', 'CMDB host kept');
  assert.equal(byIp['10.10.20.50'].zone, 'servers', 'zone filled from traffic');
  assert.equal(byIp['10.10.20.50'].source_system, 'splunk:cmdb_assets', 'main source wins on non-empty cells');
  assert.equal(byIp['10.10.10.21'].owner, 'jsmith', 'unknown host added from traffic');
  assert.equal(byIp['10.10.10.21'].source_system, 'observed:pan_traffic');
  assert.equal(byIp['10.10.20.50'].owner, 'svc_backup', 'empty CMDB owner filled from traffic');
  assert.deepEqual(r.transform.merges, [{ label: 'Observed in firewall traffic', input: 3, filled: 2, added: 2 }]);
  assert.ok(r.extraFields.observed.includes('src_zone'));
  assert.ok(r.messages.some((m) => m.startsWith('Merged "Observed in firewall traffic": 3 row(s) read, 2 empty cell(s) filled, 2 new row(s) added')));
  // Without addNewKeys, only fills.
  const fillOnly = { ...combined, extraSources: [{ ...combined.extraSources![0], addNewKeys: false }] };
  const r2 = await previewLookup(fillOnly, DEFAULT_SETTINGS);
  assert.deepEqual(r2.transform.rows.map((x) => x.ip), ['10.10.20.10', '10.10.20.50']);
});

test('Splunk through a worker: template patching, request, waiting, arrival, lookup list', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const w = await import('../src/lookup-manager/core/worker');
  // Patching: only the search, two fields and the run block change; the schedule is dropped.
  const patched = w.patchCollector(mock.state.collectorTemplate, { search: '| inputlookup "odd name".csv', stagingKey: 'odd.csv', syncId: 'S1', earliest: '-1h' });
  const params = patched.collector.conf.collectRequestParams;
  assert.equal(params.find((x: any) => x.name === 'search').value, JSON.stringify('| inputlookup "odd name".csv'));
  assert.equal(params.find((x: any) => x.name === 'earliest_time').value, '"-1h"');
  assert.deepEqual(patched.input.metadata, [{ name: 'splunk_lookup', value: '"odd.csv"' }, { name: 'sync_id', value: '"S1"' }]);
  assert.equal(patched.schedule, undefined);
  assert.equal(patched.run.mode, 'run');
  assert.equal(mock.state.collectorTemplate.schedule.enabled, true, 'template itself untouched');
  assert.throws(() => w.patchCollector({ collector: { conf: { collectRequestParams: [] } } }, { search: 'x', stagingKey: 'k', syncId: 's' }), /no "search" request parameter/);

  // Request -> waiting -> arrival, through runLookup.
  const asset = defFromTemplate('asset', 1, { id: 'via-worker' });
  const source = { type: 'splunk_worker', group: 'chris_demo', collectorId: 'splunk_lookup_template', dataset: 'lookup_staging', mode: 'lookup', splunkLookup: 'cmdb_assets.csv' } as any;
  const def = { ...asset, source };
  const waiting = await runLookup(def, DEFAULT_SETTINGS, 'manual');
  assert.equal(waiting.status, 'blocked');
  assert.ok(waiting.messages.some((m) => m.startsWith('Waiting: No data has been requested')));
  const req = await w.requestWorkerSync(source, def.name);
  assert.equal(mock.state.jobRuns.length, 1);
  assert.equal(mock.state.jobRuns[0].group, 'chris_demo');
  const pend = await runLookup({ ...def, workerRequests: { main: req } }, DEFAULT_SETTINGS, 'manual');
  assert.ok(pend.messages.some((m) => m.startsWith('Waiting: Requested from Splunk')), pend.messages.join('|'));
  (mock.state as any).deliverWorker(mock.state.jobRuns[0].config);
  const pv = await previewLookup({ ...def, workerRequests: { main: req } }, DEFAULT_SETTINGS);
  assert.deepEqual(pv.transform.rows.map((r) => `${r.ip}:${r.hostname}`), ['10.10.20.10:WIN-DC01', '10.10.20.50:WIN-SRV-FS01']);

  // SPL mode uses its own staging key.
  assert.equal(w.workerStagingKey({ ...source, mode: 'spl', spl: 'index=x' }, 'asset_inventory'), 'spl_asset_inventory');

  // Lookup list through the worker.
  await assert.rejects(w.readCatalog('chris_demo', 'lookup_staging', DEFAULT_SETTINGS), /No data has been requested/);
  const creq = await w.requestCatalog('chris_demo', 'splunk_lookup_template');
  await assert.rejects(w.readCatalog('chris_demo', 'lookup_staging', DEFAULT_SETTINGS), /not reached Lake yet/);
  (mock.state as any).deliverWorker(mock.state.jobRuns.at(-1)!.config);
  const list = await w.readCatalog('chris_demo', 'lookup_staging', DEFAULT_SETTINGS);
  assert.deepEqual(list.map((l) => `${l.kind}:${l.name}`), ['definition:asset_lookup_by_str', 'file:cmdb_assets.csv']);
  assert.ok(creq.syncId);

  // Scheduling treats worker sources as Lake sources keyed by their staging key.
  const { stagingQuery, isLakeSource } = await import('../src/lookup-manager/core/schedule');
  assert.ok(isLakeSource(source));
  assert.ok(stagingQuery(source, 'lm_src_x', DEFAULT_SETTINGS, 'asset_inventory').startsWith('dataset="lookup_staging" splunk_lookup="cmdb_assets.csv"'));
});

test('export tail escapes quotes in literals and descriptions', () => {
  const def = defFromTemplate('custom', 0, { description: 'Say "hi"', fieldMap: [{ column: 'value', source: '=a"b' }] });
  const tail = buildExportTail(def);
  assert.ok(tail.includes('value="a\\"b"'), tail);
  assert.ok(tail.includes('description="Say \\"hi\\""'), tail);
});

test('version: APP_VERSION matches the newest CHANGELOG entry and is recorded on runs and saves', async () => {
  const { APP_VERSION } = await import('../src/lookup-manager/version');
  const { readFileSync } = await import('node:fs');
  const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const newest = /^## (\d+\.\d+\.\d+)/m.exec(log)?.[1];
  assert.equal(newest, APP_VERSION, 'CHANGELOG.md newest entry must equal APP_VERSION');
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const def = defFromTemplate('ip_subnet', 0, { id: 'ver-1' });
  await saveDefinition(def);
  assert.equal((await getDefinition('ver-1'))?.savedWithVersion, APP_VERSION);
  const run = await runLookup(def, DEFAULT_SETTINGS, 'manual');
  assert.equal(run.appVersion, APP_VERSION);
});

test('composite keys: port + protocol de-duplicate, diff and export together', async () => {
  const { diffRows } = await import('../src/lookup-manager/core/diff');
  const def = defFromTemplate('service_port', 0);
  assert.deepEqual(def.keyColumns, ['port', 'protocol']);
  const r = transformRows(def, [
    { port: '53', protocol: 'udp', service_name: 'domain' },
    { port: '53', protocol: 'tcp', service_name: 'domain-tcp' },
    { port: '53', protocol: 'udp', service_name: 'dns' },
    { port: '22', protocol: '', service_name: 'no protocol' },
  ]);
  assert.deepEqual(r.rows.map((x) => `${x.port}/${x.protocol}:${x.service_name}`), ['53/tcp:domain-tcp', '53/udp:dns']);
  assert.equal(r.stats.duplicates, 1);
  assert.equal(r.stats.emptyKeys, 1);
  const d = diffRows([{ port: '53', protocol: 'udp', service_name: 'domain' }], r.rows, ['port', 'protocol'], def.columns.map((c) => c.name), 'test');
  assert.equal(d.changed[0].key, '53 / udp');
  assert.equal(d.added.length, 1);
  assert.ok(transformRows({ ...def, matchMode: 'cidr' }, r.rows).errors.some((e) => e.includes('single key column')));
  const tail = buildExportTail({ ...def, source: { type: 'search', query: 'x', earliest: '-1h', latest: 'now' } });
  assert.ok(tail.includes('by port, protocol') && tail.includes('isnotempty(port) and isnotempty(protocol)'), tail);
});

test('file formats: TSV, JSON array and NDJSON content', async () => {
  const base = defFromTemplate('custom', 0);
  const read = (content: string, format: any) => previewLookup({ ...base, source: { type: 'csv', content, format } }, DEFAULT_SETTINGS);
  assert.deepEqual((await read('key\tvalue\na\t1\nb\t2', 'tsv')).transform.rows.map((x) => x.value), ['1', '2']);
  assert.deepEqual((await read('[{"key":"a","value":1},{"key":"b","value":2}]', 'json')).transform.rows.map((x) => x.value), ['1', '2']);
  assert.deepEqual((await read('{"key":"a","value":1}\n{"key":"b","value":2}\n', 'ndjson')).transform.rows.map((x) => x.key), ['a', 'b']);
});

test('large files: content over 900 KB is stored in chunks and restored transparently', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  const { CHUNK_BYTES, patchDefinition, deleteDefinition } = await import('../src/lookup-manager/core/store');
  const lines = ['key,value'];
  for (let i = 0; i < 60000; i++) lines.push(`host-${String(i).padStart(6, '0')}.corp.example.com,${'x'.repeat(20)}`);
  const content = lines.join('\n');
  assert.ok(content.length > 2 * CHUNK_BYTES);
  const def = defFromTemplate('custom', 0, { id: 'big-1', source: { type: 'csv', content, fileName: 'hosts.csv' } as any });
  await saveDefinition(def);
  const storedRaw = JSON.parse(mock.state.kv.get('lm-def-big-1')!);
  assert.equal(storedRaw.source.content, '', 'definition itself stays small');
  assert.equal(storedRaw.source.contentRef.chunks, Math.ceil(content.length / CHUNK_BYTES));
  assert.ok([...mock.state.kv.keys()].filter((k) => k.startsWith('lm-blob-big-1-main-')).length >= 3);
  assert.equal(((await getDefinition('big-1'))!.source as any).content, content, 'restored exactly');
  // Small updates (run history, patches) keep the chunks.
  await patchDefinition('big-1', { description: 'patched' });
  const run = await runLookup((await getDefinition('big-1'))!, DEFAULT_SETTINGS, 'manual');
  assert.equal(run.rows, 60000);
  assert.equal(((await getDefinition('big-1'))!.source as any).content.length, content.length);
  // Re-saving with smaller content removes the chunks; deleting removes everything.
  await saveDefinition({ ...(await getDefinition('big-1'))!, source: { type: 'csv', content: 'key,value\na,1' } as any });
  assert.equal([...mock.state.kv.keys()].filter((k) => k.startsWith('lm-blob-big-1-')).length, 0);
  await saveDefinition(def);
  await deleteDefinition('big-1');
  assert.equal([...mock.state.kv.keys()].filter((k) => k.includes('big-1')).length, 0);
});

test('automatic Stream storage: disk above 100,000 rows or 10 MB', async () => {
  const { streamModeFor } = await import('../src/lookup-manager/core/publish');
  assert.equal(streamModeFor('auto', 1000, 50_000), 'memory');
  assert.equal(streamModeFor('auto', 100_001, 1), 'disk');
  assert.equal(streamModeFor('auto', 10, 11 * 1024 * 1024), 'disk');
  assert.equal(streamModeFor('memory', 1e6, 1e9), 'memory');
  assert.equal(streamModeFor(undefined, 5, 5), 'memory');
});

test('performance: 200,000-row lookup maps, validates, diffs and serialises quickly', async () => {
  const { diffRows } = await import('../src/lookup-manager/core/diff');
  const def = { ...defFromTemplate('asset', 4), validation: { maxDropPct: 50, maxRows: 1_000_000, blockOnEmptyKey: false } };
  const rows = Array.from({ length: 200_000 }, (_, i) => ({ ip_address: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, name: `host-${i}`, owned_by: { name: `owner-${i % 50}` } }));
  const t0 = Date.now();
  const r = transformRows(def, rows);
  const t1 = Date.now();
  const csv = toCsv(def.columns.map((c) => c.name), r.rows);
  const t2 = Date.now();
  const changed = r.rows.map((x, i) => (i % 1000 === 0 ? { ...x, owner: 'changed' } : x));
  const d = diffRows(r.rows, changed, ['ip'], def.columns.map((c) => c.name), 'perf');
  const t3 = Date.now();
  assert.equal(r.rows.length, 200_000);
  assert.equal(d.changed.length, 200);
  console.log(`  200k rows: transform ${t1 - t0} ms, CSV ${t2 - t1} ms (${(csv.length / 1048576).toFixed(1)} MB), diff ${t3 - t2} ms`);
  assert.ok(t3 - t0 < 15_000, `took ${t3 - t0} ms`);
});

test('usage snippets: Stream Lookup function and Search query reflect keys, match mode and overrides', async () => {
  const { usageFor } = await import('../src/lookup-manager/core/usage');
  const ports = usageFor(defFromTemplate('service_port', 0));
  const conf = (ports.streamFunction as any).conf;
  assert.equal(conf.file, 'service_ports.csv');
  assert.deepEqual(conf.inFields, [{ eventField: 'dest_port', lookupField: 'port' }, { eventField: 'protocol', lookupField: 'protocol' }]);
  assert.ok(conf.outFields.some((o: any) => o.lookupField === 'risk' && o.eventField === 'dest_service_risk'));
  assert.equal((ports.streamFunction as any).filter, 'dest_port && protocol');
  assert.ok(ports.searchQuery.includes('| lookup service_ports on dest_port=port, protocol=protocol'), ports.searchQuery);
  assert.ok(ports.notes.some((n) => n.startsWith('Composite key')));
  const subnets = usageFor(defFromTemplate('ip_subnet', 0), { cidr: 'dest_ip' });
  assert.equal((subnets.streamFunction as any).conf.matchMode, 'cidr');
  assert.equal((subnets.streamFunction as any).conf.matchType, 'specific');
  assert.deepEqual((subnets.streamFunction as any).conf.inFields, [{ eventField: 'dest_ip', lookupField: 'cidr' }]);
});

test('upgrade compatibility: a lookup and settings saved by 1.0.0 still load, preview and publish', async () => {
  const mock = createMock();
  globalThis.fetch = mock.fetch as typeof fetch;
  // Exactly the shape 1.0.0 stored: no keyColumns, extraSources, published, scheduling, savedWithVersion; streamMode "memory".
  const v100 = {
    id: 'legacy-1', name: 'legacy_subnets', title: 'Legacy subnets', description: 'Saved by 1.0.0', enrichment: 'ip_subnet',
    columns: [{ name: 'cidr', description: '' }, { name: 'network_name', description: '' }], keyColumn: 'cidr', matchMode: 'cidr',
    source: { type: 'csv', content: 'cidr,network_name\n10.0.0.0/8,Corp\n192.168.0.0/16,Lab' }, fieldMap: [],
    targets: { search: true, streamGroups: ['default'], streamMode: 'memory' },
    validation: { maxDropPct: 50, maxRows: 10000, blockOnEmptyKey: false }, scheduleMinutes: 0, createdAt: 1, updatedAt: 1,
    lastRun: { runId: 'r0', lookupId: 'legacy-1', startedAt: 1, finishedAt: 2, status: 'success', rows: 2, trigger: 'manual', messages: [], targets: [] },
  };
  mock.state.kv.set('lm-index', JSON.stringify(['legacy-1']));
  mock.state.kv.set('lm-def-legacy-1', JSON.stringify(v100));
  mock.state.kv.set('lm-settings', JSON.stringify({ searchGroup: 'default_search', blockIfPendingChanges: true, splunkStagingDataset: 'lookup_staging' }));
  const { listDefinitions, getSettings } = await import('../src/lookup-manager/core/store');
  const settings = await getSettings();
  assert.equal(settings.diagnosticsDataset, '$vt_dummy', 'new settings get defaults');
  const [def] = await listDefinitions();
  assert.equal(def.id, 'legacy-1');
  const pv = await previewLookup(def, settings);
  assert.deepEqual(pv.transform.errors, []);
  assert.equal(pv.transform.rows.length, 2);
  const run = await runLookup(def, settings, 'manual');
  assert.equal(run.status, 'success', JSON.stringify(run.targets));
  assert.equal(mock.state.lookups.default.get('legacy_subnets.csv')!.mode, 'memory', 'explicit 1.0.0 storage mode kept');
  const after = (await getDefinition('legacy-1'))!;
  assert.deepEqual(after.published?.streamGroups, ['default']);
  assert.equal(after.keyColumns, undefined, 'not rewritten until edited');
});

test('guide: USER_GUIDE.md is up to date, links resolve, and quoted UI labels exist', async () => {
  const { GUIDE, GUIDE_FOR, guideToMarkdown } = await import('../src/lookup-manager/ui/guide');
  const { APP_VERSION } = await import('../src/lookup-manager/version');
  const { readFileSync, readdirSync } = await import('node:fs');
  const md = readFileSync(new URL('../docs/USER_GUIDE.md', import.meta.url), 'utf8');
  assert.equal(md, guideToMarkdown(APP_VERSION) + '\n', 'docs/USER_GUIDE.md is stale: run npx tsx scripts/build-user-guide.ts');
  const ids = new Set(GUIDE.map((s) => s.id));
  assert.equal(ids.size, GUIDE.length, 'unique section ids');
  for (const id of Object.values(GUIDE_FOR)) assert.ok(ids.has(id), `GUIDE_FOR points at missing section ${id}`);
  // Labels the guide tells people to click or choose must exist in the UI source.
  const uiDir = new URL('../src/lookup-manager/ui/', import.meta.url);
  const ui = readdirSync(uiDir).filter((f) => f.endsWith('.tsx')).map((f) => readFileSync(new URL(f, uiDir), 'utf8')).join('\n');
  const templates = readFileSync(new URL('../src/lookup-manager/core/templates.ts', import.meta.url), 'utf8');
  const labels = [
    'New lookup', 'Test source and preview', 'Save lookup', 'Run now', 'Run diagnostics', 'History', 'Use',
    'Browse Splunk lookups', 'Request from Splunk now', 'Request lookup list from Splunk', 'Show lookup list',
    "Add rows whose key isn't in the sources above", 'Delete definition only', 'Delete and remove from', 'edit the existing lookup',
    'Manual only', 'Hourly', 'Existing Splunk lookup', 'Splunk search (SPL) results', 'Records path', 'Worker Group', 'Collector template ID',
    'Staging dataset', 'Splunk lookup name', 'Cribl Search (use in Lake searches)', 'Start from an example',
  ];
  for (const l of labels) assert.ok(ui.includes(l) || templates.includes(l), `UI label not found: "${l}"`);
  for (const ex of ['Example network (edit to match yours)', 'Splunk CMDB + zones and unknown hosts from firewall traffic (combined)']) assert.ok(templates.includes(ex), ex);
});
