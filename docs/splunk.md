# Splunk sources

Lookup Forge offers three ways to get lookups and search results out of Splunk.

| Route | Use when | Setup |
|---|---|---|
| **Splunk direct** (REST API through the App proxy) | Cribl.Cloud can reach Splunk, e.g. Splunk Cloud with Cribl.Cloud's egress addresses allowlisted for the search API | Authorize the Splunk host and inject a token (README › Configuration) |
| **Splunk through a Stream worker** | Splunk is on a private network or a laptop, and a worker group can reach it | Staging setup below, plus a collector template |
| **Splunk via Lake staging** | Rows are staged by your own process, e.g. an AI agent using Splunk MCP or a scheduled collector | Staging setup below |

Both Splunk modes, an existing lookup (`| inputlookup`) or the results of any SPL search, are available on the direct and worker routes.

## Staging setup (worker and staging routes)

Rows travel outbound: Splunk → worker group → Cribl.Cloud HEC → route → Lake dataset → Lookup Forge. Nothing needs to reach Splunk from Cribl.Cloud.

In the Cribl.Cloud group that receives HEC (often `default`):

1. **Lake dataset** `lookup_staging` (7-day retention is enough), and a Cribl Lake destination for it.
2. **HEC token:** store a random value as a **Text** secret (for example `lookup_staging_hec`) and add an auth token on the Splunk HEC source that uses it. Keep the source's HEC endpoint at `/services/collector`, and leave other tokens as they are.
3. **Route** above the catch-all: filter `sourcetype == 'cribl:lookup:staging'`, pipeline `passthru`, the Lake destination, Final on.
4. Commit **all** of these files (source, secret, route, destination) and deploy. A route or destination left uncommitted means rows are accepted and then discarded.

In the worker group that can reach Splunk:

5. **Destination:** Splunk HEC to `https://default.main.<workspace>.cribl.cloud:8088/services/collector/event` with the same token (stored as a secret in this group).
6. **Pipeline** `splunk_lookup_staging`: import [pipelines/splunk_lookup_staging.json](pipelines/splunk_lookup_staging.json). It turns Splunk export lines into one row per event and keeps `splunk_lookup` and `sync_id`.
7. **Splunk account:** a read-only role (capabilities `search`, `rest_properties_get`) and user; share each lookup with that role. Store the user and password as a **Username with password** secret.
8. **REST Collector template** (for the worker route; also usable on its own schedule):

| Setting | Value |
|---|---|
| Collector ID | `splunk_lookup_template` (or any ID; enter it in the App) |
| URL | `'https://<splunk-host>:8089/services/search/v2/jobs/export'` |
| Method | POST |
| Request parameters | `search` = `'\| inputlookup <a lookup>'`, `output_mode` = `'json'`. The App replaces `search` and looks for a parameter with exactly that name |
| Authentication | Basic (credentials secret) with the secret from step 7 |
| TLS | Turn off certificate validation only for a self-signed Splunk certificate |
| Event breaker | NDJSON / one JSON object per line |
| Fields | `splunk_lookup` = `'<a lookup>'` |
| Result routing | Send to Routes off; pipeline `splunk_lookup_staging`; the destination from step 5 |

Commit only these files and deploy the group.

Check: after a run, in Cribl Search over 24 hours, `dataset="lookup_staging" | summarize rows=count() by splunk_lookup, sync_id`. Lake writes in batches; allow 5–20 minutes.

## Agent route (Splunk MCP)

An AI agent with the Splunk MCP server can read a lookup or run SPL and stage the rows with `scripts/stage_splunk_lookup.py`:

```bash
export CRIBL_HEC_URL="https://default.main.<workspace>.cribl.cloud:8088/services/collector/event"
export CRIBL_HEC_TOKEN="$(cat ~/.cribl_staging_token)"   # never on the command line
python3 scripts/stage_splunk_lookup.py --lookup <name> --file rows.json    # JSON array, NDJSON or CSV
```

Then use **Splunk via Lake staging** with that name. The Splunk MCP tool returns at most 1,000 rows per query. A ready-made prompt is in [../agent/CLAUDE_CODE_PROMPT.md](../agent/CLAUDE_CODE_PROMPT.md).
