# Research: Cartography (Codemaps) and Codemap Injection

This document is **non-normative**. It describes the cartography and codemap injection modules, their artifacts, and current wiring status. If this conflicts with runtime behavior, the code is the source of truth.

## Status (Wiring)

As of this repo state:

- `src/features/cartography/` exists (analysis + generation + state management), but it is not exposed as a first-class runtime capability in `src/index.ts`.
- `src/hooks/codemap-injector/` exists, but it is not wired in `src/index.ts` and it is not part of the `disabled_hooks` hook surface (`HookNameSchema`).
- No stable user-facing configuration keys for cartography/codemap injection exist in `src/config/schema.ts`.
- Template artifacts exist (for example under `src/features/builtin-commands/templates/` and `src/features/builtin-skills/skills/`), but they are not necessarily loaded into the default built-in set.

Implication: you can read/modify the implementation, but you SHOULD NOT assume end-users can invoke “/cartography” or get codemap auto-injection in a default install without additional wiring work.

## Artifacts (Implemented)

Cartography generates and consumes the following artifacts:

- `codemap.md`: per-directory codemap file (`src/features/cartography/constants.ts` → `CODEMAP_FILE_NAME`).
- `project-map.md`: root project map index (`ROOT_ATLAS_FILE_NAME`).
- `.opencode/cartography.json`: project-local state for incremental updates (`STATE_FILE_NAME` under `PROJECT_STORAGE_DIR`).

The state file tracks content hashes and codemap metadata to support incremental rebuilds and staleness detection.

## Intended End-to-End Flow (When Wired)

```mermaid
flowchart TD
  subgraph Gen["Codemap generation (cartography)"]
    TRIG["Trigger\n(manual tool/command, CI job, or background workflow)"]
    DISC["Discover directories\n(include/exclude patterns)"]
    SCORE["Score directories\n(thresholds + heuristics)"]
    ANALYZE["Analyze\n(symbols, patterns, integrations)"]
    WRITE["Write artifacts\n- codemap.md\n- project-map.md\n- .opencode/cartography.json"]
    TRIG --> DISC --> SCORE --> ANALYZE --> WRITE
  end

  subgraph Inj["Context injection (codemap-injector hook)"]
    Q["User prompt"] --> CLF["Classify query type\n(architecture/refactor/etc.)"]
    READ["Read tool output"] --> FIND["Find nearest codemap\n(cache + fallback)"]
    BUDGET["Budget + dedupe\n(per session, per dir)"]
    APPEND["Append codemap summary\nto Read output"]
    CLF --> READ
    FIND --> BUDGET --> APPEND
  end

  WRITE --> FIND
```

This flow matches the intended layering in:

- Cartography: `src/features/cartography/`
- Injector: `src/hooks/codemap-injector/` + `src/features/codemap-injector/`

## Core Mechanics (Implemented)

### Directory discovery and filtering

- Defaults live in `src/features/cartography/types.ts` (`DEFAULT_CARTOGRAPHY_CONFIG`).
- Include patterns cover common languages (`ts/tsx/js/jsx/py/go/rs`).
- Excludes include build outputs, VCS dirs, and test directories.

### Complexity scoring and thresholds

Cartography uses a weighted scoring model to decide which directories merit a codemap:

- Weights and thresholds: `src/features/cartography/constants.ts` (`SCORING_WEIGHTS`, `SCORE_THRESHOLDS`).
- Decision thresholds: `SCORE_THRESHOLD_GENERATE` (generate) and `SCORE_THRESHOLD_CONDITIONAL` (conditional).
- Root directory is treated specially (root codemap is generated).

### Incremental update and staleness

- State is persisted under `.opencode/cartography.json`.
- Staleness threshold: `STALENESS_THRESHOLD` in `src/features/cartography/constants.ts`.
- Update mode computes a change report, then regenerates only impacted codemaps and updates the sisyphus.

### Codemap injection (hook implementation)

The injector hook (`src/hooks/codemap-injector/index.ts`) is designed to:

- Intercept `Read` tool output (`tool.execute.after`) and append a codemap summary for the directory.
- Optionally enqueue root project map injection based on prompt classification (`user.prompt.submit`).
- Enforce token budgets and per-session de-duplication.
- Suggest running cartography for frequently accessed directories without an exact codemap.

Again: this hook exists in code, but is not wired by default.

## Wiring / Productization Checklist (Proposed)

If you want this to become a “productized” capability (available by default and documented under Journeys/Contracts), the minimal checklist is:

1. **Expose config**: add `cartography` and `codemap_injector` config surfaces to `src/config/schema.ts` and `src/plugin-config.ts`.
2. **Wire hooks**: export `createCodemapInjectorHook` from `src/hooks/index.ts`, add hook name to the hook enum, and wire it in `src/index.ts`.
3. **Add an invocation surface**: implement a tool or command that triggers `runCartography(...)` and writes artifacts deterministically.
4. **Update capability matrix**: mark status as “wired” and add canonical docs entrypoints.

## Where to Look in Code

- Cartography module: `src/features/cartography/`
- Injector hook: `src/hooks/codemap-injector/index.ts`
- Injector cache + triggers: `src/features/codemap-injector/`
- Artifact paths and constants: `src/features/cartography/constants.ts`

