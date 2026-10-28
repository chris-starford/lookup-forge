// Enrichment templates: starting points for each kind of lookup.
// Users can change every column, the key, the source and the mapping after choosing a template.

import type { Column, EnrichmentType, ExtraSource, FieldMap, MatchMode, SourceConfig } from './types';

export interface SourceExample {
  label: string;
  source: SourceConfig;
  fieldMap: FieldMap[];
  /** Examples that combine sources set these too. */
  extraSources?: ExtraSource[];
}

export interface EnrichmentTemplate {
  type: EnrichmentType;
  label: string;
  summary: string;
  defaultName: string;
  columns: Column[];
  keyColumn: string;
  /** Composite key, when the template needs one. */
  keyColumns?: string[];
  matchMode: MatchMode;
  streamUse: string;
  searchUse: string;
  examples: SourceExample[];
  /** Typical event fields to match each key column against, and a prefix for the fields the lookup adds. */
  usage?: { eventFields: Record<string, string>; outPrefix: string };
}

const col = (name: string, description = ''): Column => ({ name, description });
const same = (...names: string[]): FieldMap[] => names.map((n) => ({ column: n, source: n }));

const EXAMPLE_SUBNETS = `cidr,network_name,zone,site,vlan,owner,trust_level
10.10.10.0/24,HQ workstations,trust,HQ,110,IT End User Services,internal
10.10.20.0/24,HQ servers,servers,HQ,120,Infrastructure,internal
10.10.30.0/24,HQ DMZ,dmz,HQ,130,Web Platform,restricted
10.20.0.0/24,Branch infrastructure,servers,Branch,200,Infrastructure,internal
10.20.1.0/24,Branch users,trust,Branch,201,IT End User Services,internal
10.0.0.0/8,Corporate (other),internal,Unknown,,Network Engineering,internal
198.51.100.0/24,Corporate public addresses,public,Internet edge,,Network Engineering,public
192.0.2.0/24,Documentation range (customers),external,Internet,,,untrusted
203.0.113.0/24,Documentation range (threat actors in demo),external,Internet,,,untrusted`;

const EXAMPLE_RISKY_PORTS = `port,protocol,service_name,description,risk
22,tcp,ssh,Secure Shell,medium
23,tcp,telnet,Telnet (cleartext),high
445,tcp,microsoft-ds,SMB file sharing,high
1433,tcp,ms-sql-s,Microsoft SQL Server,high
3306,tcp,mysql,MySQL,high
3389,tcp,ms-wbt-server,Remote Desktop (RDP),high
5900,tcp,vnc,VNC remote desktop,high
6667,tcp,ircd,IRC (common botnet C2),high
8080,tcp,http-alt,Alternate HTTP,medium
443,tcp,https,HTTPS,low
80,tcp,http,HTTP,low
53,udp,domain,DNS,low`;

export const TEMPLATES: EnrichmentTemplate[] = [
  {
    type: 'asset',
    usage: { eventFields: { ip: 'src_ip' }, outPrefix: 'src_asset_' },
    label: 'Asset inventory',
    summary: 'Who owns a host, what it is, and how critical it is.',
    defaultName: 'asset_inventory',
    columns: [
      col('ip', 'IPv4 address (lookup key)'),
      col('hostname'),
      col('fqdn'),
      col('asset_type', 'server, workstation, network, cloud...'),
      col('os'),
      col('owner'),
      col('business_unit'),
      col('criticality', 'low, medium, high, critical'),
      col('zone'),
      col('site'),
      col('source_system', 'Where the record came from'),
    ],
    keyColumn: 'ip',
    matchMode: 'exact',
    streamUse: 'Stamp owner and criticality on events as they arrive, so Splunk and Lake both carry them.',
    searchUse: 'Current owner and criticality during an investigation.',
    examples: [
      {
        label: 'Observed in firewall traffic (example dataset: pan_traffic)',
        source: {
          type: 'search',
          query:
            'dataset="pan_traffic"\n| where src_zone == "trust" or src_zone == "servers" or src_zone == "dmz"\n| summarize last_seen=max(_time), last_user=take_any(user) by src_ip, src_zone',
          earliest: '-24h',
          latest: 'now',
        },
        fieldMap: [
          { column: 'ip', source: 'src_ip' },
          { column: 'zone', source: 'src_zone' },
          { column: 'owner', source: 'last_user' },
          { column: 'source_system', source: '=observed:pan_traffic' },
        ],
      },
      {
        label: 'Splunk CMDB lookup (cmdb_assets.csv via Lake staging)',
        source: { type: 'splunk_staging', dataset: 'lookup_staging', splunkLookup: 'cmdb_assets.csv', earliest: '-7d' },
        fieldMap: [
          { column: 'ip', source: 'ip' },
          { column: 'hostname', source: 'hostname' },
          { column: 'asset_type', source: 'asset_type' },
          { column: 'os', source: 'os' },
          { column: 'owner', source: 'owner' },
          { column: 'business_unit', source: 'business_unit' },
          { column: 'criticality', source: 'criticality' },
          { column: 'source_system', source: '=splunk:cmdb_assets' },
        ],
      },
      {
        label: 'Splunk CMDB + zones and unknown hosts from firewall traffic (combined)',
        source: { type: 'splunk_staging', dataset: 'lookup_staging', splunkLookup: 'cmdb_assets.csv', earliest: '-7d' },
        fieldMap: [
          { column: 'ip', source: 'ip' },
          { column: 'hostname', source: 'hostname' },
          { column: 'asset_type', source: 'asset_type' },
          { column: 'os', source: 'os' },
          { column: 'owner', source: 'owner' },
          { column: 'business_unit', source: 'business_unit' },
          { column: 'criticality', source: 'criticality' },
          { column: 'source_system', source: '=splunk:cmdb_assets' },
        ],
        extraSources: [
          {
            id: 'observed',
            label: 'Observed in firewall traffic',
            source: {
              type: 'search',
              query:
                'dataset="pan_traffic"\n| where src_zone == "trust" or src_zone == "servers" or src_zone == "dmz"\n| summarize last_user=take_any(user) by src_ip, src_zone',
              earliest: '-24h',
              latest: 'now',
            },
            fieldMap: [
              { column: 'ip', source: 'src_ip' },
              { column: 'zone', source: 'src_zone' },
              { column: 'owner', source: 'last_user' },
              { column: 'source_system', source: '=observed:pan_traffic' },
            ],
            addNewKeys: true,
          },
        ],
      },
      {
        label: 'Splunk lookup, direct (cmdb_assets.csv over the Splunk REST API)',
        source: { type: 'splunk_rest', baseUrl: 'https://YOUR_STACK.splunkcloud.com:8089', mode: 'lookup', splunkLookup: 'cmdb_assets.csv' },
        fieldMap: [
          { column: 'ip', source: 'ip' },
          { column: 'hostname', source: 'hostname' },
          { column: 'asset_type', source: 'asset_type' },
          { column: 'os', source: 'os' },
          { column: 'owner', source: 'owner' },
          { column: 'business_unit', source: 'business_unit' },
          { column: 'criticality', source: 'criticality' },
          { column: 'source_system', source: '=splunk:cmdb_assets' },
        ],
      },
      {
        label: 'ServiceNow CMDB (Table API)',
        source: {
          type: 'http',
          url: 'https://YOUR_INSTANCE.service-now.com/api/now/table/cmdb_ci_computer?sysparm_fields=ip_address,name,fqdn,os,owned_by.name,department.name&sysparm_limit=10000',
          method: 'GET',
          format: 'json',
          dataPath: 'result',
        },
        fieldMap: [
          { column: 'ip', source: 'ip_address' },
          { column: 'hostname', source: 'name' },
          { column: 'fqdn', source: 'fqdn' },
          { column: 'os', source: 'os' },
          { column: 'owner', source: 'owned_by.name' },
          { column: 'business_unit', source: 'department.name' },
          { column: 'source_system', source: '=servicenow' },
        ],
      },
    ],
  },
  {
    type: 'identity',
    usage: { eventFields: { user: 'user' }, outPrefix: 'user_' },
    label: 'Identity inventory',
    summary: 'Who an account belongs to and whether it is privileged.',
    defaultName: 'identity_inventory',
    columns: [
      col('user', 'Account name (lookup key)'),
      col('display_name'),
      col('email'),
      col('department'),
      col('manager'),
      col('account_type', 'human or service'),
      col('privileged', 'true or false'),
      col('status', 'active, disabled...'),
      col('source_system'),
    ],
    keyColumn: 'user',
    matchMode: 'exact',
    streamUse: 'Stamp department and account type on authentication events.',
    searchUse: "Current role, manager and status of an account under investigation.",
    examples: [
      {
        label: 'Observed in Windows logons (example dataset: windows_security)',
        source: {
          type: 'search',
          query:
            'dataset="windows_security"\n| where event_id == 4624 and isnotempty(user)\n| summarize last_logon=max(_time), logons=count() by user\n| extend account_type=iif(user startswith "svc_", "service", "human")',
          earliest: '-24h',
          latest: 'now',
        },
        fieldMap: [
          { column: 'user', source: 'user' },
          { column: 'account_type', source: 'account_type' },
          { column: 'source_system', source: '=observed:windows_security' },
        ],
      },
      {
        label: 'Microsoft Entra ID users (Graph API)',
        source: {
          type: 'http',
          url: 'https://graph.microsoft.com/v1.0/users?$select=userPrincipalName,displayName,mail,department,accountEnabled&$top=999',
          method: 'GET',
          format: 'json',
          dataPath: 'value',
        },
        fieldMap: [
          { column: 'user', source: 'userPrincipalName' },
          { column: 'display_name', source: 'displayName' },
          { column: 'email', source: 'mail' },
          { column: 'department', source: 'department' },
          { column: 'status', source: 'accountEnabled' },
          { column: 'account_type', source: '=human' },
          { column: 'source_system', source: '=entra_id' },
        ],
      },
    ],
  },
  {
    type: 'service_port',
    usage: { eventFields: { port: 'dest_port', protocol: 'protocol' }, outPrefix: 'dest_service_' },
    label: 'Service and port mapping',
    summary: 'What a port is and how risky it is to see it in use.',
    defaultName: 'service_ports',
    columns: [
      col('port', 'Port number (key)'),
      col('protocol', 'tcp or udp (key)'),
      col('service_name'),
      col('description'),
      col('risk', 'low, medium, high'),
    ],
    keyColumn: 'port',
    keyColumns: ['port', 'protocol'],
    matchMode: 'exact',
    streamUse: 'Label traffic with a service name and risk, for example internet-facing RDP. Keyed on port and protocol together.',
    searchUse: 'Hunt for unusual or risky ports across Lake data.',
    examples: [
      {
        label: 'Curated risk list (edit to suit)',
        source: { type: 'csv', content: EXAMPLE_RISKY_PORTS },
        fieldMap: same('port', 'protocol', 'service_name', 'description', 'risk'),
      },
      {
        label: 'Ports observed in firewall traffic (example dataset: pan_traffic)',
        source: {
          type: 'search',
          query: 'dataset="pan_traffic"\n| summarize sessions=count(), service_name=take_any(app) by dest_port, protocol',
          earliest: '-24h',
          latest: 'now',
        },
        fieldMap: [
          { column: 'port', source: 'dest_port' },
          { column: 'protocol', source: 'protocol' },
          { column: 'service_name', source: 'service_name' },
          { column: 'risk', source: '=unrated' },
        ],
      },
    ],
  },
  {
    type: 'ip_subnet',
    usage: { eventFields: { cidr: 'src_ip' }, outPrefix: 'src_net_' },
    label: 'IP and subnet mapping',
    summary: 'Which network, zone and site an IP address belongs to (CIDR match).',
    defaultName: 'ip_subnets',
    columns: [
      col('cidr', 'Network in CIDR notation (lookup key)'),
      col('network_name'),
      col('zone'),
      col('site'),
      col('vlan'),
      col('owner'),
      col('trust_level'),
    ],
    keyColumn: 'cidr',
    matchMode: 'cidr',
    streamUse: 'Tag source and destination zone and site on every event; route or drop by network. Use CIDR mode with "most specific" match.',
    searchUse: 'Label any IP in historical Lake data with its network.',
    examples: [
      {
        label: 'Example network (edit to match yours)',
        source: { type: 'csv', content: EXAMPLE_SUBNETS },
        fieldMap: same('cidr', 'network_name', 'zone', 'site', 'vlan', 'owner', 'trust_level'),
      },
      {
        label: 'NetBox IPAM prefixes',
        source: {
          type: 'http',
          url: 'https://YOUR_NETBOX/api/ipam/prefixes/?limit=1000',
          method: 'GET',
          format: 'json',
          dataPath: 'results',
        },
        fieldMap: [
          { column: 'cidr', source: 'prefix' },
          { column: 'network_name', source: 'description' },
          { column: 'site', source: 'scope.name' },
          { column: 'vlan', source: 'vlan.vid' },
          { column: 'owner', source: 'tenant.name' },
          { column: 'zone', source: 'role.name' },
        ],
      },
    ],
  },
  {
    type: 'threat_intel',
    usage: { eventFields: { indicator: 'dest_ip' }, outPrefix: 'ti_' },
    label: 'Threat intelligence indicators',
    summary: 'Known-bad IPs, domains or hashes from feeds or your own detections.',
    defaultName: 'threat_indicators',
    columns: [
      col('indicator', 'IP, domain or hash (lookup key)'),
      col('indicator_type'),
      col('threat'),
      col('confidence'),
      col('first_seen'),
      col('source_system'),
    ],
    keyColumn: 'indicator',
    matchMode: 'exact',
    streamUse: 'Flag matching events as they arrive and route them to the SOC.',
    searchUse: 'Retro-hunt: find past contact with newly published indicators.',
    examples: [
      {
        label: 'abuse.ch Feodo Tracker botnet C2 IPs',
        source: {
          type: 'http',
          url: 'https://feodotracker.abuse.ch/downloads/ipblocklist.json',
          method: 'GET',
          format: 'json',
        },
        fieldMap: [
          { column: 'indicator', source: 'ip_address' },
          { column: 'indicator_type', source: '=ipv4' },
          { column: 'threat', source: 'malware' },
          { column: 'first_seen', source: 'first_seen' },
          { column: 'confidence', source: '=high' },
          { column: 'source_system', source: '=abuse.ch_feodo' },
        ],
      },
      {
        label: 'Threat objects flagged by Lake detections (example dataset: cyber_alerts)',
        source: {
          type: 'search',
          query:
            'dataset="cyber_alerts"\n| summarize alerts=count(), first_seen=min(_time), threat=take_any(alert_name) by threat_object, threat_object_type',
          earliest: '-30d',
          latest: 'now',
        },
        fieldMap: [
          { column: 'indicator', source: 'threat_object' },
          { column: 'indicator_type', source: 'threat_object_type' },
          { column: 'threat', source: 'threat' },
          { column: 'first_seen', source: 'first_seen' },
          { column: 'confidence', source: '=medium' },
          { column: 'source_system', source: '=cribl_lake_detections' },
        ],
      },
    ],
  },
  {
    type: 'vulnerability',
    usage: { eventFields: { cve: 'cve' }, outPrefix: 'kev_' },
    label: 'Vulnerability catalogue',
    summary: 'Known exploited vulnerabilities and their context.',
    defaultName: 'known_exploited_vulns',
    columns: [
      col('cve', 'CVE ID (lookup key)'),
      col('vendor'),
      col('product'),
      col('name'),
      col('date_added'),
      col('ransomware_use'),
    ],
    keyColumn: 'cve',
    matchMode: 'exact',
    streamUse: 'Tag vulnerability scanner or EDR events that reference an actively exploited CVE.',
    searchUse: 'Prioritise findings in Lake data by known exploitation.',
    examples: [
      {
        label: 'CISA Known Exploited Vulnerabilities',
        source: {
          type: 'http',
          url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
          method: 'GET',
          format: 'json',
          dataPath: 'vulnerabilities',
        },
        fieldMap: [
          { column: 'cve', source: 'cveID' },
          { column: 'vendor', source: 'vendorProject' },
          { column: 'product', source: 'product' },
          { column: 'name', source: 'vulnerabilityName' },
          { column: 'date_added', source: 'dateAdded' },
          { column: 'ransomware_use', source: 'knownRansomwareCampaignUse' },
        ],
      },
    ],
  },
  {
    type: 'custom',
    usage: { eventFields: {}, outPrefix: 'lkp_' },
    label: 'Custom lookup',
    summary: 'Define your own columns for any enrichment you need.',
    defaultName: 'custom_lookup',
    columns: [col('key', 'Lookup key'), col('value')],
    keyColumn: 'key',
    matchMode: 'exact',
    streamUse: 'Any enrichment, in Exact, CIDR or Regex match mode.',
    searchUse: 'Any enrichment in Lake searches.',
    examples: [
      {
        label: 'Paste CSV',
        source: { type: 'csv', content: 'key,value\nexample,1' },
        fieldMap: same('key', 'value'),
      },
      {
        label: 'Splunk search results, direct (any SPL that returns a table)',
        source: {
          type: 'splunk_rest',
          baseUrl: 'https://YOUR_STACK.splunkcloud.com:8089',
          mode: 'spl',
          splunkLookup: '',
          spl: 'index=* earliest=-24h | stats latest(sourcetype) as value by host | rename host as key',
          earliest: '-24h',
          latest: 'now',
        },
        fieldMap: same('key', 'value'),
      },
    ],
  },
];

export function getTemplate(type: EnrichmentType): EnrichmentTemplate {
  return TEMPLATES.find((t) => t.type === type) ?? TEMPLATES[TEMPLATES.length - 1];
}
