# Lookup Manager user guide

This guide is generated from the App's built-in Help (version 1.3.0). Edit `src/lookup-manager/ui/guide.ts`, then run `npx tsx scripts/build-user-guide.ts`.

## Contents

1. [How Lookup Manager works](#how-it-works) — One lookup, built from your sources, checked, and published to Stream and Search.
2. [Quick start: your first lookup in five minutes](#quick-start) — Publish an IP subnet lookup and see it in Stream and Search.
3. [Templates](#templates) — Starting points for common enrichment. Everything can be changed.
4. [Sources, with examples](#sources) — Where rows come from, and when to use each source type.
5. [Mapping source fields to columns](#mapping) — Tell the App which source field fills each column.
6. [Keys and matching](#keys) — Which columns events are matched on, and how.
7. [Combining sources](#combining) — Merge several sources into one lookup.
8. [Publishing and using a lookup](#publish) — What Run now does, and how to apply the lookup in Stream and Search.
9. [Keeping lookups current](#scheduling) — Scheduled refreshes, and what happens behind the scenes.
10. [Editing, renaming and deleting](#lifecycle) — Change lookups safely over time.
11. [Safety checks](#safety) — What blocks a run, and why.
12. [Troubleshooting](#troubleshooting) — Common messages and what to do.
13. [Glossary](#glossary) — Terms used in the App.

<a id="how-it-works"></a>

## How Lookup Manager works

*One lookup, built from your sources, checked, and published to Stream and Search.*

A lookup is a table that adds context to events: who owns an IP address, which network it belongs to, what a port is, whether an indicator is known to be malicious. Lookup Manager keeps each lookup in one place and publishes the same file everywhere it is used.

1. Read: the App reads rows from the lookup's main source and any additional sources (Lake searches, HTTP APIs, files, Splunk).
2. Map: each source field is mapped to a lookup column.
3. Merge: additional sources fill empty columns and can add new keys; the main source always wins.
4. Check: keys are validated (exact, CIDR or regex), duplicates merged, empty keys dropped or blocked, and a sharp drop in rows blocks publishing.
5. Compare: the new version is compared with the published one (rows added, removed, changed).
6. Publish: the CSV is uploaded to Cribl Search and to each selected Stream worker group; in Stream, only the lookup's own files are committed and deployed.
7. Use: Stream pipelines enrich events as they arrive with the Lookup function; Cribl Search enriches results with the lookup operator.

| Where it is used | What you get |
|---|---|
| Cribl Stream (Lookup function in a pipeline) | Context stamped on events as they arrive, so Splunk, Lake and every other destination receive it. It records what was true at the time of the event. |
| Cribl Search (lookup operator) | Context added when you query, using the current lookup. Useful on historical Lake data. |

> **Tip:** Many teams use both: Stream for point-in-time context on every event, Search for the current view during an investigation.

<a id="quick-start"></a>

## Quick start: your first lookup in five minutes

*Publish an IP subnet lookup and see it in Stream and Search.*

1. Open Settings › Run diagnostics. Every line should be green; amber "Search lookups API" or "Backend function" lines are explained in the results.
2. Go to Lookups › New lookup and choose IP and subnet mapping.
3. Under 3. Source, keep the example "Example network (edit to match yours)" and click Test source and preview. You should see one row per network.
4. Under 5. Publish to, keep Cribl Search ticked and tick one Stream worker group.
5. Click Save lookup, then Run now on the lookup's row.
6. Check the result panel: Search "Uploaded", and each Stream group "Created …, committed … and deployed".
7. Click Use on the row and copy the Stream Lookup function or the Cribl Search query.

**Example: Check it in Cribl Search**

```
dataset="$vt_lookups"
```

> **Tip:** Replace the example networks with your own before using the lookup for real: edit the content, or upload a CSV of your subnets.

<a id="templates"></a>

## Templates

*Starting points for common enrichment. Everything can be changed.*

| Template | Key | Typical use |
|---|---|---|
| Asset inventory | ip (exact) | Owner, criticality, hostname and zone for an IP address |
| Identity inventory | user (exact) | Department, manager, account type and status for an account |
| Service and port mapping | port + protocol (composite) | Service name and risk for a port, e.g. internet-facing RDP |
| IP and subnet mapping | cidr (CIDR) | Network name, zone and site for any IP in a range |
| Threat intelligence indicators | indicator (exact) | Known-bad IPs, domains or hashes |
| Vulnerability catalogue | cve (exact) | Known exploited vulnerabilities |
| Custom lookup | your choice | Any columns you define |

Each template offers example sources under 3. Source › Start from an example. Examples that read Lake data name the dataset they assume; change it to yours.

<a id="sources"></a>

## Sources, with examples

*Where rows come from, and when to use each source type.*

| Source type | Use it for |
|---|---|
| Cribl Search query (Lake data) | Lookups derived from your own data: assets or accounts seen in traffic, ports in use, indicators from detections |
| HTTP(S) API | Systems of record and feeds: CMDB, IPAM, identity provider, threat intelligence |
| File or pasted data | Reference data you maintain by hand; CSV, TSV, JSON, NDJSON, also .gz |
| Splunk lookup via Lake staging | Rows staged by your own process, such as an AI agent using Splunk MCP or a scheduled collector |
| Splunk (direct REST API) | A Splunk that Cribl.Cloud can reach, such as Splunk Cloud: an existing lookup or SPL results |
| Splunk through a Stream worker | A Splunk on a private network or laptop: an existing lookup or SPL results, collected by a worker that can reach it |

**Example: Cribl Search query: internal assets seen in firewall traffic**

```
dataset="pan_traffic"
| where src_zone == "trust" or src_zone == "servers"
| summarize last_seen=max(_time), last_user=take_any(user) by src_ip, src_zone
```

Map ip ← src_ip, zone ← src_zone, owner ← last_user. End Lake queries with summarize or project so the columns are predictable.

**Example: HTTP(S) API: CISA Known Exploited Vulnerabilities**

```
URL:           https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
Method:        GET
Format:        JSON
Records path:  vulnerabilities
```

Map cve ← cveID, vendor ← vendorProject, product ← product. Hosts other than the two built-in feeds must be authorized by an administrator.

**Example: File: a TSV of service ports**

```
port	protocol	service_name	risk
3389	tcp	ms-wbt-server	high
53	udp	domain	low
```

Upload ports.tsv or ports.tsv.gz; the format is detected from the file name. Files over 200 KB are summarised instead of shown in full.

**Example: Splunk (direct REST API): SPL results**

```
Mode:     Splunk search (SPL) results
Search:   index=assets sourcetype=scanner | stats latest(os) as os, latest(owner) as owner by ip, host
Earliest: -24h   Latest: now
```

Or choose Existing Splunk lookup and use Browse Splunk lookups to pick a lookup file or definition, including KV-store lookups.

**Example: Splunk through a Stream worker: an existing lookup**

```
Worker Group:          (a group whose workers can reach Splunk)
Collector template ID: splunk_lookup_template
Staging dataset:       lookup_staging
Splunk lookup name:    cmdb_assets.csv
```

Click Request from Splunk now, wait 5–20 minutes for the rows to reach Lake, then Test source and preview. Request lookup list from Splunk, then Show lookup list, lets you browse.

> **Note:** Splunk through a worker and Splunk via Lake staging need a one-time setup by an administrator (staging dataset, HEC route, collector). See the runbook.

<a id="mapping"></a>

## Mapping source fields to columns

*Tell the App which source field fills each column.*

| You type | Result |
|---|---|
| (leave empty) | Uses the source field with the same name as the column |
| src_ip | Uses the source field src_ip |
| owned_by.name | Reads a nested field (a dot path) |
| =servicenow | A fixed value for every row, e.g. to record where the row came from |

> **Tip:** Run Test source and preview first: the mapping boxes then suggest the source's actual field names.

Changing a source's type resets its mapping to same-named fields, because a mapping only fits the source it was written for.

<a id="keys"></a>

## Keys and matching

*Which columns events are matched on, and how.*

| Match mode | Key holds | Example key | Matches event value |
|---|---|---|---|
| Exact | A value | 10.10.20.50 | 10.10.20.50 |
| CIDR | A network | 10.10.20.0/24 | Any address from 10.10.20.0 to 10.10.20.255 |
| Regex | A pattern | ^svc_.* | svc_backup, svc_sql |

Composite key: tick Key on several columns, for example port and protocol, so 53/udp and 53/tcp are different rows. Composite keys use Exact match. CIDR and regex need a single key column.

> **Tip:** For overlapping networks in a CIDR lookup, Stream's "most specific" match picks the smallest network that contains the address. The Use panel sets this for you.

<a id="combining"></a>

## Combining sources

*Merge several sources into one lookup.*

Under 4b. Additional sources, add sources that are merged into the main one in order. The main source's values always win. An additional source fills columns that are still empty and, if "Add rows whose key isn't in the sources above" is ticked, adds keys the main source doesn't have.

**Example: Asset inventory: CMDB first, then traffic**

```
Main source:        Splunk CMDB lookup (cmdb_assets.csv)   → hostname, owner, criticality
Additional source:  Observed in firewall traffic           → zone; owner if the CMDB has none
                    Add rows whose key isn't in the sources above: ticked
                    → hosts on the network that the CMDB doesn't know about
```

Asset inventory › Start from an example › "Splunk CMDB + zones and unknown hosts from firewall traffic (combined)" sets this up. The preview reports how many cells each source filled and how many rows it added.

<a id="publish"></a>

## Publishing and using a lookup

*What Run now does, and how to apply the lookup in Stream and Search.*

1. Run now reads every source, merges, checks, and compares with the published version.
2. Search: the CSV is uploaded to the Search group (or, for a search-based lookup where upload isn't available, rebuilt with the export operator, up to 10,000 rows).
3. Stream, for each selected group: upload, create or replace the lookup, commit only its own two files, deploy.
4. The result panel lists each target; History keeps the last 20 runs.

**Example: Cribl Stream: a Lookup function (from the Use panel)**

```
{
  "id": "lookup",
  "filter": "src_ip",
  "conf": {
    "file": "asset_inventory.csv",
    "matchMode": "exact",
    "inFields": [{ "eventField": "src_ip", "lookupField": "ip" }],
    "outFields": [{ "lookupField": "owner", "eventField": "src_asset_owner" }]
  }
}
```

Add it to the pipeline that processes those events, then commit and deploy that group.

**Example: Cribl Search: enrich results**

```
dataset="pan_traffic"
| lookup asset_inventory on src_ip=ip
| summarize sessions=count() by src_ip, owner, criticality
```

Stream storage: Automatic keeps small lookups in memory and puts lookups over 100,000 rows or 10 MB on disk, so large tables don't load into every worker process.

<a id="scheduling"></a>

## Keeping lookups current

*Scheduled refreshes, and what happens behind the scenes.*

1. Edit the lookup and set 6. Safety checks and schedule › Schedule, for example Hourly.
2. Save. For each Lake-based source, the App creates a Cribl Search scheduled search, saved under your name, that refreshes a staging lookup named lm_src_….
3. Every 15 minutes the App's backend function publishes lookups that are due, reading the staging lookups and any other sources.
4. When nothing changed since the published version, nothing is published, so there are no empty commits.

> **Note:** Scheduling needs the App's backend function (an Enterprise plan feature). Scheduled Lake-based sources are limited to 10,000 rows per source.

Turning the schedule back to Manual only, or deleting the lookup, removes its scheduled searches.

<a id="lifecycle"></a>

## Editing, renaming and deleting

*Change lookups safely over time.*

- Change preview: once a lookup is published, Test source and preview shows rows added, removed and changed compared with the published copy.
- Rename: change the file name and save. The App offers to remove the previously published file from Search and each Stream group.
- Deselect a target: the App offers to remove the lookup from that target.
- Delete: choose "Delete and remove from …" to remove published copies too, or "Delete definition only" to keep them.
- Same name twice: the editor warns and offers "edit the existing lookup".
- History: each run's result, targets, timing and App version.

> **Note:** Removing a lookup from Stream stops enrichment in any pipeline that uses it until the pipeline points at another lookup.

<a id="safety"></a>

## Safety checks

*What blocks a run, and why.*

| Check | Effect |
|---|---|
| Invalid CIDR or regex keys | Blocks publishing |
| Empty keys | Rows dropped with a warning, or blocked if you tick the option |
| Duplicate keys | Merged; the last row wins |
| More rows than Maximum rows | Blocks publishing |
| Rows dropped by more than the set percentage since the last good run | Blocks publishing (a common sign of a broken source) |
| No targets selected | Nothing is published |

A blocked run publishes nothing; the previous version stays in place. The run log says which check blocked it.

<a id="troubleshooting"></a>

## Troubleshooting

*Common messages and what to do.*

| Message or symptom | What to do |
|---|---|
| "All the datasets addressed in this query are disallowed by permissions" | An administrator sets App Settings › Permissions to Open. Check you can read the dataset in Cribl Search. |
| "Permission denied on …" | Check your role allows that action in Stream or Search. |
| HTTP source returns 403 | An administrator authorizes the host under App Settings › External API Access. |
| Run Blocked | Open History or the run log: it names the check. Fix the source, or adjust the limit if the change is expected. |
| Stream group skipped | The group has other uncommitted changes and a selective commit was refused. Commit or discard them in Stream, then Run now. |
| "No rows for Splunk lookup …" or still waiting | Lake writes in batches: wait 10–20 minutes. If nothing arrives after 30 minutes, an administrator checks the collector job and staging route (runbook). |
| Schedule "not set up" | Edit the lookup to see Cribl's message. You need permission to save searches in Cribl Search. |

> **Tip:** Settings › Run diagnostics checks every API the App uses, with your permissions, and is the quickest first step.

<a id="glossary"></a>

## Glossary

*Terms used in the App.*

| Term | Meaning |
|---|---|
| Lookup | A table of context, published as name.csv in Stream and name in Search |
| Key | The column(s) events are matched on |
| Main source | The source whose values always win |
| Additional source | A source that fills gaps and can add keys |
| Target | Cribl Search, or a Stream worker group the lookup is published to |
| Staging dataset | A Lake dataset where rows from Splunk wait for the App |
| Sync | One batch of staged rows, identified by sync_id |
| Selective commit | Committing only the lookup's own files, never other pending work |

