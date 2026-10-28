// Contextual help shown in the App. Plain text, so it can move to Capra components unchanged.

export const HELP = {
  overview:
    'A lookup is a table that adds context to events: who owns an IP address, which network it belongs to, what a port is. Lookup Manager builds that table from one or more sources, checks it, and publishes the same file to Cribl Stream (enrichment as data arrives) and Cribl Search (enrichment when you query).',
  gettingStarted: [
    { title: 'Choose a template', text: 'Start from assets, identities, ports, subnets, threat intelligence, vulnerabilities, or your own columns.' },
    { title: 'Connect a source', text: 'A Cribl Search query over Lake, an HTTP API, a file, or Splunk. Combine several if one source is incomplete.' },
    { title: 'Preview and publish', text: 'See the rows, the checks and what changes, then publish to Search and your Stream worker groups.' },
  ],
  basics:
    'The file name is how pipelines and searches refer to the lookup: Stream uses name.csv, Search uses name. Changing it later publishes a new file; the App offers to remove the old one.',
  columns:
    'Columns are the fields the lookup provides. Tick Key for the column(s) events are matched on; tick several for a composite key, such as port and protocol. Exact match compares values; CIDR matches IP addresses to networks; Regex treats each key as a pattern. CIDR and Regex need a single key.',
  source:
    'Where the rows come from. Lake searches and HTTP APIs keep a lookup current; files suit reference data you maintain by hand. For Splunk, use Direct when Cribl.Cloud can reach it (for example Splunk Cloud), or Through a worker for a Splunk on a private network or laptop.',
  mapping:
    'Tell the App which source field fills each column. Leave a box empty to use the field with the same name, type =value for a fixed value, or a dot path (owned_by.name) for nested fields.',
  extraSources:
    'Add sources when one is not enough. The main source always wins; each additional source only fills columns that are still empty and, if you allow it, adds keys the main source does not have. Example: CMDB first, then zones and unknown hosts from firewall traffic.',
  publish:
    'Stream: the CSV goes to each selected worker group, then only that lookup is committed and deployed. Search: the lookup becomes available to the lookup operator. Automatic storage keeps small tables in memory and puts large ones on disk.',
  safety:
    'Checks run before anything is published: invalid keys, empty keys, row limits, and a sharp drop in rows compared with the last good run (a common sign of a broken source). Scheduled runs skip publishing when nothing changed.',
} as const;
