# Claude Code prompt: sync a Splunk lookup to the Cribl Lookup Manager

Paste the prompt below into Claude Code (started with `cd ~ && claude`). Change the lookup name and the script path if yours differ.

Before starting: `claude mcp list` shows `splunk` connected, and `CRIBL_HEC_TOKEN` is exported in the same terminal: `export CRIBL_HEC_TOKEN="$(cat ~/.cribl_staging_token)"` (see `docs/SPLUNK_SYNC.md`, Part 3).

The Splunk MCP tool returns at most 1,000 rows per query. For larger lookups use the scheduled collector or the direct REST route instead.

---

```text
Sync the Splunk lookup cmdb_assets.csv into Cribl's lookup staging area.

1. Using the splunk MCP server, run:  | inputlookup cmdb_assets.csv
   Retrieve every row, not a sample. First run "| inputlookup cmdb_assets.csv | stats count"
   and confirm the count is below the MCP tool's 1000-row cap; if it is not, stop and tell me.
   Confirm the number of rows returned matches the count. Do not run any search that writes
   data (no outputlookup, collect or delete).

2. Before staging, compare the rows with what was staged last time, if you have that
   information: report rows added, removed and changed, keyed on the "ip" column.
   If more than half the rows would disappear, stop and ask me before continuing.

3. Write the rows as a JSON array to /tmp/cmdb_assets.json. Include only the lookup's
   own columns.

4. Run:
   python3 ~/lookup-manager/scripts/stage_splunk_lookup.py --lookup cmdb_assets.csv --file /tmp/cmdb_assets.json
   The script reads the token from the CRIBL_HEC_TOKEN environment variable. Never print,
   echo or write the token anywhere, and never put it on the command line.

5. Report the sync_id, the number of rows staged, and any rows with an empty "ip".
   Remind me that the rows reach the Lake dataset lookup_staging after a few minutes, and
   that the Lookup Manager lookup using "Splunk via Lake staging" publishes them to
   Cribl Stream and Cribl Search.

6. Delete /tmp/cmdb_assets.json when you are done.
```

---

## Variations

- **Another lookup:** replace `cmdb_assets.csv` and the key column (`ip`) in steps 1, 2, 3 and 4.
- **Check without sending:** add `--dry-run` to the command in step 4.
- **Several lookups:** ask the agent to list the lookups it can read first, then choose which to sync. Each sync gets its own `sync_id`.
- **Drift report only:** stop after step 2, so the agent compares Splunk with the lookup Cribl already has (`dataset="lookup_staging" splunk_lookup="cmdb_assets.csv"` in Cribl Search) without staging anything.
