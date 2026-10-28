// The in-app guide. Rendered by HelpView.tsx and exported to docs/USER_GUIDE.md by scripts/build-user-guide.ts,
// so the App and the document never drift apart. Keep labels identical to the UI.

export type GuideBlock =
  | { type: 'p'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'list'; items: string[] }
  | { type: 'example'; title: string; code: string; note?: string }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'tip'; text: string }
  | { type: 'warn'; text: string };

export interface GuideSection {
  id: string;
  title: string;
  summary: string;
  blocks: GuideBlock[];
}

export const GUIDE: GuideSection[] = [
  {
    id: 'how-it-works',
    title: 'How Lookup Manager works',
    summary: 'One lookup, built from your sources, checked, and published to Stream and Search.',
    blocks: [
      {
        type: 'p',
        text: 'A lookup is a table that adds context to events: who owns an IP address, which network it belongs to, what a port is, whether an indicator is known to be malicious. Lookup Manager keeps each lookup in one place and publishes the same file everywhere it is used.',
      },
      {
        type: 'steps',
        items: [
          'Read: the App reads rows from the lookup\'s main source and any additional sources (Lake searches, HTTP APIs, files, Splunk).',
          'Map: each source field is mapped to a lookup column.',
          'Merge: additional sources fill empty columns and can add new keys; the main source always wins.',
          'Check: keys are validated (exact, CIDR or regex), duplicates merged, empty keys dropped or blocked, and a sharp drop in rows blocks publishing.',
          'Compare: the new version is compared with the published one (rows added, removed, changed).',
          'Publish: the CSV is uploaded to Cribl Search and to each selected Stream worker group; in Stream, only the lookup\'s own files are committed and deployed.',
          'Use: Stream pipelines enrich events as they arrive with the Lookup function; Cribl Search enriches results with the lookup operator.',
        ],
      },
      {
        type: 'table',
        head: ['Where it is used', 'What you get'],
        rows: [
          ['Cribl Stream (Lookup function in a pipeline)', 'Context stamped on events as they arrive, so Splunk, Lake and every other destination receive it. It records what was true at the time of the event.'],
          ['Cribl Search (lookup operator)', 'Context added when you query, using the current lookup. Useful on historical Lake data.'],
        ],
      },
      { type: 'tip', text: 'Many teams use both: Stream for point-in-time context on every event, Search for the current view during an investigation.' },
    ],
  },
  {
    id: 'quick-start',
    title: 'Quick start: your first lookup in five minutes',
    summary: 'Publish an IP subnet lookup and see it in Stream and Search.',
    blocks: [
      {
        type: 'steps',
        items: [
          'Open Settings › Run diagnostics. Every line should be green; amber "Search lookups API" or "Backend function" lines are explained in the results.',
          'Go to Lookups › New lookup and choose IP and subnet mapping.',
          'Under 3. Source, keep the example "Example network (edit to match yours)" and click Test source and preview. You should see one row per network.',
          'Under 5. Publish to, keep Cribl Search ticked and tick one Stream worker group.',
          'Click Save lookup, then Run now on the lookup\'s row.',
          'Check the result panel: Search "Uploaded", and each Stream group "Created …, committed … and deployed".',
          'Click Use on the row and copy the Stream Lookup function or the Cribl Search query.',
        ],
      },
      { type: 'example', title: 'Check it in Cribl Search', code: 'dataset="$vt_lookups"' },
      { type: 'tip', text: 'Replace the example networks with your own before using the lookup for real: edit the content, or upload a CSV of your subnets.' },
    ],
  },
  {
    id: 'templates',
    title: 'Templates',
    summary: 'Starting points for common enrichment. Everything can be changed.',
    blocks: [
      {
        type: 'table',
        head: ['Template', 'Key', 'Typical use'],
        rows: [
          ['Asset inventory', 'ip (exact)', 'Owner, criticality, hostname and zone for an IP address'],
          ['Identity inventory', 'user (exact)', 'Department, manager, account type and status for an account'],
          ['Service and port mapping', 'port + protocol (composite)', 'Service name and risk for a port, e.g. internet-facing RDP'],
          ['IP and subnet mapping', 'cidr (CIDR)', 'Network name, zone and site for any IP in a range'],
          ['Threat intelligence indicators', 'indicator (exact)', 'Known-bad IPs, domains or hashes'],
          ['Vulnerability catalogue', 'cve (exact)', 'Known exploited vulnerabilities'],
          ['Custom lookup', 'your choice', 'Any columns you define'],
        ],
      },
      { type: 'p', text: 'Each template offers example sources under 3. Source › Start from an example. Examples that read Lake data name the dataset they assume; change it to yours.' },
    ],
  },
  {
    id: 'sources',
    title: 'Sources, with examples',
    summary: 'Where rows come from, and when to use each source type.',
    blocks: [
      {
        type: 'table',
        head: ['Source type', 'Use it for'],
        rows: [
          ['Cribl Search query (Lake data)', 'Lookups derived from your own data: assets or accounts seen in traffic, ports in use, indicators from detections'],
          ['HTTP(S) API', 'Systems of record and feeds: CMDB, IPAM, identity provider, threat intelligence'],
          ['File or pasted data', 'Reference data you maintain by hand; CSV, TSV, JSON, NDJSON, also .gz'],
          ['Splunk lookup via Lake staging', 'Rows staged by your own process, such as an AI agent using Splunk MCP or a scheduled collector'],
          ['Splunk (direct REST API)', 'A Splunk that Cribl.Cloud can reach, such as Splunk Cloud: an existing lookup or SPL results'],
          ['Splunk through a Stream worker', 'A Splunk on a private network or laptop: an existing lookup or SPL results, collected by a worker that can reach it'],
        ],
      },
      {
        type: 'example',
        title: 'Cribl Search query: internal assets seen in firewall traffic',
        code: 'dataset="pan_traffic"\n| where src_zone == "trust" or src_zone == "servers"\n| summarize last_seen=max(_time), last_user=take_any(user) by src_ip, src_zone',
        note: 'Map ip ← src_ip, zone ← src_zone, owner ← last_user. End Lake queries with summarize or project so the columns are predictable.',
      },
      {
        type: 'example',
        title: 'HTTP(S) API: CISA Known Exploited Vulnerabilities',
        code: 'URL:           https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json\nMethod:        GET\nFormat:        JSON\nRecords path:  vulnerabilities',
        note: 'Map cve ← cveID, vendor ← vendorProject, product ← product. Hosts other than the two built-in feeds must be authorized by an administrator.',
      },
      {
        type: 'example',
        title: 'File: a TSV of service ports',
        code: 'port\tprotocol\tservice_name\trisk\n3389\ttcp\tms-wbt-server\thigh\n53\tudp\tdomain\tlow',
        note: 'Upload ports.tsv or ports.tsv.gz; the format is detected from the file name. Files over 200 KB are summarised instead of shown in full.',
      },
      {
        type: 'example',
        title: 'Splunk (direct REST API): SPL results',
        code: 'Mode:     Splunk search (SPL) results\nSearch:   index=assets sourcetype=scanner | stats latest(os) as os, latest(owner) as owner by ip, host\nEarliest: -24h   Latest: now',
        note: 'Or choose Existing Splunk lookup and use Browse Splunk lookups to pick a lookup file or definition, including KV-store lookups.',
      },
      {
        type: 'example',
        title: 'Splunk through a Stream worker: an existing lookup',
        code: 'Worker Group:          (a group whose workers can reach Splunk)\nCollector template ID: splunk_lookup_template\nStaging dataset:       lookup_staging\nSplunk lookup name:    cmdb_assets.csv',
        note: 'Click Request from Splunk now, wait 5–20 minutes for the rows to reach Lake, then Test source and preview. Request lookup list from Splunk, then Show lookup list, lets you browse.',
      },
      { type: 'warn', text: 'Splunk through a worker and Splunk via Lake staging need a one-time setup by an administrator (staging dataset, HEC route, collector). See the runbook.' },
    ],
  },
  {
    id: 'mapping',
    title: 'Mapping source fields to columns',
    summary: 'Tell the App which source field fills each column.',
    blocks: [
      {
        type: 'table',
        head: ['You type', 'Result'],
        rows: [
          ['(leave empty)', 'Uses the source field with the same name as the column'],
          ['src_ip', 'Uses the source field src_ip'],
          ['owned_by.name', 'Reads a nested field (a dot path)'],
          ['=servicenow', 'A fixed value for every row, e.g. to record where the row came from'],
        ],
      },
      { type: 'tip', text: 'Run Test source and preview first: the mapping boxes then suggest the source\'s actual field names.' },
      { type: 'p', text: 'Changing a source\'s type resets its mapping to same-named fields, because a mapping only fits the source it was written for.' },
    ],
  },
  {
    id: 'keys',
    title: 'Keys and matching',
    summary: 'Which columns events are matched on, and how.',
    blocks: [
      {
        type: 'table',
        head: ['Match mode', 'Key holds', 'Example key', 'Matches event value'],
        rows: [
          ['Exact', 'A value', '10.10.20.50', '10.10.20.50'],
          ['CIDR', 'A network', '10.10.20.0/24', 'Any address from 10.10.20.0 to 10.10.20.255'],
          ['Regex', 'A pattern', '^svc_.*', 'svc_backup, svc_sql'],
        ],
      },
      {
        type: 'p',
        text: 'Composite key: tick Key on several columns, for example port and protocol, so 53/udp and 53/tcp are different rows. Composite keys use Exact match. CIDR and regex need a single key column.',
      },
      { type: 'tip', text: 'For overlapping networks in a CIDR lookup, Stream\'s "most specific" match picks the smallest network that contains the address. The Use panel sets this for you.' },
    ],
  },
  {
    id: 'combining',
    title: 'Combining sources',
    summary: 'Merge several sources into one lookup.',
    blocks: [
      {
        type: 'p',
        text: 'Under 4b. Additional sources, add sources that are merged into the main one in order. The main source\'s values always win. An additional source fills columns that are still empty and, if "Add rows whose key isn\'t in the sources above" is ticked, adds keys the main source doesn\'t have.',
      },
      {
        type: 'example',
        title: 'Asset inventory: CMDB first, then traffic',
        code: 'Main source:        Splunk CMDB lookup (cmdb_assets.csv)   → hostname, owner, criticality\nAdditional source:  Observed in firewall traffic           → zone; owner if the CMDB has none\n                    Add rows whose key isn\'t in the sources above: ticked\n                    → hosts on the network that the CMDB doesn\'t know about',
        note: 'Asset inventory › Start from an example › "Splunk CMDB + zones and unknown hosts from firewall traffic (combined)" sets this up. The preview reports how many cells each source filled and how many rows it added.',
      },
    ],
  },
  {
    id: 'publish',
    title: 'Publishing and using a lookup',
    summary: 'What Run now does, and how to apply the lookup in Stream and Search.',
    blocks: [
      {
        type: 'steps',
        items: [
          'Run now reads every source, merges, checks, and compares with the published version.',
          'Search: the CSV is uploaded to the Search group (or, for a search-based lookup where upload isn\'t available, rebuilt with the export operator, up to 10,000 rows).',
          'Stream, for each selected group: upload, create or replace the lookup, commit only its own two files, deploy.',
          'The result panel lists each target; History keeps the last 20 runs.',
        ],
      },
      {
        type: 'example',
        title: 'Cribl Stream: a Lookup function (from the Use panel)',
        code: '{\n  "id": "lookup",\n  "filter": "src_ip",\n  "conf": {\n    "file": "asset_inventory.csv",\n    "matchMode": "exact",\n    "inFields": [{ "eventField": "src_ip", "lookupField": "ip" }],\n    "outFields": [{ "lookupField": "owner", "eventField": "src_asset_owner" }]\n  }\n}',
        note: 'Add it to the pipeline that processes those events, then commit and deploy that group.',
      },
      {
        type: 'example',
        title: 'Cribl Search: enrich results',
        code: 'dataset="pan_traffic"\n| lookup asset_inventory on src_ip=ip\n| summarize sessions=count() by src_ip, owner, criticality',
      },
      { type: 'p', text: 'Stream storage: Automatic keeps small lookups in memory and puts lookups over 100,000 rows or 10 MB on disk, so large tables don\'t load into every worker process.' },
    ],
  },
  {
    id: 'scheduling',
    title: 'Keeping lookups current',
    summary: 'Scheduled refreshes, and what happens behind the scenes.',
    blocks: [
      {
        type: 'steps',
        items: [
          'Edit the lookup and set 6. Safety checks and schedule › Schedule, for example Hourly.',
          'Save. For each Lake-based source, the App creates a Cribl Search scheduled search, saved under your name, that refreshes a staging lookup named lm_src_….',
          'Every 15 minutes the App\'s backend function publishes lookups that are due, reading the staging lookups and any other sources.',
          'When nothing changed since the published version, nothing is published, so there are no empty commits.',
        ],
      },
      { type: 'warn', text: 'Scheduling needs the App\'s backend function (an Enterprise plan feature). Scheduled Lake-based sources are limited to 10,000 rows per source.' },
      { type: 'p', text: 'Turning the schedule back to Manual only, or deleting the lookup, removes its scheduled searches.' },
    ],
  },
  {
    id: 'lifecycle',
    title: 'Editing, renaming and deleting',
    summary: 'Change lookups safely over time.',
    blocks: [
      {
        type: 'list',
        items: [
          'Change preview: once a lookup is published, Test source and preview shows rows added, removed and changed compared with the published copy.',
          'Rename: change the file name and save. The App offers to remove the previously published file from Search and each Stream group.',
          'Deselect a target: the App offers to remove the lookup from that target.',
          'Delete: choose "Delete and remove from …" to remove published copies too, or "Delete definition only" to keep them.',
          'Same name twice: the editor warns and offers "edit the existing lookup".',
          'History: each run\'s result, targets, timing and App version.',
        ],
      },
      { type: 'warn', text: 'Removing a lookup from Stream stops enrichment in any pipeline that uses it until the pipeline points at another lookup.' },
    ],
  },
  {
    id: 'safety',
    title: 'Safety checks',
    summary: 'What blocks a run, and why.',
    blocks: [
      {
        type: 'table',
        head: ['Check', 'Effect'],
        rows: [
          ['Invalid CIDR or regex keys', 'Blocks publishing'],
          ['Empty keys', 'Rows dropped with a warning, or blocked if you tick the option'],
          ['Duplicate keys', 'Merged; the last row wins'],
          ['More rows than Maximum rows', 'Blocks publishing'],
          ['Rows dropped by more than the set percentage since the last good run', 'Blocks publishing (a common sign of a broken source)'],
          ['No targets selected', 'Nothing is published'],
        ],
      },
      { type: 'p', text: 'A blocked run publishes nothing; the previous version stays in place. The run log says which check blocked it.' },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    summary: 'Common messages and what to do.',
    blocks: [
      {
        type: 'table',
        head: ['Message or symptom', 'What to do'],
        rows: [
          ['"All the datasets addressed in this query are disallowed by permissions"', 'An administrator sets App Settings › Permissions to Open. Check you can read the dataset in Cribl Search.'],
          ['"Permission denied on …"', 'Check your role allows that action in Stream or Search.'],
          ['HTTP source returns 403', 'An administrator authorizes the host under App Settings › External API Access.'],
          ['Run Blocked', 'Open History or the run log: it names the check. Fix the source, or adjust the limit if the change is expected.'],
          ['Stream group skipped', 'The group has other uncommitted changes and a selective commit was refused. Commit or discard them in Stream, then Run now.'],
          ['"No rows for Splunk lookup …" or still waiting', 'Lake writes in batches: wait 10–20 minutes. If nothing arrives after 30 minutes, an administrator checks the collector job and staging route (runbook).'],
          ['Schedule "not set up"', 'Edit the lookup to see Cribl\'s message. You need permission to save searches in Cribl Search.'],
        ],
      },
      { type: 'tip', text: 'Settings › Run diagnostics checks every API the App uses, with your permissions, and is the quickest first step.' },
    ],
  },
  {
    id: 'glossary',
    title: 'Glossary',
    summary: 'Terms used in the App.',
    blocks: [
      {
        type: 'table',
        head: ['Term', 'Meaning'],
        rows: [
          ['Lookup', 'A table of context, published as name.csv in Stream and name in Search'],
          ['Key', 'The column(s) events are matched on'],
          ['Main source', 'The source whose values always win'],
          ['Additional source', 'A source that fills gaps and can add keys'],
          ['Target', 'Cribl Search, or a Stream worker group the lookup is published to'],
          ['Staging dataset', 'A Lake dataset where rows from Splunk wait for the App'],
          ['Sync', 'One batch of staged rows, identified by sync_id'],
          ['Selective commit', 'Committing only the lookup\'s own files, never other pending work'],
        ],
      },
    ],
  },
];

/** Section ids linked from the editor's "Guide ›" links. */
export const GUIDE_FOR = {
  basics: 'how-it-works',
  columns: 'keys',
  source: 'sources',
  mapping: 'mapping',
  extraSources: 'combining',
  publish: 'publish',
  safety: 'safety',
} as const;

/** Render the guide as Markdown (docs/USER_GUIDE.md). */
export function guideToMarkdown(appVersion: string): string {
  const out: string[] = [
    '# Lookup Manager user guide',
    '',
    `This guide is generated from the App's built-in Help (version ${appVersion}). Edit \`src/lookup-manager/ui/guide.ts\`, then run \`npx tsx scripts/build-user-guide.ts\`.`,
    '',
    '## Contents',
    '',
    ...GUIDE.map((s, i) => `${i + 1}. [${s.title}](#${s.id}) — ${s.summary}`),
    '',
  ];
  const cell = (t: string) => t.replace(/\|/g, '\\|');
  for (const s of GUIDE) {
    out.push(`<a id="${s.id}"></a>`, '', `## ${s.title}`, '', `*${s.summary}*`, '');
    for (const b of s.blocks) {
      if (b.type === 'p') out.push(b.text, '');
      else if (b.type === 'steps') out.push(...b.items.map((t, i) => `${i + 1}. ${t}`), '');
      else if (b.type === 'list') out.push(...b.items.map((t) => `- ${t}`), '');
      else if (b.type === 'tip') out.push(`> **Tip:** ${b.text}`, '');
      else if (b.type === 'warn') out.push(`> **Note:** ${b.text}`, '');
      else if (b.type === 'example') out.push(`**Example: ${b.title}**`, '', '```', b.code, '```', '', ...(b.note ? [b.note, ''] : []));
      else if (b.type === 'table')
        out.push(`| ${b.head.map(cell).join(' | ')} |`, `|${b.head.map(() => '---').join('|')}|`, ...b.rows.map((r) => `| ${r.map(cell).join(' | ')} |`), '');
    }
  }
  return out.join('\n');
}
