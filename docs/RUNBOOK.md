# Lookup Manager runbook

Operational procedures for administrators and platform owners who install, run and support Lookup Manager. For how to build and use lookups, see the in-app **Help** tab or [USER_GUIDE.md](USER_GUIDE.md).

| | |
|---|---|
| App | Lookup Manager (`lookup-manager`) |
| Owner | Chris Starford |
| Issues | `<REPOSITORY_URL>/issues` |
| Security | [SECURITY.md](../SECURITY.md) |

---

## 1. How it fits together

| Component | Where | Role |
|---|---|---|
| App UI | Cribl.Cloud, **Apps › Lookup Manager** | Members build, preview and publish lookups with their own permissions |
| App KV store | Per App | Definitions, run history, settings, large file content (`lm-*` keys) |
| Backend function `runLookups` | Per App, every 15 minutes (UTC) | Publishes scheduled lookups that are due, using the App's declared grants |
| Scheduled searches `lm_src_*` | Cribl Search › Saved Searches | One per Lake-based source of a scheduled lookup; writes a staging lookup `lm_src_*`; saved under the member who saved the lookup |
| Published lookups | Stream worker groups (`<name>.csv`) and Cribl Search | What pipelines and searches use |
| Splunk staging (optional) | A Lake dataset (e.g. `lookup_staging`), a HEC route, a worker-group collector and pipeline | Brings Splunk rows to Cribl.Cloud outbound |

Publishing to a Stream group always follows the same sequence: upload the CSV, create or replace the lookup, commit **only** `groups/<group>/data/lookups/<name>.csv` and `.yml`, then deploy that commit.

---

## 2. Prerequisites

- [ ] Cribl.Cloud Organization with the App Platform (Preview)
- [ ] Enterprise plan features if you need scheduled refresh (backend functions) or HTTP/Splunk-direct sources (outbound hosts)
- [ ] An administrator to install the App and manage its settings
- [ ] For each user: permission to edit lookups, commit and deploy in the groups they publish to, run searches on the datasets they use, and save searches (for schedules)
- [ ] For Splunk on a private network: a worker group that can reach Splunk on port 8089

---

## 3. Install and first-time configuration

1. **Install:** from the Cribl Marketplace, or **Apps › Add App › Import from File** with the release `.tgz`.
2. **Review permissions** shown during install against the README's *Permissions and External Access* table.
3. **Permissions mode:** **Apps › Installed › Lookup Manager › Settings › Permissions** → **Open** (Strict mode off). Strict mode blocks Cribl Search dataset access.
4. **Share:** grant **App user** access to the members or teams who will use it.
5. **External API Access (optional):** add each customer-specific host (CMDB, IPAM, identity provider, Splunk Cloud) with only the paths it needs. Example entries are in the README's *Configuration* section.
6. **Credentials (optional):** **Key-Value Stores** → add each API token as an **encrypted** entry, referenced by `headers.inject` in the host entry.
7. **Verify:** open the App, **Settings › Run diagnostics**. Expected: all green, except possibly *Search lookups API* (amber is fine: search-based lookups use the export operator) and *Backend function* (amber: scheduling unavailable on this plan).
8. **Smoke test:** follow the in-app **Help › Quick start** with one test worker group, then delete the test lookup with **Delete and remove from …**.

Splunk staging (only for Splunk via Lake staging or Splunk through a worker): follow [splunk.md](splunk.md), then confirm with the check query in §8.

---

## 4. Routine operations

### Weekly health check (10 minutes)

1. **Lookups** tab: the summary bar's **Need attention** should be 0. Open **History** for any lookup that isn't *Success*.
2. **Settings › Run diagnostics**: all green as in §3.
3. **Scheduled lookups:** the **Last run** time should be within each lookup's schedule.
4. **Cribl Search › Saved Searches:** every `lm_src_*` search ran recently without errors.
5. **Splunk staging** (if used): the freshness query in §8 shows a recent sync for each Splunk lookup.
6. **Stream version control:** recent `Lookup Manager:` commits touch only `data/lookups/` files.

### Adding a lookup

1. Agree the owner, source(s), key and targets with the requester.
2. Build it in the App; **Test source and preview**; check the row count, warnings and sample rows.
3. Publish first to one non-production worker group and Search; check enrichment with the snippets in the **Use** panel.
4. Add production groups, set a schedule if needed, and record the lookup's owner in its description.

### Changing a lookup

1. **Edit**, change, then **Test source and preview** and read *Changes compared with the published version*.
2. If more rows change than expected, stop and investigate the source before publishing.
3. **Save lookup**, **Run now**, and check the result panel.
4. For renames, accept the offer to remove the old file **only after** updating pipelines that reference the old name (see the warning in §7.A).

### Adding an external source

1. Confirm the host, paths and authentication with the source system's owner.
2. Add an External API Access entry with the narrowest path allowlist.
3. Store the token as an encrypted KV entry and inject it with `headers.inject`.
4. Build the lookup with **HTTP(S) API** and test it. A 403 means the host or path isn't authorized.

---

## 5. Scheduled refresh

- Each scheduled lookup has a schedule (15 minutes to daily). The backend function runs every 15 minutes and publishes lookups whose schedule is due.
- Lake-based sources are read from staging lookups written by their `lm_src_*` scheduled searches; other sources are read directly.
- Nothing is published when the data hasn't changed.
- **Pause a lookup:** edit it, set **Schedule › Manual only**, save. This also removes its scheduled searches.
- **Pause everything:** an administrator can remove the App's schedule (upgrade with `config/schedules.yml` removed) or uninstall; individual lookups keep their last published version.

Limits: 10,000 rows per scheduled Lake-based source; Splunk-through-worker schedules publish one cycle after Splunk changes.

---

## 6. Upgrades and rollback

### Upgrade

1. Read the release's `CHANGELOG.md` entry, especially *Configuration* changes (new API paths or hosts).
2. **Apps › Installed › Lookup Manager › Upgrade**, choose the new `.tgz`, review and accept the permission changes.
3. Reload the Cribl tab with Ctrl+F5. The App header shows the new version. If it still shows the old one, the browser is serving cached files: F12 › **Application › Service workers › Unregister** and **Storage › Clear site data**.
4. **Settings › Run diagnostics**, then **Run now** on one lookup.

Upgrades keep the App's KV data (lookups, history, settings) and sharing. Lookups saved by older versions keep working unchanged.

### Rollback

1. Upgrade (or re-import) the previous release's `.tgz`.
2. Run diagnostics and one lookup.
3. Lookups created or edited with features the older version doesn't know (for example composite keys or additional sources) should be checked before running.

### Releasing a build (for the maintainer)

```bash
npm run build && npm run package -- --version X.Y.Z
```

Always build and package together: packaging alone reuses the previous build. The version must match `src/lookup-manager/version.ts` and the newest `CHANGELOG.md` entry.

---

## 7. Incident playbooks

### A. A lookup published bad data

1. **Contain:** edit the lookup and set **Schedule › Manual only**, so it isn't republished.
2. **Restore the previous version in Stream:** in the affected group's version control, open the latest `Lookup Manager: update <name>.csv` commit and copy the previous file content from its diff. Paste it into a temporary lookup with source **File or pasted data**, the same file name and targets, and **Run now**. (Alternatively, fix the source and **Run now**.)
3. **Search** is restored by the same publish.
4. **Root cause:** check the run's log in **History** and the source system. Consider a lower *Block if rows drop by more than* value.

> Removing a lookup from a Stream group stops enrichment in every pipeline that references it. Prefer restoring content over removing the file.

### B. A run is Blocked

The run log names the check (invalid keys, empty keys, row limit, sharp drop). Nothing was published, and the previous version is still in place. Fix the source, or adjust the limit if the change is expected, then **Run now**.

### C. A Stream group was skipped

Cribl refused the selective commit and the group has other uncommitted changes. Ask the owner of those changes to commit or discard them in Stream, then **Run now**. Don't turn off the safety setting unless you accept that a whole-group commit can include unrelated work.

### D. Scheduled refresh isn't running

1. Diagnostics › *Backend function* must be green.
2. The lookup's **Schedule** isn't *Manual only*, and the list doesn't show "Schedule not set up" (edit the lookup to see Cribl's message).
3. **Cribl Search › Saved Searches:** the `lm_src_*` searches exist, are enabled, and ran. If the member who saved them has left or lost access, re-save the lookup as another member to recreate them.
4. The staging lookups `lm_src_*` exist in Search (`dataset="$vt_lookups"`).

### E. Splunk rows don't arrive (worker or staging routes)

Work outwards from Splunk:

1. **Collector run:** in the worker group, **Monitoring › Job Inspector**: the run finished without errors. Typical errors: Splunk unreachable from the worker, wrong credentials, missing `search` request parameter.
2. **Pipeline** `splunk_lookup_staging`: present and keeps `sync_id`.
3. **Destination** to Cribl.Cloud HEC: healthy; token matches the HEC source's staging token.
4. **HEC source and route** in the receiving group: the source's HEC endpoint is `/services/collector`; the route `sourcetype == 'cribl:lookup:staging'` is deployed (Live Data on the Lake destination shows rows when you resend).
5. **Lake:** allow 10–20 minutes; then the freshness query in §8.

### F. Permission errors after an upgrade

- *"disallowed by permissions"* on searches: Permissions mode was reset to Strict; set it back to **Open**.
- *"Permission denied on /…"*: the new release declares a path that wasn't approved, or the member's role lacks it. Re-run the upgrade and accept the permissions, or check the role.

### G. The App shows an old version or broken dropdowns

Hard-reload (Ctrl+F5). If the header version still doesn't match **App Settings › Version**, clear the service worker and site data as in §6. If App Settings shows the new version but the header doesn't, the package was built from stale output: rebuild and package together.

---

## 8. Monitoring queries (Cribl Search)

Published lookups and staging lookups:

```
dataset="$vt_lookups"
```

Splunk staging freshness (last 24 hours):

```
dataset="lookup_staging"
| summarize rows=count(), latest=max(_time) by splunk_lookup, sync_id
| sort by latest desc
```

Enrichment coverage for a Stream lookup (example: assets on firewall traffic, last hour):

```
dataset="pan_traffic"
| extend enriched=isnotempty(src_asset_owner)
| summarize events=count() by enriched
```

---

## 9. Credential rotation

| Credential | Where it lives | Rotate |
|---|---|---|
| API tokens for HTTP sources | App KV store (encrypted) | Replace the KV entry; next run uses it |
| Splunk direct token | App KV store (encrypted) | Create a new Splunk token, replace the KV entry, revoke the old one |
| Splunk staging HEC token | Secret in the HEC-receiving group and in the worker group; agent environment | Generate a value, update both secrets, deploy both groups, update `CRIBL_HEC_TOKEN` where agents run, remove the old value |
| Splunk read-only user (worker route) | Secret in the worker group | Change the password in Splunk, update the secret, deploy the group |

Run diagnostics and one affected lookup after each rotation.

---

## 10. Removing the App

Uninstalling removes the App and its KV data. It does **not** remove what the App published or created. To clean up, before uninstalling:

1. For each lookup, **Delete** → **Delete and remove from …** (removes published copies and scheduled searches), or keep the published lookups if pipelines still use them.
2. Check **Cribl Search › Saved Searches** and lookups for leftover `lm_src_*` items.
3. Optionally remove the Splunk staging route, destination, dataset and collector.

---

## 11. Reference

| Item | Value |
|---|---|
| KV keys | `lm-index`, `lm-def-<id>`, `lm-runs-<id>`, `lm-settings`, `lm-blob-<id>-<source>-<n>`, `lm-catalog-<group>`, `lm-diag` |
| Commit messages | `Lookup Manager: create|update|remove <name>.csv (...)` |
| Scheduled searches / staging lookups | `lm_src_<lookup>_<source>` |
| Staging events | sourcetype `cribl:lookup:staging`; fields `splunk_lookup`, `sync_id` |
| Backend schedule | every 15 minutes, UTC |
| Limits | 1,000,000 rows per lookup; 10,000 rows per scheduled Lake-based source and for the Search export fallback; 1,000 rows per Splunk MCP query; 1,000 KV keys per App |
