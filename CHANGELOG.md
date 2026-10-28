# Changelog

Versions follow semantic versioning: the last number for fixes, the middle number for new features that keep existing lookups working, the first number for changes that need existing lookups or settings to be migrated.

## 1.3.0 — 2026-10-28

New:

- **Help tab:** a built-in guide covering how the App works, a five-minute quick start, templates, every source type with examples, mapping, keys and matching, combining sources, publishing and using lookups, scheduling, lifecycle, safety checks, troubleshooting and a glossary, with search and previous/next navigation.
- **Guide links in the editor:** each section has a "Guide ›" link that opens the relevant topic in a side panel, without losing unsaved changes.
- **Documentation:** `docs/USER_GUIDE.md` (generated from the in-app guide; a test keeps them identical), `docs/RUNBOOK.md` (installation, health checks, operations, upgrades and rollback, incident playbooks, monitoring queries, credential rotation, removal), `docs/splunk.md` (generic Splunk setup), and a customer-facing README in the Cribl Marketplace structure. Builder material is in `DEVELOPMENT.md`; the workshop guides are in `docs/workshop/`.
- **Repository files:** `SECURITY.md`, `CONTRIBUTING.md`, `.gitignore`, a GitHub Actions workflow (audit, build, tests, package), issue and pull-request templates, and `scripts/apply-package-metadata.mjs` (Marketplace tags, test scripts, dev dependencies).
- **Worker Group picker** for Splunk through a Stream worker, listing your groups.

Changed:

- No workshop-specific defaults: the worker group must be chosen, example labels name the dataset they assume, and `scripts/stage_splunk_lookup.py` needs `CRIBL_HEC_URL` or `--url`.
- `config/proxies.yml` no longer includes Microsoft Graph. If you used the identity example with Graph, an administrator adds `graph.microsoft.com` under App Settings › External API Access (see the README).

Tests: upgrade compatibility with lookups saved by 1.0.0; guide consistency (generated document, links and every quoted UI label).

## 1.2.3 — 2026-10-28

Fixed:

- Rebuilt so the installed package contains the 1.2.2 interface (App-drawn dropdowns). The 1.2.2 package had been created from the previous build output.

Release note: always run `npm run build && npm run package -- --version <version>` together; packaging on its own reuses the last build.

## 1.2.2 — 2026-10-28

Fixed:

- Dropdown lists were still unreadable inside the Cribl App frame on some systems, because the browser draws native dropdown lists itself. Every dropdown is now drawn by the App (`ui/Select.tsx`): readable in light and dark mode (tested at WCAG contrast 4.5:1 or better), with keyboard support (arrows, Home/End, Enter/Space, Escape, Tab, letter jump) and combobox/listbox roles for assistive technology.

## 1.2.1 — 2026-10-28

Fixed:

- Dropdown option lists could show unreadable text (light text on a light background), depending on the browser's colour mode and the page's other styles. Options and the colour scheme are now styled explicitly within the App.

## 1.2.0 — 2026-10-28

New:

- **Composite keys:** a key can span several columns (for example port + protocol). The service and port template now uses one. CIDR and regex matching still need a single key.
- **Larger lookups:** file content over 900 KB is stored in chunked KV entries; tested with 200,000 rows (about 1.3 s to map, validate, diff and serialise); maximum rows up to 1,000,000.
- **Automatic Stream storage** (the new default): in memory, or disk-based above 100,000 rows or 10 MB.
- **More file formats:** CSV, TSV, JSON arrays and NDJSON, pasted or uploaded; `.gz` files are decompressed in the browser. Large uploads are summarised instead of shown in an editable box.
- **Use panel:** a ready-made Stream Lookup function and Cribl Search query for each lookup, with editable event field names.
- **Context in the interface:** a getting-started guide on the empty screen, "What is this?" help on every editor section, and a summary bar (lookups, scheduled, rows published, need attention).

Compatibility: existing lookups keep working unchanged; `keyColumns` and the `auto` storage mode are only set on new or edited lookups.

## 1.1.0 — 2026-10-28

New:

- **Splunk through a Stream worker** source, for a Splunk that Cribl.Cloud can't reach (for example on a laptop, via `chris_demo`). Existing lookup or SPL search; lookup list fetched through the worker; each request tracked by its own `sync_id`.
- **Splunk direct** source modes: existing lookup with a browse list (lookup files and definitions, including KV-store lookups), or the results of any SPL search.
- **Combining sources:** additional sources merged into the main one in order. The main source wins; additional sources fill empty columns and can add new keys. Combined Asset example: Splunk CMDB plus zones and unknown hosts from firewall traffic.
- **Scheduling:** Cribl Search scheduled searches for Lake-based sources, saved under the member's name; the backend function publishes from their output and skips publishing when nothing changed.
- **Lifecycle:** change preview against the published version; rename or deselect a target with removal of the old file; delete with removal of published lookups.
- **Selective commits:** publishing commits only the lookup's own files, so other pending work in a group is never included.
- **Name clashes** are flagged with a link to edit the existing lookup.
- **Diagnostics dataset** setting.
- App version shown in the header and Settings, and recorded on each run and saved definition.

Fixed:

- UI calls are routed through `window.CRIBL_API_URL`, as the platform requires.
- Stable row order (sorted by key), so commits only show real changes.
- JSON held in `_raw` (for example rows staged through HEC) is unpacked for every search-based source.
- Editing an existing lookup from the name-clash warning now loads that lookup's saved details.
- Changing a source's type resets its field mapping, instead of silently keeping the previous source's mapping.
- Pending-change check asks for the git fields Cribl.Cloud returns.
- Clearer error messages that include Cribl's own reason.

Configuration (`config/policies.yml`):

- Group paths use `/m/*/...` (`/m/:gid/...` did not match in testing).
- Added: `DELETE` on `/m/*/system/lookups/*`; `/m/*/lib/jobs/*` (`GET`), `/m/*/jobs` (`POST`), `/m/*/jobs/*` (`GET`).
- Cribl Search jobs and saved searches are deliberately not declared, so they run with the member's own permissions.
- Use user-based permissions (`appAuthMode: "legacy"`); strict mode blocks Search dataset access.

## 1.0.0 — 2026-10-27

First working release:

- Templates for assets, identities, service ports, IP subnets, threat intelligence, vulnerabilities and custom lookups.
- Sources: Cribl Search query, HTTP(S) API, CSV, Splunk via Lake staging.
- Field mapping, preview, validation and safety checks.
- Publishing to Cribl Search and to Stream Worker Groups (create or replace, commit, deploy).
- Run history and diagnostics; optional scheduled backend function.
