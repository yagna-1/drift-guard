## Learned User Preferences

- Prefer Bun-first tooling (`bun`, `bunx`, `bun.lock`) for scripts, tests, and CI in this repo when it is viable.
- Expect common open-source hygiene for this project: clear README, CI, and a shippable MVP structure.
- Treat pre-release work as needing full verification passes (typecheck, unit/integration tests, MVP loop, and battle/stress hooks) before calling behavior “release-ready.”

## Learned Workspace Facts

- DriftGuard is a Bun-first TypeScript MVP: reverse proxy for JSON APIs with learn vs CI modes, operational CLI (`bun run cli -- …`), Vitest tests, and GitHub Actions using `oven-sh/setup-bun`.
- Persistent runtime artifacts live under `.driftguard/` (pinned schemas, live snapshots, violations log).
- Useful runtime toggles include `DRIFTGUARD_PIN_AFTER_SAMPLES` (samples before first pin), `DRIFTGUARD_AUTH_CONTEXT`, and `DRIFTGUARD_VARIANT_PARAMS` for request bucketing.
- Typical verification entrypoints: `bun run typecheck`, `bun run test`, `bun run test:mvp`, `bun run test:battle`, and `bun run contract:report`.
