# Journey: Extensibility (Hooks, Tools, Skills, MCPs)

## User Perspective

You want to add or customize behavior (new automation, new tooling, new orchestration policies) without rewriting the system.
This journey shows where each extension point lives, what must be registered, and how to validate changes end-to-end.

## End-to-End Flow

```mermaid
flowchart TD
  Idea["New capability request"] --> Pick{"What are you adding?"}

  Pick -->|Hook| H1["Implement hook (src/hooks/<name>/index.ts)"]
  H1 --> H2["Register in src/index.ts (ordering matters)"]
  H2 --> H3["Add to HookNameSchema (src/config/schema.ts)"]
  H3 --> V["Run bun test / typecheck"]

  Pick -->|Tool| T1["Implement tool (src/tools/<name>/)"]
  T1 --> T2["Register in src/tools/index.ts and src/index.ts tool table"]
  T2 --> V

  Pick -->|Skill| S1["Add skill (builtin or filesystem-discovered)"]
  S1 --> S2["Validate discovery + slash expansion"]
  S2 --> V

  Pick -->|MCP| M1["Add MCP config (src/mcp/ or skill-embedded MCP)"]
  M1 --> M2["Validate via skill_mcp tool"]
  M2 --> V
```

This journey provides a map for adding new functionality without fighting the architecture.

## Add a Hook

- Implementation: `src/hooks/<name>/index.ts`
- Registration + lifecycle order: `src/index.ts`
- Schema: add `<name>` to `HookNameSchema` in `src/config/schema.ts`
- Documentation order mirror: `src/hooks/AGENTS.md`

## Add a Tool

- Implementation: `src/tools/<name>/`
- Registration: `src/tools/index.ts` and `src/index.ts` tool table
- Prefer strict schemas and explicit argument errors.

## Add a Skill

- Built-in skills: `src/features/builtin-skills/`
- External skills: loaded via skill loader; see `docs/reference/configuration.md`

## Add an MCP

- Built-in MCPs: `src/mcp/`
- Config surface: `docs/reference/mcps.md`
