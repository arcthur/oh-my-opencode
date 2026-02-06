# Journey: Cross-Session Continuity

## User Perspective

You want long-running work to feel continuous across sessions: decisions should carry over, past failures should not be repeated, and project-specific rules should apply automatically when you touch relevant files. This journey describes the end-to-end chain that connects **Session Handoff**, **Session Reference** (`@session:...`), and **Conditional Rules** into a coherent cross-session workflow.

## End-to-End Flow

```mermaid
flowchart TD
  subgraph SessionEnd["End of Session (Session A)"]
    A1["Runtime signals\\n(messages, tool calls, files touched)"]
    A2["session.idle / manual /handoff"]
    A3["Extract HandoffPackage (structured JSON)"]
    A4["Persist to ~/.config/opencode/oh-my-opencode/handoffs/"]
  end

  subgraph SessionStart["Start of Session (Session B)"]
    B1["First user prompt"]
    B2["Auto-select top-N handoffs (project-scoped)"]
    B3["Inject handoff context into prompt"]
  end

  subgraph ExplicitRef["Explicit reference (@session:...)"]
    R1["Prompt contains @session:..."]
    R2["Resolve to stored handoff\\n(latest / ~N / ho_* / sessionId)"]
    R3["Inject resolved content with high priority"]
  end

  subgraph During["During Session (tools and delegation)"]
    D1["tool.execute.before (Read/Edit/Write/...)"]
    D2["Match Conditional Rules (AGENTS.md + config)"]
    D3["Inject applicable rules (de-duped per session)"]
    D4["tool.execute.before:delegate_task\\nappend rules to delegated prompt"]
  end

  A1 --> A2 --> A3 --> A4
  A4 --> B2
  B1 --> B2 --> B3
  B1 --> R1 --> R2 --> R3 --> B3
  D1 --> D2 --> D3
  D4 --> D2
```

## What This Journey Covers

### 1) Session Handoff (structured extraction + auto-injection)

Session handoff turns the tail of a session into a structured, reusable artifact:

- What was decided and why
- What changed (files + intent)
- What failed and should not be repeated
- Optional embeddings for semantic retrieval

Deep dive: `docs/journeys/session-handoff-and-reference.md`.

### 2) Session Reference (`@session:...`)

Session reference provides deterministic “bring context from that session” semantics. References are resolved against **stored handoffs** and injected with higher priority than auto-selected handoffs.

Deep dive: `docs/journeys/session-handoff-and-reference.md`.

### 3) Conditional Rules (context-sensitive instruction injection)

Conditional rules inject targeted constraints only when they are relevant to the current working context (e.g., file path, module, task category, skill). This avoids pushing a large policy blob into every prompt while keeping the system “ruleful” where it matters.

Deep dive: `docs/journeys/conditional-rules.md`.

## Hook Surfaces (Where the Magic Happens)

This workflow relies on these hook surfaces:

```mermaid
sequenceDiagram
  participant U as User
  participant UPS as user.prompt.submit
  participant TB as tool.execute.before
  participant DT as delegate_task
  participant Idle as session.idle

  U->>UPS: First prompt (new session)
  UPS-->>UPS: Session handoff auto-injection (+ @session resolution)

  U->>TB: Read/Edit/Write/...
  TB-->>TB: Conditional rules injection (file tools path)

  U->>DT: delegate_task(...)
  DT-->>DT: Conditional rules appended to delegated prompt

  Idle-->>Idle: Session handoff extraction + persistence
```

For the authoritative ordering and wiring, see `docs/reference/hooks.md`, `src/hooks/runtime/pipeline-order.ts`, and `src/index.ts`.

## Configuration Summary

- Session handoff and references: `session_handoff.*` (and `session_handoff.reference.*`)
- Conditional rules: `conditional_rules.*`

For schema, defaults, and precedence, see `docs/reference/configuration.md`.
