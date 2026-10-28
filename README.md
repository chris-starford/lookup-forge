# Lookup Forge

Build enrichment lookups once — from Lake searches, HTTP APIs, files or Splunk — check them, and publish the same lookup to Cribl Stream worker groups and Cribl Search.

## What This App Does

Enrichment lookups (asset owners, identities, network zones, service ports, threat indicators) usually live in several places and drift apart. Lookup Forge gives them one home:

- **Build** a lookup from a template or your own columns, from one or more sources, merged in order.
- **Check** it before anything changes: key validity (exact, CIDR, regex), empty and duplicate keys, row limits, and a block when the row count drops sharply.
- **Preview what changes** against the published version: rows added, removed and changed.
- **Publish** the same file to Cribl Search and to selected Stream worker groups. In Stream, only the lookup's own files are committed and deployed.
- **Keep it current** on a schedule, and see the history of every run.

Key capabilities:

| Area | Details |
|---|---|
| Templates | Asset inventory, identity inventory, service and port mapping (composite key port + protocol), IP and subnet mapping (CIDR), threat-intelligence indicators, vulnerability catalogue, custom |
| Sources | Cribl Search query over Lake; HTTP(S) API; file or pasted data (CSV, TSV, JSON, NDJSON, `.gz`); Splunk via a Lake staging dataset; Splunk direct over its REST API (existing lookup with browse list, or SPL results); Splunk through a Stream worker for a Splunk Cribl.Cloud can't reach (existing lookup or SPL results) |
| Keys and matching | Single or composite keys; exact, CIDR (most specific) and regex matching |
| Scale | Up to 1,000,000 rows; large files stored in chunks; Stream storage chosen automatically (disk above 100,000 rows or 10 MB) |
| Help | A "Use" panel per lookup with a ready-made Stream Lookup function and Cribl Search query; contextual help on every step |

**Intended users:** detection engineers, security and observability analysts, and Cribl platform owners who maintain enrichment data.

**Products and deployment:** Cribl.Cloud (the App Platform is Cribl.Cloud only), with Cribl Stream (cloud or hybrid worker groups), Cribl Search and Cribl Lake.

Documentation: the App's **Help** tab (also as [docs/USER_GUIDE.md](docs/USER_GUIDE.md)), the administrator [runbook](docs/RUNBOOK.md), and [Splunk setup](docs/splunk.md).

## When to Use This App

- You enrich events in Stream and also want the same context in Search, without maintaining two copies.
- Your asset or identity data comes from several systems (CMDB, IPAM, directory, observed traffic) and you want one merged, validated table.
- You keep reference data in Splunk and want it in Cribl, including from a Splunk on a private network.
- You want threat-intelligence or vulnerability feeds refreshed on a schedule, with a safety net against broken feeds.

## Before You Install

| Requirement | Details |
|---|---|
| Cribl.Cloud | An Organization with the App Platform (Preview) available |
| Roles | An Organization or Workspace administrator installs the App. Members who use it need permission to edit lookups and commit and deploy in the worker groups they publish to, and to run searches on the datasets they use |
| Plan features | Backend functions (scheduled refresh) and outbound hosts (HTTP API sources, Splunk direct) require an Enterprise plan. Without them, manual runs work for Lake, file and Splunk-staging sources |
| External systems | Optional: HTTP APIs you choose (for example CMDB, IPAM, identity provider, threat feeds); Splunk |
| Splunk through a worker | A Stream worker group whose workers can reach Splunk, a REST Collector template, a Lake staging dataset and a HEC route. See [docs/splunk.md](docs/splunk.md) |

Known limits: Cribl Search's export-to-lookup fallback is limited to 10,000 rows; scheduled Lake-based sources are limited to 10,000 rows per source; agent-driven Splunk syncs through Splunk MCP are limited to 1,000 rows per query.

## Installation

- **From the Cribl Marketplace (when listed):** an administrator opens **Apps**, finds **Lookup Forge** in the Marketplace, reviews its permissions and external access, and installs it.
- **Manually:** download the release `.tgz` from the [Releases page](https://github.com/chris-starford/lookup-forge/releases), then **Apps › Add App › Import from File**. To upgrade, use **Apps › Installed › Lookup Forge › Upgrade**, which keeps the App's saved lookups and sharing.

After installing:

1. **Permissions mode:** under **App Settings › Permissions**, use **Open** (user-based) mode. In Strict mode, Cribl Search refuses the App access to datasets.
2. **Share:** grant **App user** access to the members or teams who will use it.
3. **External API Access (optional):** authorize customer-specific hosts such as your CMDB, IPAM or Splunk Cloud (see Configuration).

## Configuration

All settings are optional; the defaults are safe for a first run.

| Setting | Where | Scope | Default | Purpose |
|---|---|---|---|---|
| Cribl Search group ID | App › Settings | Shared (whole App) | `default_search` | The Search group lookups are published to |
| Skip groups with other pending changes | App › Settings | Shared | On | Fallback safety if a selective commit is refused |
| Default Splunk staging dataset | App › Settings | Shared | `lookup_staging` | Lake dataset for Splunk staging sources |
| Diagnostics dataset | App › Settings | Shared | `$vt_dummy` | A dataset the diagnostics search reads one event from; set one every user can read |
| External hosts | App Settings › External API Access | Shared | Feodo Tracker, CISA KEV | Hosts HTTP sources may call; add your own with their paths |
| Credentials | App Settings › Key-Value Stores | Shared | None | API tokens stored as **encrypted** entries and injected by the proxy (`headers.inject`) |

Example External API Access entry for Splunk Cloud, with a token stored in KV as `splunk_token` (encrypted):

```json
{
  "id": "acme.splunkcloud.com",
  "timeout": 60000,
  "paths": { "allowlist": ["/services/search/", "/servicesNS/"] },
  "headers": { "inject": { "Authorization": "`Bearer ${kv.splunk_token}`" } }
}
```

The same pattern works for other APIs, for example Microsoft Graph (`graph.microsoft.com`, path `/v1.0/users`). Bearer tokens expire; refresh the KV entry, or use an API that issues long-lived tokens.

## How to Use

First-run checklist:

1. Open **Settings › Run diagnostics**. Every line should be green, except possibly "Search lookups API" (amber: Search-based lookups use the export operator) and "Backend function" (amber: scheduling unavailable).
2. **New lookup**, choose **IP and subnet mapping**, keep the example network, **Test source and preview**.
3. Under **Publish to**, select Search and one worker group, then **Save lookup** and **Run now**.
4. Check the result panel: Search uploaded; Stream created, committed and deployed.
5. Open **Use** on the lookup and copy the Stream Lookup function or Search query.

Typical workflow: choose a template → connect a source (and optionally additional sources) → map source fields to columns → preview, review the checks and changes → publish → set a schedule.

Expected results: the lookup appears in Stream under **Processing › Knowledge › Lookups** in each selected group, and in Cribl Search (for example `dataset="$vt_lookups"`). Each run is listed under **History**.

## Permissions and External Access

The App runs with the signed-in member's permissions (Open mode) for interactive use; its backend function (scheduled refresh) runs with the grants declared in `config/policies.yml`.

Declared Cribl API access (`config/policies.yml`):

| Methods | Path | Why |
|---|---|---|
| GET | `/master/groups` | List Stream worker groups |
| GET, PATCH | `/master/groups/*` | Read a group's pending changes; deploy a commit |
| POST | `/version/commit` | Commit only the lookup's own files |
| GET, POST, PUT | `/m/*/system/lookups` | List, upload and create lookups (Stream groups and Search) |
| GET, PATCH, DELETE | `/m/*/system/lookups/*` | Read, replace and remove lookups |
| GET | `/m/*/lib/jobs/*` | Read the saved REST Collector used as a template (Splunk through a worker) |
| POST | `/m/*/jobs` | Start a one-off collector run (Splunk through a worker) |
| GET | `/m/*/jobs/*` | Read a collector run's status |

Deliberately **not** declared, so they run only with the member's own permissions: Cribl Search jobs (`/m/*/search/jobs`) and saved searches (`/m/*/search/saved`). Scheduled searches the App creates are saved under the member who saved the lookup.

External services (`config/proxies.yml`): `feodotracker.abuse.ch` (`/downloads/`) and `www.cisa.gov` (`/sites/default/files/feeds/`), both GET without credentials, used only by the threat-intelligence and vulnerability examples. Any other host is called only if an administrator authorizes it. The App never sends credentials itself; tokens are injected by Cribl's proxy from encrypted KV entries.

## Data and Storage

| What | Where | Lifetime |
|---|---|---|
| Lookup definitions, run history (last 20 per lookup), settings | App KV store: `lm-index`, `lm-def-*`, `lm-runs-*`, `lm-settings` | Until deleted in the App |
| Large file content (over 900 KB) | App KV store: `lm-blob-*` chunks | Replaced on save; removed when the definition is deleted |
| Splunk-through-worker lookup list requests | App KV store: `lm-catalog-*` | Overwritten by each request |
| Published lookups | Stream worker groups (`<name>.csv`, committed and deployed) and Cribl Search | Until removed: rename, deselect or delete in the App offers removal |
| Scheduled searches and staging lookups | Cribl Search: saved searches and lookups named `lm_src_*` | Removed when the schedule is turned off or the lookup is deleted |
| Splunk staging rows | The Lake staging dataset you configure | That dataset's retention |

The App reads source data (Lake datasets, APIs, files, Splunk) only to build lookups, and writes only to the targets you select. It does not send data anywhere else. The App KV store is limited to 1,000 keys per App.

## Support Model

Lookup Forge is maintained by **Chris Starford**.

- Issues and feature requests: `https://github.com/chris-starford/lookup-forge/issues`
- Contact: [christopher.starford@accenture.com](mailto:christopher.starford@accenture.com)
- Security reports: private vulnerability reporting on GitHub, or email (see [SECURITY.md](SECURITY.md))
- Release notes: [CHANGELOG.md](CHANGELOG.md)
- Operations: [docs/RUNBOOK.md](docs/RUNBOOK.md)

Security fixes follow the Cribl Marketplace windows: critical within 10 days, high within 4 weeks.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Known Limitations and Troubleshooting

Limitations:

- The App Platform is in Preview; Cribl APIs may change.
- Strict permissions mode blocks Cribl Search dataset access; use Open mode.
- Scheduled refresh needs the backend function (Enterprise plan). Scheduled Lake-based sources are limited to 10,000 rows per source, and Splunk-through-worker schedules publish one cycle after Splunk changes.
- Direct Search lookup upload isn't a documented public API. The App detects it and falls back to the export operator for search-based lookups (10,000 rows).
- Cribl.Cloud cannot reach a Splunk on a private network or laptop directly; use Splunk through a worker.
- Deleting a definition only removes published lookups if you choose to.

| Symptom | Likely cause | Fix |
|---|---|---|
| "Permission denied on /…" | Path not declared, or your role lacks it | Check your role; for builders, `config/policies.yml` |
| "All the datasets addressed in this query are disallowed by permissions" | Strict mode, or a dataset you can't read | Use Open mode; set **Diagnostics dataset** to a dataset you can read |
| HTTP source returns 403 | Host not authorized | Add it under App Settings › External API Access |
| Run "Blocked" | A safety check | Read the run log: invalid keys, empty keys, row limit or a sharp drop |
| Stream group "skipped" | A selective commit was refused and the group has other pending changes | Commit or discard those changes in Stream, then run again |
| Splunk staging: "No rows…" or "waiting" | Lake hasn't written yet, or the staging route or collector isn't set up | Wait 10–20 minutes; see [docs/splunk.md](docs/splunk.md) |
| Schedule "not set up" | The scheduled search couldn't be created | Edit the lookup to see Cribl's message; check you can save searches |
