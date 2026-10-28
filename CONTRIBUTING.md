# Contributing

Thanks for helping improve Lookup Forge.

1. **Open an issue first** for anything beyond a small fix, so we can agree the approach.
2. **Set up** as described in [DEVELOPMENT.md](DEVELOPMENT.md).
3. **Keep the engine and UI separate:** logic in `src/lookup-manager/core/`, presentation in `src/lookup-manager/ui/`. Every Cribl API call goes in `core/cribl.ts`, with any new path added to `config/policies.yml` and the README's permissions table.
4. **Add tests** in `dev-tests/`. Extend the simulated API (`mock-cribl.ts`) to model real Cribl behaviour you rely on.
5. **Run** `npm test`, `npm run test:ui` and `npm audit --audit-level=high` before opening a pull request.
6. **Don't change saved data shapes** without a migration: existing lookups must keep working (see the upgrade-compatibility test).
7. **Never commit secrets**, workspace URLs or customer data, including in test fixtures and screenshots.

By contributing, you agree your contributions are licensed under the repository's [LICENSE](LICENSE).
