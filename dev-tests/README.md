# Development tests

Not part of the App package. Run from the project root (after `node scripts/apply-package-metadata.mjs` and `npm install`):

    npm test          # 30 engine and backend tests against a simulated Cribl API
    npm run test:ui   # 18-step browser test of the real UI against the same simulation

- `mock-cribl.ts`: simulated KV store, worker groups, lookups, selective commits, deploys, Search jobs, saved searches, collector jobs and external hosts.
- `core.test.ts`, `backend.test.ts`: engine and scheduled backend function, including upgrade compatibility and guide consistency.
- `harness.tsx`, `index.html`, `ui.test.cjs`: bundles the UI with the simulation and drives it in headless Chromium.
- `types/react-shim.d.ts`: only for type-checking without `@types/react`; the project's own types take precedence.
