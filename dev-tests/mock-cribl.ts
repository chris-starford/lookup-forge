// In-memory stand-in for the Cribl APIs the App uses. Test-only; not shipped.

export interface MockState {
  kv: Map<string, string>;
  lookups: Record<string, Map<string, { csv: string; description: string; mode: string }>>;
  uploads: Map<string, string>;
  pending: Record<string, number>;
  commits: { group: string; message: string; id: string }[];
  deploys: { group: string; version: string }[];
  searchJobs: Map<string, { query: string; polls: number }>;
  searchExports: { name: string; query: string }[];
  searchLookupApi: boolean;
  selectiveCommit: boolean;
  savedSearches: Map<string, any>;
  collectorTemplate: any;
  jobRuns: { group: string; config: any; id: string }[];
  workerRows: Map<string, Record<string, unknown>[]>;
  autoDeliver: boolean;
  dirty: Record<string, Set<string>>;
  calls: string[];
}

export function createMock(opts: { searchLookupApi?: boolean; pending?: Record<string, number>; selectiveCommit?: boolean; autoDeliver?: boolean } = {}) {
  const state: MockState = {
    kv: new Map(),
    lookups: { default: new Map(), chris_demo: new Map(), default_search: new Map() },
    uploads: new Map(),
    pending: { default: 0, chris_demo: 0, ...(opts.pending ?? {}) },
    commits: [],
    deploys: [],
    searchJobs: new Map(),
    searchExports: [],
    searchLookupApi: opts.searchLookupApi ?? true,
    selectiveCommit: opts.selectiveCommit ?? true,
    savedSearches: new Map(),
    collectorTemplate: {
      id: 'splunk_lookup_template',
      type: 'collection',
      collector: {
        type: 'rest',
        conf: {
          collectMethod: 'post',
          collectUrl: "'https://splunk:8089/services/search/v2/jobs/export'",
          collectRequestParams: [
            { name: 'search', value: "'| inputlookup cmdb_assets.csv'" },
            { name: 'output_mode', value: "'json'" },
          ],
          authentication: 'basicSecret',
          credentialsSecret: 'splunk_lookup_reader',
        },
      },
      input: { type: 'collection', pipeline: 'splunk_lookup_staging', output: 'cribl_cloud_staging', sendToRoutes: false, metadata: [{ name: 'splunk_lookup', value: "'cmdb_assets.csv'" }] },
      schedule: { cronSchedule: '0 * * * *', enabled: true },
    },
    jobRuns: [],
    workerRows: new Map(),
    autoDeliver: opts.autoDeliver ?? false,
    dirty: {},
    calls: [],
  };
  let n = 0;
  // Unrelated pending work starts as dirty files in the group.
  for (const [g, count] of Object.entries(state.pending)) {
    state.dirty[g] = new Set(Array.from({ length: count }, (_, i) => `groups/${g}/data/samples/other${i}.json`));
  }
  const dirtyOf = (g: string) => (state.dirty[g] ??= new Set());
  const ok = (body: unknown, status = 200) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const notFound = () => new Response('Not found', { status: 404 });

  const panRows = [
    { src_ip: '10.10.10.21', src_zone: 'trust', last_user: 'jsmith', last_seen: 1 },
    { src_ip: '10.10.20.50', src_zone: 'servers', last_user: 'svc_backup', last_seen: 2 },
    { src_ip: '10.10.30.15', src_zone: 'dmz', last_user: '', last_seen: 3 },
  ];

  function deliverWorker(config: any) {
    const meta = Object.fromEntries((config.input?.metadata ?? []).map((x: any) => [x.name, JSON.parse(x.value)]));
    const search = JSON.parse(config.collector.conf.collectRequestParams.find((x: any) => x.name === 'search').value);
    let results: Record<string, unknown>[] = [];
    if (search.startsWith('| rest')) results = [
      { title: 'cmdb_assets.csv', kind: 'file', 'eai:acl.app': 'search', 'eai:acl.owner': 'admin', 'eai:acl.sharing': 'app' },
      { title: 'asset_lookup_by_str', kind: 'definition', 'eai:acl.app': 'SA-IdentityManagement', collection: 'assets_by_str' },
    ];
    else if (search.includes('cmdb_assets.csv')) results = [
      { ip: '10.10.20.10', hostname: 'WIN-DC01', criticality: 'critical' },
      { ip: '10.10.20.50', hostname: 'WIN-SRV-FS01', criticality: 'high' },
    ];
    else results = [{ ip: '10.10.10.21', hostname: 'WKS-021' }];
    state.workerRows.set(meta.sync_id, results.map((r) => ({ splunk_lookup: meta.splunk_lookup, sync_id: meta.sync_id, _time: 1, _raw: JSON.stringify({ ...r, splunk_lookup: meta.splunk_lookup, sync_id: meta.sync_id }) })));
  }
  (state as any).deliverWorker = deliverWorker;

  async function handler(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'https://cribl.local');
    const method = (init.method ?? 'GET').toUpperCase();
    const p = url.pathname;
    state.calls.push(`${method} ${url.host === 'cribl.local' ? '' : url.host}${p}${url.search}`);

    // ---- external hosts (through the App proxy in real life)
    if (url.hostname === 'feodotracker.abuse.ch')
      return ok([
        { ip_address: '198.51.100.250', port: 443, malware: 'QakBot', first_seen: '2026-10-01 10:00:00' },
        { ip_address: '203.0.113.200', port: 8080, malware: 'Emotet', first_seen: '2026-10-20 08:00:00' },
      ]);
    if (url.hostname === 'www.cisa.gov') return ok({ vulnerabilities: [{ cveID: 'CVE-2024-0001', vendorProject: 'Acme', product: 'Widget', vulnerabilityName: 'RCE', dateAdded: '2024-01-01', knownRansomwareCampaignUse: 'Known' }] });
    if (url.hostname === 'splunk.example.com') {
      (state as any).splunkCalls = [...((state as any).splunkCalls ?? []), { path: p, body: String(init.body ?? '') }];
      if (p === '/servicesNS/-/-/data/lookup-table-files')
        return ok({ entry: [
          { name: 'geo_attr_countries.csv', acl: { app: 'search', owner: 'nobody', sharing: 'global' } },
          { name: 'cmdb_assets.csv', acl: { app: 'search', owner: 'admin', sharing: 'app' } },
        ] });
      if (p === '/servicesNS/-/-/data/transforms/lookups')
        return ok({ entry: [{ name: 'asset_lookup_by_str', acl: { app: 'SA-IdentityManagement', owner: 'nobody', sharing: 'global' }, content: { external_type: 'kvstore', collection: 'assets_by_str' } }] });
      if (p === '/services/search/v2/jobs/export') {
        const search = new URLSearchParams(String(init.body ?? '')).get('search') ?? '';
        let lines: unknown[];
        if (search.includes('badcommand')) lines = [{ messages: [{ type: 'FATAL', text: 'Unknown search command "badcommand".' }] }];
        else if (search.startsWith('| inputlookup cmdb_assets.csv'))
          lines = [
            { preview: false, result: { ip: '10.10.20.50', hostname: 'WIN-SRV-FS01', criticality: 'high' } },
            { preview: false, result: { ip: '10.10.20.10', hostname: 'WIN-DC01', criticality: 'critical' } },
          ];
        else if (search.startsWith('search '))
          lines = [
            { preview: true, result: { key: 'partial' } },
            { preview: false, result: { key: 'web-prod-01', value: 'access_combined' } },
            { preview: false, result: { key: 'pa-hq-fw01', value: 'pan:traffic' } },
          ];
        else
          lines = [
            { preview: false, result: { cidr: '10.10.10.0/24', network_name: 'HQ workstations' } },
            { preview: false, result: { cidr: '10.10.20.0/24', network_name: 'HQ servers' } },
          ];
        return new Response(lines.map((l) => JSON.stringify(l)).join('\n'));
      }
      return new Response('unknown splunk path', { status: 404 });
    }
    if (url.host !== 'cribl.local') return new Response('Host not allowed', { status: 403 });

    // ---- KV
    let m = p.match(/^\/api\/v1\/kvstore\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      if (method === 'GET') return state.kv.has(key) ? new Response(state.kv.get(key)!) : notFound();
      if (method === 'PUT') {
        state.kv.set(key, String(init.body ?? ''));
        return ok({});
      }
      if (method === 'DELETE') {
        state.kv.delete(key);
        return ok({});
      }
    }

    // ---- App backend function
    if (p === '/api/v1/endpoints/runLookups' && method === 'POST') return ok({ ok: true });

    // ---- groups
    if (p === '/api/v1/master/groups' && method === 'GET')
      return ok({
        items: [
          { id: 'default', type: 'stream', workerCount: 2 },
          { id: 'chris_demo', type: 'stream', onPrem: true },
          { id: 'default_search', isSearch: true },
          { id: 'default_fleet', isFleet: true, type: 'edge' },
        ],
      });
    m = p.match(/^\/api\/v1\/master\/groups\/([^/]+)$/);
    if (m && method === 'GET') {
      const fields = url.searchParams.get('fields') ?? '';
      const item: Record<string, unknown> = { id: m[1], configVersion: 'abc' };
      if (fields.includes('git.localChanges')) item.git = { localChanges: dirtyOf(m[1]).size };
      return ok({ items: [item], count: 1 });
    }
    m = p.match(/^\/api\/v1\/master\/groups\/([^/]+)\/deploy$/);
    if (m && method === 'PATCH') {
      state.deploys.push({ group: m[1], version: JSON.parse(String(init.body)).version });
      return ok({ items: [{ id: m[1] }] });
    }
    if (p === '/api/v1/version/commit' && method === 'POST') {
      const b = JSON.parse(String(init.body));
      const dirty = dirtyOf(b.group);
      if (b.files && !state.selectiveCommit) return ok({ status: 'error', message: 'files not supported' }, 400);
      const committed = b.files ? [...dirty].filter((f) => b.files.includes(f)) : [...dirty];
      committed.forEach((f) => dirty.delete(f));
      const id = `c0ffee${(++n).toString().padStart(4, '0')}deadbeef`;
      state.commits.push({ group: b.group, message: b.message, id, files: committed } as any);
      return ok({ items: [{ commit: id, files: { created: committed, modified: [] } }] });
    }

    // ---- lookups
    m = p.match(/^\/api\/v1\/m\/([^/]+)\/system\/lookups(?:\/([^/]+))?(\/content)?$/);
    if (m) {
      const [, g, id, content] = m;
      if (g === 'default_search' && !state.searchLookupApi) return notFound();
      const store = state.lookups[g];
      if (!store) return notFound();
      if (!id && method === 'GET') return ok({ items: [...store.keys()].map((k) => ({ id: k })), count: store.size });
      if (!id && method === 'PUT') {
        const fname = url.searchParams.get('filename')!;
        const tmp = `${fname}.${(++n).toString(36)}.tmp`;
        state.uploads.set(tmp, String(init.body ?? ''));
        return ok({ filename: tmp, rows: String(init.body).split('\n').length - 1 });
      }
      const b = init.body ? JSON.parse(String(init.body)) : {};
      if (!id && method === 'POST') {
        if (store.has(b.id)) return ok('exists', 409);
        store.set(b.id, { csv: state.uploads.get(b.fileInfo.filename) ?? '', description: b.description, mode: b.mode ?? 'memory' });
        const base = b.id.replace(/\.csv$/, '');
        dirtyOf(g).add(`groups/${g}/data/lookups/${base}.csv`);
        dirtyOf(g).add(`groups/${g}/data/lookups/${base}.yml`);
        return ok({ items: [{ id: b.id }] });
      }
      if (id && !content && method === 'PATCH') {
        if (!store.has(id)) return notFound();
        store.set(id, { csv: state.uploads.get(b.fileInfo.filename) ?? '', description: b.description, mode: b.mode ?? 'memory' });
        const base = id.replace(/\.csv$/, '');
        dirtyOf(g).add(`groups/${g}/data/lookups/${base}.csv`);
        dirtyOf(g).add(`groups/${g}/data/lookups/${base}.yml`);
        return ok({ items: [{ id }] });
      }
      if (id && content && method === 'GET') return store.has(id) ? new Response(store.get(id)!.csv) : notFound();
      if (id && !content && method === 'DELETE') {
        if (!store.has(id)) return notFound();
        store.delete(id);
        const base = id.replace(/\.csv$/, '');
        dirtyOf(g).add(`groups/${g}/data/lookups/${base}.csv`);
        dirtyOf(g).add(`groups/${g}/data/lookups/${base}.yml`);
        return ok({ items: [{ id }] });
      }
    }

    // ---- collectors and jobs (Splunk through a worker)
    m = p.match(/^\/api\/v1\/m\/([^/]+)\/lib\/jobs\/([^/]+)$/);
    if (m && method === 'GET') return decodeURIComponent(m[2]) === state.collectorTemplate.id ? ok({ items: [state.collectorTemplate] }) : notFound();
    m = p.match(/^\/api\/v1\/m\/([^/]+)\/jobs(?:\/([^/]+))?$/);
    if (m && !m[2] && method === 'POST') {
      const config = JSON.parse(String(init.body));
      const id = `${Date.now()}.${++n}.adhoc.${config.id}`;
      state.jobRuns.push({ group: m[1], config, id });
      if (state.autoDeliver) deliverWorker(config);
      return ok({ items: [id], count: 1 });
    }
    if (m && m[2] && method === 'GET') return ok({ items: [{ id: m[2], status: { state: 'finished' } }] });

    // ---- saved (scheduled) searches
    m = p.match(/^\/api\/v1\/m\/([^/]+)\/search\/saved(?:\/([^/]+))?$/);
    if (m) {
      const id = m[2] ? decodeURIComponent(m[2]) : undefined;
      if (!id && method === 'POST') {
        const b = JSON.parse(String(init.body));
        if (state.savedSearches.has(b.id)) return ok('exists', 409);
        if (!b.schedule?.cronSchedule) return ok({ message: 'schedule.cronSchedule required' }, 400);
        state.savedSearches.set(b.id, b);
        return ok({ items: [b] });
      }
      if (id && method === 'GET') return state.savedSearches.has(id) ? ok({ items: [state.savedSearches.get(id)] }) : notFound();
      if (id && method === 'PATCH') {
        if (!state.savedSearches.has(id)) return notFound();
        state.savedSearches.set(id, JSON.parse(String(init.body)));
        return ok({ items: [state.savedSearches.get(id)] });
      }
      if (id && method === 'DELETE') return state.savedSearches.delete(id) ? ok({}) : notFound();
    }

    // ---- search jobs
    m = p.match(/^\/api\/v1\/m\/([^/]+)\/search\/jobs(?:\/([^/]+)\/(status|results))?$/);
    if (m) {
      const [, , jobId, what] = m;
      if (!jobId && method === 'POST') {
        const b = JSON.parse(String(init.body));
        const id = `job.${++n}`;
        state.searchJobs.set(id, { query: b.query, polls: 0 });
        const ex = /export mode=overwrite .* to lookup (\w+)/.exec(b.query);
        if (ex) state.searchExports.push({ name: ex[1], query: b.query });
        return ok({ items: [{ id, query: b.query }] });
      }
      const job = state.searchJobs.get(jobId);
      if (!job) return notFound();
      if (what === 'status') {
        job.polls++;
        return ok({ items: [{ status: job.polls >= 2 ? 'completed' : 'running' }] });
      }
      if (what === 'results') {
        let rows: Record<string, unknown>[] = [];
        if (job.query.includes('pan_traffic')) rows = panRows;
        if (job.query.includes('dest_port'))
          rows = [
            { dest_port: 3389, protocol: 'tcp', service_name: 'ms-rdp', sessions: 55 },
            { dest_port: 443, protocol: 'tcp', service_name: 'ssl', sessions: 900 },
          ];
        const syncMatch = /sync_id="([^"]+)"/.exec(job.query);
        if (syncMatch) rows = state.workerRows.get(syncMatch[1]) ?? [];
        else if (job.query.includes('splunk_lookup="test_assets.csv"'))
          rows = [
            { splunk_lookup: 'test_assets.csv', sync_id: '20261028T045249Z-83ff', _time: 10, _raw: JSON.stringify({ ip: '10.10.20.50', hostname: 'WIN-SRV-FS01', criticality: 'high', splunk_lookup: 'test_assets.csv', sync_id: '20261028T045249Z-83ff' }) },
            { splunk_lookup: 'test_assets.csv', sync_id: '20261028T045249Z-83ff', _time: 10, _raw: JSON.stringify({ ip: '10.10.20.10', hostname: 'WIN-DC01', criticality: 'critical', splunk_lookup: 'test_assets.csv', sync_id: '20261028T045249Z-83ff' }) },
          ];
        else if (job.query.includes('splunk_lookup="cmdb_assets.csv"'))
          rows = [
            { splunk_lookup: 'cmdb_assets.csv', ip: '10.0.0.9', hostname: 'OLD-HOST', _time: 1000 },
            { splunk_lookup: 'cmdb_assets.csv', ip: '10.10.20.10', hostname: 'WIN-DC01', criticality: 'critical', _time: 5000 },
            { splunk_lookup: 'cmdb_assets.csv', ip: '10.10.20.50', hostname: 'WIN-SRV-FS01', criticality: 'high', _time: 5003 },
          ];
        else if (job.query.includes('lookup_staging'))
          rows = [
            { splunk_lookup: 'subnets', sync_id: '001', cidr: '10.0.0.0/8', network_name: 'old', _time: 1 },
            { splunk_lookup: 'subnets', sync_id: '002', cidr: '10.10.0.0/16', network_name: 'HQ', _time: 2 },
            { splunk_lookup: 'subnets', sync_id: '002', cidr: '10.20.0.0/16', network_name: 'Branch', _time: 2 },
          ];
        const meta = { isFinished: true, totalEventCount: rows.length, offset: 0, job: { id: jobId } };
        return new Response([meta, ...rows].map((r) => JSON.stringify(r)).join('\n'));
      }
    }
    return new Response(`Mock has no route for ${method} ${p}`, { status: 501 });
  }

  return { state, fetch: handler };
}
