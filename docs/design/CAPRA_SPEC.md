# Lookup Forge 2.0: Capra interface specification

Goal: rebuild the UI with Capra, Cribl's design system, so the App looks and behaves like Cribl, without changing what it does. This document is the brief; [CAPRA_BUILD_PROMPT.md](CAPRA_BUILD_PROMPT.md) is the matching prompt for a coding assistant.

Capra is built on React Aria Components and is installed by the App scaffold. Its documentation (including `llms.txt` and the **Page Templates**) is the authority on component names and props; this spec names components by role.

## Principles

1. **Behaviour stays; presentation changes.** `src/lookup-manager/core/` is not modified. UI code calls the same functions with the same arguments.
2. **Same words.** Button, field and option labels stay exactly as they are today. The help text (`ui/help.ts`) and guide (`ui/guide.ts`) are reused unchanged. The guide test checks that every label the guide quotes still exists.
3. **Same accessibility names.** Fields keep their visible labels as accessible names; dropdowns stay comboboxes with listbox options; dialogs stay dialogs. That keeps the browser tests meaningful.
4. **Capra tokens for colour, spacing and type.** No hard-coded colours. Light and dark themes follow Cribl.
5. **One screen at a time.** Each screen is replaced and tested before the next. `ui/styles.css` shrinks as screens move over.

## Information architecture

| Area | Template | Contents |
|---|---|---|
| Lookups | Capra **Tables** page template | Summary stats, lookups table, row actions, result panel, history, Use panel |
| New / edit lookup | Capra **Setup Config** (stepper) page template | The editor as steps (below) |
| Help | Two-column documentation layout | Topic navigation with search; topic content |
| Settings | Form page | Settings, diagnostics, About |

Global: page header with title, version badge and primary action; tabs or side navigation for Lookups, Help and Settings.

## Screens

### Lookups

| Element today | Capra role | Notes |
|---|---|---|
| Summary bar (4 stat cards) | Stat / metric cards | "Need attention" uses a warning tone when above 0 |
| Lookups table | Table (sortable) | Columns: Lookup (title + file name), Type, Source, Publishes to, Schedule, Last run |
| Status badge | Status label / badge | success, partial, blocked, failed, never run |
| Run now, Edit, History, Use, Delete | Primary button + action menu | Run now stays a visible primary action; others in a row menu or button group |
| Delete confirm (two choices) | Confirmation dialog | Choices: "Delete and remove from …", "Delete definition only", Cancel |
| Running log | Inline progress panel | Live log lines; `aria-live="polite"` |
| Result panel | Panel + toast | Toast for success/failure; panel keeps per-target details |
| History view | Detail page or side panel | Last 20 runs: status, time, trigger, rows, duration, version, targets, log |
| Use panel | Side panel | Event-field inputs; two code blocks with Copy |
| Empty state | Empty state | Overview text, three steps, "Create your first lookup", "Read the quick start" |

### Editor (stepper)

| Step | Contents today | Capra roles |
|---|---|---|
| 1. Template | Template cards | Selectable cards |
| 2. Basics | Title, file name (with Stream/Search names), description, name-clash warning with "edit the existing lookup" | Text fields; inline warning banner with action |
| 3. Columns and key | Column rows (key checkbox, name, description, remove), Add column, Match mode | Editable table or repeated field group; checkbox; Select |
| 4. Source | Examples, Source type, per-type form (Search query, HTTP, file upload with format, Splunk staging, Splunk direct with browse list, Splunk through a worker with group picker and request status), Test source and preview | Button group (examples); Select; text fields; code editor/textarea; file upload; RadioGroup; table (browse list); status message |
| 5. Map fields | Column → source field (suggestions from preview), mapping-reset warning | Table with combobox inputs |
| 6. Additional sources | Repeated source cards (name, source form, add-new-keys checkbox, mapping), Move up, Remove source, Add a source | Accordion or card list |
| 7. Publish to | Search checkbox, Stream group checkboxes, storage mode, stale-location removal option | Checkbox group; Select; warning banner with checkbox |
| 8. Safety and schedule | Drop %, maximum rows, schedule, empty-key option, scheduling note | Number fields; Select; checkbox; info banner |
| 9. Review | **New in 2.0:** summary of choices + preview + change summary + Save | Summary list; preview table; diff summary |

Preview (available from step 4 onward, shown in step 9): source and lookup row counts, merge results, errors, warnings, change summary with details, first 25 rows, Download CSV.

Each step header keeps "What is this?" (popover with `help.ts` text) and "Guide ›" (opens the guide side panel without leaving the editor).

### Help

Topic navigation with search on the left; topic content on the right with previous/next. From the editor, the same content opens in a side panel (non-modal content behind a modal drawer; Escape closes; unsaved edits are kept).

### Settings

General settings form, Diagnostics (button + status list with ok/warn/error icons), About (version), How publishing works.

## States every screen must handle

Loading (skeletons, not spinners only), empty, error (Cribl's message shown; never only "failed"), partial success (per-target detail), long content (truncate with full text on demand), narrow widths (≥ 360 px), keyboard-only use, screen readers (labelled controls, live regions for run progress), light and dark themes.

## Acceptance criteria

- [ ] `npm test` passes unchanged (engine untouched)
- [ ] `npm run test:ui` passes. Selectors may change where Capra changes roles, but every current scenario stays covered
- [ ] Guide test passes: every label quoted in `ui/guide.ts` exists in the UI
- [ ] No hard-coded colours outside Capra tokens; readable in light and dark (WCAG AA contrast)
- [ ] All interactive elements reachable and operable by keyboard; visible focus
- [ ] No console errors
- [ ] `CHANGELOG.md` entry and version 2.0.0

## Out of scope for 2.0

New sources, new engine features, and changes to saved data. Those belong to later releases, so 2.0 can be judged purely on the interface.
