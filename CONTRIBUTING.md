# Contributing to DriftGuard

Thanks for your interest in contributing.

## Development Setup

Prerequisites:

- Bun 1.3+
- Node.js 20+

Install and verify:

```bash
bun install
bun run typecheck
bun run test
```

## Typical Workflow

1. Create a branch from `master`.
2. Make focused changes with tests.
3. Run verification locally:

```bash
bun run typecheck
bun run test
bun run test:mvp
bun run test:battle
```

4. Commit with clear, imperative messages.
5. Open a PR describing:
   - What changed
   - Why it changed
   - How it was validated

## Project Structure

- `src/` runtime and CLI implementation
- `tests/` unit and integration tests
- `scripts/` CI and battle-test helpers
- `.github/workflows/` CI workflows

## Contribution Guidelines

- Keep imports at top-level (no inline imports).
- Prefer small, composable changes over large refactors.
- Maintain Bun-first scripts and tooling.
- Add tests for behavior changes.
- Avoid introducing breaking CLI/config changes without clear migration notes.

## Reporting Bugs and Feature Requests

- Use GitHub Issues for bugs and enhancements.
- Include reproduction steps and expected vs actual behavior.
- For contract drift false positives, include sample payloads and config.

## Security Issues

Please do not file public issues for security vulnerabilities.
Use the process in `SECURITY.md`.
