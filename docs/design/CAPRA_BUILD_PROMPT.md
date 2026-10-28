# Prompt: build the Capra interface (Lookup Forge 2.0)

Paste this into Claude Code from the project root. Work one screen at a time; review each change before accepting it.

```text
Rebuild the Lookup Forge UI with Capra, following docs/design/CAPRA_SPEC.md.

Before writing code:
1. Read AGENTS.md, docs/design/CAPRA_SPEC.md, DEVELOPMENT.md, and Capra's documentation
   (llms.txt and the Page Templates). Use Capra's Tables template for the Lookups screen and
   its Setup Config stepper for the editor.
2. List the Capra components you will use for each element in the spec's tables, and show me
   that mapping before changing anything.

Rules:
- Do not modify anything under src/lookup-manager/core/. Call the same functions.
- Keep every visible label, option text and help text exactly as today. Reuse ui/help.ts and
  ui/guide.ts unchanged.
- Keep accessible names and roles equivalent (labelled fields, comboboxes with options,
  dialogs), so dev-tests/ui.test.cjs stays meaningful. Update its selectors only where a
  Capra component changes the role, and keep every scenario.
- Use Capra tokens for colour and spacing. No hard-coded colours.
- One screen at a time, in this order: Lookups, Settings, Help, then the editor. After each
  screen run npm test, npm run test:ui and npm run build, and show me the results.

Finish with a CHANGELOG.md entry for 2.0.0 and APP_VERSION 2.0.0.
```
