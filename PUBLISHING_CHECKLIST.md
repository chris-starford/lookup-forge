# Publishing checklist

Work through this before submitting Lookup Forge to the Cribl Marketplace, and again for each major release. Requirements come from Cribl's [Publish an App to the Cribl Marketplace](https://docs.cribl.io/apps/publish-to-marketplace/); check that page for the current submission process.

## 1. Ownership and agreements

- [ ] Confirm with Accenture that you may publish this App personally (it was built during client work; many employment agreements assign such work to the employer)
- [ ] Accept Cribl's developer and Marketplace terms, and set up your publisher profile
- [ ] Licence in place: Apache-2.0 (`LICENSE`) ✓

## 2. Identity and packaging

- [x] App ID chosen: `lookup-forge` (display name "Lookup Forge"). Check it is still unused in the Marketplace before submitting. It must not change after the first listing: a new App ID is a new App, and installs would lose their saved lookups
- [ ] `package.json` `name` and the App ID are `lookup-forge`
- [ ] `package.json` has a plain description, `Tags.products` (Stream, Search, Lake), `license`, `repository`, `bugs`, `author` (run `scripts/apply-package-metadata.mjs`)
- [ ] `package.json` `version`, `src/lookup-manager/version.ts` and the newest `CHANGELOG.md` entry match
- [ ] Safe defaults on first install: no workshop values; only two public read-only feeds in `config/proxies.yml`; Open permissions mode documented

## 3. Security

- [ ] `npm audit --audit-level=high` is clean (CI enforces this)
- [ ] No secrets, workspace URLs or customer data in the repository or its history. `openapi.json` stays out of Git
- [ ] GitHub secret scanning and push protection enabled (Settings › Code security)
- [ ] Private vulnerability reporting enabled (Settings › Security)
- [ ] Dependabot alerts and security updates enabled; `.github/dependabot.yml` is present
- [ ] `config/policies.yml` declares only what the App uses; README permissions table matches
- [ ] `SECURITY.md` has a working contact and the fix windows (critical 10 days, high 4 weeks)

## 4. Quality

- [ ] CI is green on `main` (audit, build, `npm test`, `npm run test:ui`, package)
- [ ] **Fresh install** on a clean Workspace: install, Open mode, Share, diagnostics, Help › Quick start
- [ ] **Upgrade** from the previous published version: existing lookups, history and settings survive; one lookup runs
- [ ] Tested in light and dark mode, and in Chrome, Edge and Firefox
- [ ] Every README section required by the Marketplace is present and accurate: What This App Does, When to Use This App, Before You Install, Installation, Configuration, How to Use, Permissions and External Access, Data and Storage, Support Model, Known Limitations and Troubleshooting

## 5. Support readiness

- [ ] Issues enabled, with the bug and feature templates
- [ ] You can meet the fix windows, and you watch the repository for issues and security advisories
- [ ] Release process documented (`DEVELOPMENT.md`) and rehearsed: build and package together, tag, attach the `.tgz` to a GitHub release

## 6. Submit

- [ ] Follow the submission steps on Cribl's publishing page with the release `.tgz`
- [ ] Respond to review feedback; record any requested changes in `CHANGELOG.md`

## 7. After publishing

- [ ] Review Dependabot pull requests weekly; release fixes within the windows
- [ ] Keep `docs/USER_GUIDE.md` generated from the in-app guide (`npx tsx scripts/build-user-guide.ts`)
- [ ] Re-run this checklist for each major version
