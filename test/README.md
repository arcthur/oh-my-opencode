# Test Layering

This directory contains cross-module and system-level tests to keep them separate from local unit/component tests in `src/**`.

## Layers

- `test/contracts`: static contract guards (code structure, critical strings, compatibility boundaries).
- `test/docs`: documentation consistency guards (links, coverage, reference integrity).
- `test/integration`: cross-module behavior validation (real file system, real config wiring, minimal mocks).
- `test/e2e`: end-to-end smoke tests for critical user paths (CLI entrypoints and key command flows).
- `test/fixtures`: shared fixtures used by integration/e2e suites.

## Integration Standards

- No `mock.module` / `vi.mock` in `test/integration/**/*.test.ts`.
- No `spyOn` assertions against internals in `test/integration/**/*.test.ts`.
- No `vitest` usage in `test/integration/**/*.test.ts` (use `bun:test` only).
- No `as any` or TypeScript suppression directives (`@ts-ignore`, `@ts-expect-error`) in `test/integration/**/*.test.ts`.
- No fixed sleeps (`await new Promise`, direct `setTimeout`) in integration tests.
- Prefer polling (`test/integration/helpers/wait-for.ts`) against observable outcomes.
- Every integration test must reference production code under `src/`.
- Tests that mutate filesystem/process state must provide cleanup (`afterEach`/`afterAll`/`finally`).
- Outbound network client calls are blocked unless explicitly annotated (`integration-allow-network`).
- Exception path exists but must be explicit and reviewable: `integration-allow: <rule-id-1>, <rule-id-2>`.

## Commands

```bash
bun run check:integration-quality
bun run test:unit
bun run test:contracts
bun run test:docs
bun run test:integration
bun run test:e2e
bun run test:ci
```
