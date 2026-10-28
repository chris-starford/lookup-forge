#!/usr/bin/env node
// Adds Marketplace metadata, test scripts and dev dependencies to the scaffold's package.json.
// Safe to run repeatedly; existing values are kept unless an option overrides them.
//   node scripts/apply-package-metadata.mjs [--repo https://github.com/<you>/<repo>] [--license Apache-2.0] [--author "Name"]
import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const path = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(path, 'utf8'));

pkg.description = 'Build enrichment lookups once and publish them to Cribl Stream worker groups and Cribl Search, from Lake searches, HTTP APIs, files and Splunk.';
pkg.keywords = [...new Set([...(pkg.keywords ?? []), 'cribl', 'cribl-app', 'lookups', 'enrichment', 'splunk'])];
pkg.Tags = { ...(pkg.Tags ?? {}), products: ['Stream', 'Search', 'Lake'] };
pkg.cribl = { ...(pkg.cribl ?? {}), appAuthMode: 'legacy' };
pkg.scripts = {
  ...(pkg.scripts ?? {}),
  test: 'tsx --test dev-tests/core.test.ts dev-tests/backend.test.ts',
  'test:ui':
    'esbuild dev-tests/harness.tsx --bundle --outfile=dev-tests/dist/app.js --format=iife --jsx=automatic --loader:.css=css --define:process.env.NODE_ENV=\'"development"\' --log-level=warning && cp dev-tests/index.html dev-tests/dist/ && node dev-tests/ui.test.cjs',
  audit: 'npm audit --audit-level=high',
};
pkg.devDependencies = { tsx: '^4.21.0', esbuild: '^0.27.0', playwright: '^1.56.0', ...(pkg.devDependencies ?? {}) };
if (args.repo) {
  pkg.repository = { type: 'git', url: `git+${args.repo.replace(/\/$/, '')}.git` };
  pkg.bugs = { url: `${args.repo.replace(/\/$/, '')}/issues` };
  pkg.homepage = `${args.repo.replace(/\/$/, '')}#readme`;
}
if (args.license) pkg.license = args.license;
if (args.author) pkg.author = args.author;

writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('package.json updated:', ['description', 'keywords', 'Tags', 'cribl.appAuthMode', 'scripts', 'devDependencies', args.repo && 'repository/bugs/homepage', args.license && 'license', args.author && 'author'].filter(Boolean).join(', '));
console.log('Next: npm install');
