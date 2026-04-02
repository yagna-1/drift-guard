# DriftGuard

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/driftguard-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/driftguard-logo-light.svg">
  <img alt="DriftGuard logo" src="./assets/driftguard-logo-light.svg">
</picture>

**Git for API shapes.**

DriftGuard is a transparent HTTP proxy that learns response schemas from real traffic, pins them in your repo, and fails CI when a breaking API change is introduced.

No contract files to author. No broker to maintain. No framework lock-in.

## Why DriftGuard

Most contract systems fail at adoption because they add authoring overhead. DriftGuard inverts that model:

`traffic -> schema pin -> drift diff -> CI enforcement`

This gives teams immediate value with low process overhead, while keeping API shape changes visible in pull requests.

## Core Capabilities

- Zero-config startup for existing backends
- Automatic schema inference from JSON responses
- Contract pinning in `.driftguard/schemas/` (git-reviewed)
- Drift classification: `BREAKING`, `WARN`, `INFO`
- CI enforcement via non-zero exit on breaking violations
- Context-aware bucketing (auth context and query variants)

## Quick Start (Bun)

```bash
bun install
bun run typecheck
bun run test
```

Start DriftGuard:

```bash
bun run cli -- start --target http://localhost:3000 --port 4000 --mode dev
```

Point your frontend or E2E tests to `http://localhost:4000` instead of the backend directly.

## Install As Package

One-line execution without cloning:

```bash
bunx drift-guard start --target http://localhost:3000
```

or:

```bash
npx drift-guard start --target http://localhost:3000
```

Both command aliases are shipped: `drift-guard` and `driftguard`.

Global install:

```bash
npm i -g drift-guard
driftguard start --target http://localhost:3000
```

## How It Works

![DriftGuard flow diagram](./assets/driftguard-flow.svg)

1. Proxy receives traffic and forwards it to the upstream backend.
2. Successful JSON responses are inferred into schema nodes.
3. Live schema snapshots are stored under `.driftguard/live/`.
4. Pinned schemas under `.driftguard/schemas/` are loaded and diffed.
5. Violations are logged to `.driftguard/violations.log`.
6. CI report fails the job when `BREAKING` violations exist.

## Modes

| Mode | Purpose | Behavior |
| --- | --- | --- |
| `dev` | local iteration | infer + diff + update pins |
| `learn` | intentional contract refresh | infer + update pins, no diff noise |
| `ci` | enforcement | diff only, no pin writes |

## CLI

Run all commands with:

```bash
bun run cli -- <command>
```

Commands:

- `start --target <url> --port <n> --mode <dev|ci|learn>`
- `list`
- `diff`
- `reset <endpointKey>`
- `approve`

## Configuration

You can configure DriftGuard in two ways:

1. Environment variables
2. Optional `driftguard.config.json` in project root

Environment variables take precedence over file values.

Example `driftguard.config.json`:

```json
{
  "mode": "dev",
  "pinAfterSamples": 5,
  "authContextEnabled": true,
  "variantParams": ["type", "view"]
}
```

| Variable | Default | Description |
| --- | --- | --- |
| `DRIFTGUARD_TARGET` | `http://localhost:3000` | Upstream backend URL |
| `DRIFTGUARD_PORT` | `4000` | Proxy port |
| `DRIFTGUARD_MODE` | `dev` | Runtime mode |
| `DRIFTGUARD_PIN_AFTER_SAMPLES` | `3` | Samples required before first pin |
| `DRIFTGUARD_AUTH_CONTEXT` | `false` | Enable auth-token-hash context buckets |
| `DRIFTGUARD_VARIANT_PARAMS` | _empty_ | CSV query params for variant buckets |
| `DRIFTGUARD_VERBOSE` | `false` | Verbose warning output |
| `DRIFTGUARD_REPORT_JSON` | `.driftguard/report.json` | CI report artifact (JSON) |
| `DRIFTGUARD_REPORT_MD` | `.driftguard/report.md` | CI report artifact (Markdown) |

## CI Integration

Use the included workflow at `.github/workflows/contract.yml` as a baseline:

1. Install dependencies
2. Run test suite through DriftGuard (`ci` mode)
3. Run `bun run contract:report`
4. Fail when any breaking drift is detected

`contract:report` also writes CI artifacts:

- `.driftguard/report.json`
- `.driftguard/report.md`

Pinned schemas are repository artifacts and should be committed. `violations.log` should not be committed.

## Contract Update Workflow

When a change is intentional:

1. Run in `learn` mode.
2. Exercise changed endpoints.
3. Review `git diff .driftguard/schemas/`.
4. Commit schema updates with the API change.

## Verification Commands

- Fast validation: `bun run test:mvp`
- Stress validation: `bun run test:battle`
- Full suite: `bun run typecheck && bun run test && bun run test:mvp && bun run test:battle`

## Limitations

- JSON success responses are the primary inference source.
- Extremely dynamic payloads may require variant/context tuning.
- Path normalization uses heuristics and may need custom extensions for edge patterns.

## Community

- [Contributing Guide](./CONTRIBUTING.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security Policy](./SECURITY.md)

## License

MIT. See `LICENSE`.
