# Syncing Splunk lookups into the Lookup Manager

The App runs in Cribl.Cloud, which cannot connect to a Splunk instance on a laptop. Instead, Splunk lookup rows are **pushed outbound** to Cribl.Cloud, stored in a Lake staging dataset, and picked up by the App.

```
Scheduled path:   Splunk REST API ─► chris_demo REST Collector ─► pipeline splunk_lookup_staging ─┐
                                                                                                  ├─► default: in_splunk_hec ─► route ─► Lake dataset lookup_staging ─► Lookup Manager ─► Stream + Search
Agent path:       Splunk MCP ─► Claude Code ─► scripts/stage_splunk_lookup.py ──────────────────────┘
```

Every staging event is one lookup row in JSON, with sourcetype `cribl:lookup:staging` and a `splunk_lookup` field naming the Splunk lookup. Agent syncs also carry a `sync_id`. The App uses the newest `sync_id`, or for collector runs (no `sync_id`), the newest collection run.

For Splunk Cloud in production, none of this is needed: allowlist Cribl.Cloud's egress addresses for the Splunk Cloud search API and use the App's **Splunk REST API** source directly.

---

## Part 1 — Cribl.Cloud `default` group (needed by both paths)

### 1.1 Create the staging dataset

**Cribl Lake → Datasets → Add Dataset**

- **ID:** `lookup_staging`
- **Retention:** 7 days (staging only; the published lookups are what matter)

### 1.2 Add a Lake destination

**Stream → `default` → Data → Destinations → Cribl Lake → Add Destination**

- **Output ID:** `lake_lookup_staging`
- **Lake Dataset:** `lookup_staging`

### 1.3 Add a dedicated HEC token

1. Generate a token value on the laptop and keep it in a file only you can read:

   ```bash
   umask 077
   python3 -c "import secrets; print(secrets.token_hex(24))" > ~/.cribl_staging_token
   cat ~/.cribl_staging_token
   ```

2. **Stream → `default` → Worker Group Settings → Security → Secrets → Add Secret:** name `lookup_staging_hec`, type **Text**, value from the file.
3. **Data → Sources → Splunk HEC → `in_splunk_hec` → Auth Tokens → Add Token:** choose the secret option and `lookup_staging_hec`; description "Lookup Manager staging".

Don't change anything else on this source:

- **Leave the HEC endpoint at `/services/collector`.** It is the base path; senders add `/event`. Setting it to `/services/collector/event` breaks every sender.
- **Leave the "Default token" enabled.** It is Cribl.Cloud's built-in ingest token, and other senders may rely on it.
- **Use a secret, not a manual token.** A manual token's value is stored in plain text in the group configuration and in Git.

Cribl does not show a secret's value after saving. If you lose it, generate a new value, update the secret, and redeploy.

The HEC event endpoint is:

```
https://default.main.<workspace>.cribl.cloud:8088/services/collector/event
```

### 1.4 Add the route

**Stream → `default` → Routing → Data Routes → Add Route**, placed above the catch-all `default` route:

| Setting | Value |
|---|---|
| Name | `lookup_staging_to_lake` |
| Filter | `sourcetype == 'cribl:lookup:staging'` |
| Pipeline | `passthru` |
| Output | `lake_lookup_staging` |
| Final | On |

Commit and deploy `default`. **Include every file this part created:** the route (`groups/default/local/cribl/pipelines/route.yml`), the destination (`groups/default/local/cribl/outputs.yml`), the source and the secret. If the route or destination stays uncommitted, the HEC source accepts the rows but the workers don't have the route yet, so the rows fall through to the catch-all route and are discarded. `route.yml` holds every route in the group: review its diff and make sure the only change is the new route before committing.

### 1.5 Check it

After a sync (Part 2 or 3), run in Cribl Search:

```
dataset="lookup_staging" | summarize rows=count(), latest=max(_time) by splunk_lookup, sync_id
```

Lake writes in batches, so allow 5–10 minutes (sometimes longer) before the rows appear. Use a 24-hour time range: rows carry the sender's clock, and WSL's clock can drift after the laptop sleeps (check with `date -u`).

If rows don't appear after 20 minutes: check **Monitoring → Data → Sources → `in_splunk_hec`** for received events, then open **Live Data** on `lake_lookup_staging` and resend. Rows in Live Data mean the route works and Lake just hasn't written yet.

---

## Part 2 — Scheduled path: REST Collector on `chris_demo`

### 2.1 Splunk: a read-only user

The collector reads Splunk with its own read-only account. (This is a different credential from the HEC token in 1.3, which lets data into Cribl.)

1. **Splunk Web → Settings → Roles → New Role** `cribl_lookup_reader`: capabilities `search` and `rest_properties_get`; indexes only those you will query with SPL (none are needed for lookups).
2. **Settings → Users → New User** `cribl_lookup_reader` with that role and a strong password.
3. **Share each lookup** with the role: **Settings → Lookups → Lookup table files → (lookup) → Permissions**, read access for `cribl_lookup_reader`. Lookups created with `outputlookup` in the Search app start out private.
4. **Cribl → `chris_demo` → Worker Group Settings → Security → Secrets → Add Secret:** name `splunk_lookup_reader`, type **Username with password**.

### 2.2 Destination to Cribl.Cloud

**Stream → `chris_demo` → Data → Destinations → Splunk HEC → Add Destination**

- **Output ID:** `cribl_cloud_staging`
- **URL:** the HEC event endpoint from 1.3
- **Auth token:** the same value as `lookup_staging_hec`, stored as a secret in `chris_demo` (secrets are per group)
- Leave certificate validation **on** (Cribl.Cloud has a valid certificate).

### 2.3 Pipeline

Create an empty pipeline named `splunk_lookup_staging` in `chris_demo`. Either paste `docs/pipelines/splunk_lookup_staging.json` into it (Manage as JSON), or ask Claude to push it through the Cribl connector.

### 2.4 REST Collector (also the App's template)

**Stream → `chris_demo` → Data → Sources → Collectors → REST → Add Collector**

| Setting | Value |
|---|---|
| Collector ID | `splunk_lookup_template` |
| Collect URL | `'https://splunk:8089/services/search/v2/jobs/export'` |
| Collect method | POST |
| Collect parameters | `search` = `'\| inputlookup cmdb_assets.csv'` and `output_mode` = `'json'`, as request parameters (name/value pairs) |
| Authentication | **Basic (credentials secret)** → `splunk_lookup_reader` |
| TLS | Turn off certificate validation (the laptop Splunk uses a self-signed certificate) |
| Event breaker | NDJSON / one JSON object per line |
| Fields (Result Settings) | `splunk_lookup` = `'cmdb_assets.csv'` |
| Result routing | Send to Routes **off** · Pipeline `splunk_lookup_staging` · Destination `cribl_cloud_staging` |
| Schedule | Enable, for example hourly |

The field labels in the collector form vary between Cribl versions. The values above are what matters. Note that `splunk` resolves only inside the `cribl-demo` Docker network, which is where the laptop worker runs. Port 8089 does not need to be published.

This collector does two jobs:

- **Scheduled sync** of `cmdb_assets.csv` on its own schedule. For more lookups, clone it and change the search and the `splunk_lookup` field.
- **Template for the Lookup Manager.** The App's "Splunk through a Stream worker" source reads this collector, replaces the `search` parameter and the `splunk_lookup` field, adds a `sync_id` field, and starts a one-off run. For that to work, keep `search` as a request parameter (the App looks for a parameter named `search`), and keep the pipeline and destination settings above.

Commit and deploy `chris_demo` (only the collector, destination, secret and `splunk_lookup_staging` pipeline files), then click **Run** on the collector for the first sync.

The `splunk_lookup_staging` pipeline must keep `sync_id` (the version in `docs/pipelines/` does). Without it the App can't tell its requests apart.

---

## Part 2b — From the App: Splunk through the laptop worker

With Part 2 in place, the App can use your laptop Splunk directly, without the agent:

1. **New lookup**, choose a template, then **Source type → Splunk through a Stream worker**. The defaults are `chris_demo`, `splunk_lookup_template` and `lookup_staging`.
2. Choose **Existing Splunk lookup** (type a name, or **Request lookup list from Splunk**, wait 5–20 minutes, then **Show lookup list** and **Use** one) or **Splunk search (SPL) results**.
3. **Request from Splunk now.** The App starts a one-off collector run and remembers its `sync_id`.
4. After 5–20 minutes, **Test source and preview**. Until the rows reach Lake, the preview says it is still waiting and how long ago the request went out.
5. Map, publish, save. For scheduled refreshes, each scheduled run requests fresh data, and publishes the newest rows that have arrived, so updates land one cycle after they change in Splunk.

---

## Part 3 — Agent path: Claude Code with the Splunk MCP server

Prerequisites: the Splunk MCP server added to Claude Code (`claude mcp list` shows `splunk` connected), Part 1 completed, and this package on the laptop (for example `~/lookup-manager`).

1. Load the HEC token from the file created in 1.3, in the same terminal you will start Claude Code from:

   ```bash
   export CRIBL_HEC_TOKEN="$(cat ~/.cribl_staging_token)"
   ```

2. Start Claude Code from your home folder (`cd ~ && claude`) and paste the prompt from `agent/CLAUDE_CODE_PROMPT.md`.

3. The agent reads the lookup through MCP, writes the rows to a temporary file, runs `scripts/stage_splunk_lookup.py`, and reports the `sync_id` and row count.

4. Check Part 1.5, then run the Lookup Manager lookup that uses this Splunk lookup.

The Splunk MCP server returns at most **1,000 rows** per query, so the agent path suits small and medium lookups. For larger ones (a full CMDB, ES asset or identity tables), use the scheduled collector (Part 2) or the direct REST route.

You can test the helper without sending anything:

```bash
python3 ~/lookup-manager/scripts/stage_splunk_lookup.py --lookup cmdb_assets.csv --file /tmp/cmdb_assets.json --dry-run
```

---

## Part 4 — The lookup in the App

If you already have a lookup called `asset_inventory` (for example built from firewall traffic), the editor warns that the name is taken. Either edit that lookup and switch its source, or rename the older one first (for example to `asset_observed`); the App offers to remove the old file from where it was published.

1. **New lookup → Asset inventory**.
2. Under **Source**, choose the example **Splunk CMDB lookup (cmdb_assets.csv via Lake staging)**.
3. **Test source and preview**. You should see the five workshop hosts.
4. Publish to Search and to `default` and `chris_demo`, then **Save** and **Run now**.

The source reads the newest sync only, so rows from older syncs never leak into the published lookup.
