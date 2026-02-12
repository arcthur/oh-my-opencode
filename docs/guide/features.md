# Feature Catalog

---

## Agents: Your AI Team

Oh-My-OpenCode provides multiple specialized AI agents (core, planning, and derived runtime agents). Each has distinct expertise, optimized models, and tool permissions.

### Core Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| **Sisyphus** | `anthropic/claude-opus-4-6` | **The default orchestrator.** Plans, delegates, and executes complex tasks using specialized subagents with aggressive parallel execution. TaskGraph-driven workflow with extended thinking (32k budget). |
| **Atlas** | `anthropic/claude-opus-4-6` | **Execution orchestrator for `/start-work`.** Runs deterministic TaskGraph progression with strict delegation and verification loops. |
| **hephaestus** | `openai/gpt-5.3-codex` | Autonomous deep worker for goal-oriented execution. Explores thoroughly, then drives end-to-end implementation with high autonomy. |
| **oracle** | `openai/gpt-5.2` | Architecture decisions, code review, debugging. Read-only consultation - stellar logical reasoning and deep analysis. Inspired by AmpCode. |
| **librarian** | `zai-coding-plan/glm-4.7` | Multi-repo analysis, documentation lookup, OSS implementation examples. Deep codebase understanding with evidence-based answers. Inspired by AmpCode. |
| **explore** | `github-copilot/grok-code-fast-1` | Fast codebase exploration and contextual grep. Falls back to Claude Haiku / GPT-5 Nano when preferred provider is unavailable. Inspired by Claude Code. |
| **multimodal-looker** | `google/gemini-3-flash` | Visual content specialist. Analyzes PDFs, images, diagrams to extract information. Saves tokens by having another agent process media. |

### Planning Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| **Prometheus** | `anthropic/claude-opus-4-6` | Strategic planner with interview mode. Creates detailed work plans through iterative questioning. |
| **Metis** | `anthropic/claude-opus-4-6` | Pre-planning consultant - analyzes requests for hidden intentions, ambiguities, and AI failure points before planning. |
| **Momus** | `openai/gpt-5.2` | Plan reviewer - verifies plan executability and catches blocking issues with practical focus. |

### Invoking Agents

The main agent invokes these automatically, but you can call them explicitly:

```
Ask @oracle to review this design and propose an architecture
Ask @librarian how this is implemented - why does the behavior keep changing?
Ask @explore for the policy on this feature
```

### Tool Restrictions

| Agent | Restrictions |
|-------|-------------|
| oracle | Read-only: cannot write, edit, or delegate |
| librarian | Cannot write, edit, or delegate |
| explore | Cannot write, edit, or delegate |
| multimodal-looker | Allowlist only: `read` |

### Background Agents

Run agents in the background and continue working:

- Have GPT debug while Claude tries different approaches
- Gemini writes frontend while Claude handles backend
- Fire massive parallel searches, continue implementation, use results when ready

```
# Launch in background
delegate_task({
  subagent_type: "explore",
  load_skills: [],
  description: "auth inventory",
  prompt: "Find auth implementations in this repo. Return file paths + key patterns.",
  run_in_background: true,
})

# Continue working...
# System notifies on completion

# Retrieve results when needed
background_output({ task_id: "bg_abc123" })
```

Customize agent models, prompts, and permissions in `oh-my-opencode.json`. See [Configuration](../reference/configuration.md#agents).

---

## Skills: Specialized Knowledge

Skills provide specialized workflows with embedded MCP servers and detailed instructions.

### Built-in Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| **playwright** | Browser tasks, testing, screenshots | Browser automation via Playwright MCP. MUST USE for any browser-related tasks - verification, browsing, web scraping, testing, screenshots. |
| **agent-browser** | Browser tasks (when selected) | Alternate browser automation provider used by some integrations. Included only when explicitly selected; `playwright` is the default. |
| **frontend-ui-ux** | UI/UX tasks, styling | Designer-turned-developer persona. Crafts stunning UI/UX even without design mockups. Emphasizes bold aesthetic direction, distinctive typography, cohesive color palettes. |
| **git-master** | commit, rebase, squash, blame | MUST USE for ANY git operations. Atomic commits with automatic splitting, rebase/squash workflows, history search (blame, bisect, log -S). |
| **parallel-agents** | worktree, tmux, spawn, swarm, isolate | Git worktree + tmux orchestration for parallel agent workflows: spawn, monitor, rescue, merge, cleanup. |
| **dev-browser** | Navigate sites, fill forms, screenshots | Stateful browser automation with persistent page state across scripts (requires separate local server setup). |
| **spec-compliance-review** | verify, acceptance criteria, compliance | Strict PASS/FAIL verification against acceptance criteria, with file:line evidence and scope-creep detection. |
| **code-quality-review** | code review, quality gate, harden | Post-spec-compliance quality review: type safety, error handling, tests, maintainability, and safety risks. |
| **writing-plans** | plan, approach, roadmap | Structured planning with dependencies, risks, and verification steps. |
| **systematic-debugging** | failing test, bug, regression | Hypothesis-driven debugging workflow with experiments and verification. |
| **code-simplifier** | simplify, refactor lightly | Behavior-preserving simplification pass to reduce complexity and improve readability. |

### Skill: playwright

**Trigger**: Any browser-related request

Provides browser automation via Playwright MCP server:

```yaml
mcp:
  playwright:
    command: npx
    args: ["@playwright/mcp@latest"]
```

**Capabilities**:
- Navigate and interact with web pages
- Take screenshots and PDFs
- Fill forms and click elements
- Wait for network requests
- Scrape content

**Usage**:
```
/playwright Navigate to example.com and take a screenshot
```

### Skill: frontend-ui-ux

**Trigger**: UI design tasks, visual changes

A designer-turned-developer who crafts stunning interfaces:

- **Design Process**: Purpose, Tone, Constraints, Differentiation
- **Aesthetic Direction**: Choose extreme - brutalist, maximalist, retro-futuristic, luxury, playful
- **Typography**: Distinctive fonts, avoid generic (Inter, Roboto, Arial)
- **Color**: Cohesive palettes with sharp accents, avoid purple-on-white AI slop
- **Motion**: High-impact staggered reveals, scroll-triggering, surprising hover states
- **Anti-Patterns**: Generic fonts, predictable layouts, cookie-cutter design

### Skill: git-master

**Trigger**: commit, rebase, squash, "who wrote", "when was X added"

Three specializations in one:

1. **Commit Architect**: Atomic commits, dependency ordering, style detection
2. **Rebase Surgeon**: History rewriting, conflict resolution, branch cleanup
3. **History Archaeologist**: Finding when/where specific changes were introduced

**Core Principle - Multiple Commits by Default**:
```
3+ files -> MUST be 2+ commits
5+ files -> MUST be 3+ commits
10+ files -> MUST be 5+ commits
```

**Automatic Style Detection**:
- Analyzes last 30 commits for language (Korean/English) and style (semantic/plain/short)
- Matches your repo's commit conventions automatically

**Usage**:
```
/git-master commit these changes
/git-master rebase onto main
/git-master who wrote this authentication code?
```

### Skill: parallel-agents

**Trigger**: worktree, tmux, "spawn agents", parallelization, "agent status", rescue, merge

Use this when you want **true filesystem isolation** for multiple agents working concurrently:

- One git worktree per task/agent
- One tmux window per worktree
- Deterministic status inspection and safe rescue for approval prompts

**Usage**:
```
/parallel-agents Spawn 3 agents in parallel for auth/payments/notifications
/parallel-agents Inspect status of all wm-* windows and rescue any waiting agents
```

### Skill: dev-browser

**Trigger**: browser automation with persistent state (login flows, multi-step UI work)

`dev-browser` is a stateful automation workflow. It is most useful when you want to:
- Keep a page/session alive across multiple scripts
- Incrementally build automation (script → run → inspect → refine)

See also: `docs/journeys/browser-automation.md`.

### Engineering Discipline Skills

These skills encode repeatable, high-quality engineering workflows (planning, verification, debugging, and simplification).
See: `docs/journeys/engineering-discipline.md`.

**Quick usage**:
```
/writing-plans Plan the implementation of X with risks and verification steps
/spec-compliance-review Verify this change against the acceptance criteria
/code-quality-review Review for type safety, error handling, and tests
/systematic-debugging Debug the failing test and propose a minimal fix
/code-simplifier Simplify the implementation without changing behavior
```

### Custom Skills

Load custom skills from:
- `.opencode/skills/*/SKILL.md` (project)
- `~/.config/opencode/skills/*/SKILL.md` (user)
- `.claude/skills/*/SKILL.md` (Claude Code compat)
- `~/.claude/skills/*/SKILL.md` (Claude Code user)

Disable skills via `disabled_skills` (schema-recognized built-ins) or `skills: { "<name>": false }` in config.

---

## Commands: Slash Workflows

Commands are slash-triggered workflows that execute predefined templates.

### Built-in Commands

| Command | Description |
|---------|-------------|
| `/init-deep` | Initialize hierarchical AGENTS.md knowledge base |
| `/brainstorm` | Enter Prometheus brainstorming mode for design-first exploration |
| `/ralph-loop` | Start self-referential development loop until completion |
| `/ulw-loop` | Start ultrawork loop - continues with ultrawork mode |
| `/cancel-ralph` | Cancel active Ralph Loop |
| `/refactor` | Intelligent refactoring with LSP, AST-grep, architecture analysis, and TDD verification |
| `/start-work` | Start Atlas execution session from Prometheus plan |
| `/stop-continuation` | Stop continuation mechanisms for the current session |

### Command: /init-deep

**Purpose**: Generate hierarchical AGENTS.md files throughout your project

**Usage**:
```
/init-deep [--create-new] [--max-depth=N]
```

Creates directory-specific context files that agents automatically read:
```
project/
├── AGENTS.md              # Project-wide context
├── src/
│   ├── AGENTS.md          # src-specific context
│   └── components/
│       └── AGENTS.md      # Component-specific context
```

### Command: /brainstorm

**Purpose**: Force entry into Prometheus Brainstorming Mode (Phase 0) before plan generation

**Usage**:
```
/brainstorm [topic-or-goal]
```

**Behavior**:
- Runs recon first (code patterns, docs, recent commits)
- Asks one question at a time
- Explores 2-3 approaches with trade-offs and recommendation
- Validates design in incremental sections, then writes `.sisyphus/designs/{topic-slug}.md`

### Command: /ralph-loop

**Purpose**: Self-referential development loop that runs until task completion

**Named after**: Anthropic's Ralph Wiggum plugin

**Usage**:
```
/ralph-loop "Build a REST API with authentication"
/ralph-loop "Refactor the payment module" --max-iterations=50
```

**Behavior**:
- Agent works continuously toward the goal
- Detects `<promise>DONE</promise>` to know when complete
- Auto-continues if agent stops without completion
- Ends when: completion detected, max iterations reached (default 100), or `/cancel-ralph`

**Configure**: `{ "ralph_loop": { "enabled": true, "default_max_iterations": 100 } }`

### Command: /ulw-loop

**Purpose**: Same as ralph-loop but with ultrawork mode active

Everything runs at maximum intensity - parallel agents, background tasks, aggressive exploration.

### Command: /refactor

**Purpose**: Intelligent refactoring with full toolchain

**Usage**:
```
/refactor <target> [--scope=<file|module|project>] [--strategy=<safe|aggressive>]
```

**Features**:
- LSP-powered rename and navigation
- AST-grep for pattern matching
- Architecture analysis before changes
- TDD verification after changes
- Codemap generation

### Command: /start-work

**Purpose**: Start execution from a Prometheus-generated plan

**Usage**:
```
/start-work [plan-name]
```

Uses Atlas Execution Mode to execute planned tasks systematically.

### Command: /stop-continuation

**Purpose**: Stop continuation loops for the current session (Ralph loop, task auto-continuation, related continuation controls)

**Usage**:
```
/stop-continuation
```

### Custom Commands

Load custom commands from:
- `.opencode/command/*.md` (project)
- `~/.config/opencode/command/*.md` (user)
- `.claude/commands/*.md` (Claude Code compat)
- `~/.claude/commands/*.md` (Claude Code user)

---

## Hooks: Lifecycle Automation

Hooks intercept and modify behavior at key points in the agent lifecycle.

### Hook Events

OpenCode runtime wiring uses OpenCode lifecycle events. For source of truth, see:
- `src/hooks/runtime/pipeline-order.ts`
- `src/hooks/runtime/registry.ts`
- `src/index.ts`
- `docs/reference/hooks.md`

| Event | When | Can |
|-------|------|-----|
| **`chat.message`** | User message is accepted into runtime | Transform message, trigger slash workflows, inject/route planning controls |
| **`user.prompt.submit`** | Prompt submit boundary | Memory/session handoff injection |
| **`command.execute.before`** | Before slash command execution | Pre-handle slash command invocation (currently auto-slash command bridge) |
| **`chat.headers`** | Outbound chat request header stage | Add provider/session-specific headers (for example Copilot Anthropic beta token) |
| **`shell.env`** | Shell environment assembly stage | Inject non-interactive environment guards for shell tools |
| **`tool.execute.before`** | Before tool execution | Validate/guard/modify tool input |
| **`tool.execute.after`** | After tool execution | Truncate output, add guidance, inject context |
| **`event`** | Session lifecycle stream (`session.*`, `message.*`, etc.) | Notifications, continuation, runtime state repair |
| **`experimental.chat.messages.transform`** | Message transform phase | Thinking-block validation, transform-time context |
| **`experimental.session.compacting`** | Compaction-time phase | Claude bridge `PreCompact`, compaction context injection |
| **`chat.params`** | Model params phase | Provider/model parameter adjustment (e.g., effort tuning) |

### Built-in Hooks (Representative, Not Exhaustive)

For the complete hook-name surface and exact ordering contract, see `docs/reference/hooks.md`.

#### Context & Injection

| Hook | Event | Description |
|------|-------|-------------|
| **directory-agents-injector** | `event`, `tool.execute.before`, `tool.execute.after` | Auto-injects AGENTS.md when reading files. Walks from file to project root, collecting all AGENTS.md files. **Deprecated for OpenCode 1.1.37+** - Auto-disabled when native AGENTS.md injection is available. |
| **directory-readme-injector** | `event`, `tool.execute.before`, `tool.execute.after` | Auto-injects README.md for directory context. |
| **rules-injector** | `event`, `tool.execute.before`, `tool.execute.after` | Injects rules from `.claude/rules/` when conditions match. Supports globs and alwaysApply. |
| **context-window-governor** | `event`, `tool.execute.after`, `experimental.session.compacting` | Unified context window governance: warnings, preemptive summarize, hard-limit recovery (`dynamic_pruning` -> `aggressive_output_truncation` -> summarize fallback), and compaction-time context injection. |

#### Productivity & Control

| Hook | Event | Description |
|------|-------|-------------|
| **keyword-detector** | `chat.message` | Detects keywords and activates modes: `ultrawork`/`ulw`, `search`/`find`, `analyze`/`investigate`. |
| **think-mode** | `chat.message`, `event` | Auto-detects extended thinking needs and adjusts model behavior. |
| **ralph-loop** | `event` | Manages self-referential loop continuation. |
| **start-work** | `chat.message` | Handles `/start-work` command execution. |
| **auto-slash-command** | `chat.message` | Automatically executes slash commands from prompts. |

#### Quality & Safety

| Hook | Event | Description |
|------|-------|-------------|
| **comment-checker** | `tool.execute.before`, `tool.execute.after` | Reminds agents to reduce excessive comments. Smartly ignores BDD, directives, docstrings. |
| **thinking-block-validator** | `experimental.chat.messages.transform` | Validates thinking blocks to prevent API errors. |
| **empty-task-response-detector** | `tool.execute.after` | Detects empty task responses and injects recovery guidance. |
| **edit-failure-guidance** | `tool.execute.after` | Recovers from edit tool failures. |
| **question-label-truncator** | `tool.execute.before` | Truncates overlong labels for `question` tool calls. |
| **write-existing-file-guard** | `tool.execute.before` | Prevents accidental `Write` over existing files; nudges safer edit flows. |

#### Recovery & Stability

| Hook | Event | Description |
|------|-------|-------------|
| **session-state-repair** | `event` (internal `session.error` path) | Recovers from recoverable session errors (`tool_result_missing`, thinking-block ordering/disabled violations, `assistant_prefill_unsupported`). Includes `tool_result_missing` -> revert fallback when `tool_result` injection is rejected by the API. |

#### Truncation & Context Management

| Hook | Event | Description |
|------|-------|-------------|
| **tool-output-truncator** | `tool.execute.after` | Truncates output from Grep, Glob, LSP, AST-grep tools. |

#### Notifications & UX

| Hook | Event | Description |
|------|-------|-------------|
| **auto-update-checker** | `event` | Checks for new versions and controls startup toast behavior. |
| **background-notification** | `event` | Notifies when background agent tasks complete. |
| **session-notification** | `event` | OS notifications when agents go idle. Works on macOS, Linux, Windows. |
| **delegation-nudge-agent-usage** | `event`, `tool.execute.after` | Reminds you to leverage specialized agents for better results. |

#### Task Management

| Hook | Event | Description |
|------|-------|-------------|
| **delegation-failure-guidance** | `tool.execute.after` | Adds structured retry guidance when `delegate_task` input validation fails. |

Note: `task-resume-info` is an internal runtime node (`internal:task-resume-info`) and is not a user-configurable hook name.

#### Integration

| Hook | Event | Description |
|------|-------|-------------|
| **claude-code-hooks** | `chat.message`, `tool.execute.before`, `tool.execute.after`, `event`, `experimental.session.compacting` | Executes hooks from Claude Code's `settings.json`. |
| **interactive-bash-session** | `event`, `tool.execute.after` | Manages tmux sessions for interactive CLI. |
| **non-interactive-env** | `tool.execute.before` | Handles non-interactive environment constraints. |

#### Specialized

| Hook | Event | Description |
|------|-------|-------------|
| **prometheus-md-only** | `tool.execute.before` | Enforces markdown-only output for Prometheus planner. |
| **sisyphus-junior-notepad** | `tool.execute.before` | Injects notepad context only when delegating to `sisyphus-junior`. |
| **anthropic-effort** | `chat.params` | Tunes Anthropic effort/variant params outside runtime dispatcher ordering. |

### Claude Code Hooks Integration

Run custom scripts via Claude Code's `settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "eslint --fix $FILE" }]
      }
    ]
  }
}
```

**Hook locations**:
- `~/.claude/settings.json` (user)
- `./.claude/settings.json` (project)
- `./.claude/settings.local.json` (local, git-ignored)

### Disabling Hooks

Disable specific hooks in config:

```json
{
  "disabled_hooks": [
    "comment-checker",
    "auto-update-checker",
    "startup-toast"
  ]
}
```

---

## Tools: Agent Capabilities

### LSP Tools (IDE Features for Agents)

| Tool | Description |
|------|-------------|
| **lsp_diagnostics** | Get errors/warnings before build |
| **lsp_prepare_rename** | Validate rename operation |
| **lsp_rename** | Rename symbol across workspace |
| **lsp_goto_definition** | Jump to symbol definition |
| **lsp_find_references** | Find all usages across workspace |
| **lsp_symbols** | Get file outline or workspace symbol search |

### AST-Grep Tools

| Tool | Description |
|------|-------------|
| **ast_grep_search** | AST-aware code pattern search (25 languages) |
| **ast_grep_replace** | AST-aware code replacement |

### Delegation Tools

| Tool | Description |
|------|-------------|
| **delegate_task** | Category-based task delegation. Supports categories (visual, business-logic) or direct agent targeting. Research-scoped mode for explore/librarian-only access. |
| **background_output** | Retrieve background task results |
| **background_cancel** | Cancel running background tasks |

### Session Tools

| Tool | Description |
|------|-------------|
| **session_list** | List all OpenCode sessions |
| **session_read** | Read messages and history from a session |
| **session_search** | Full-text search across session messages |
| **session_info** | Get session metadata and statistics |

---

## MCPs: Built-in Servers

### websearch (Exa AI)

Real-time web search powered by [Exa AI](https://exa.ai).

### context7

Official documentation lookup for any library/framework.

### grep_app

Ultra-fast code search across public GitHub repos. Great for finding implementation examples.

### Skill-Embedded MCPs

Skills can bring their own MCP servers:

```yaml
---
description: Browser automation skill
mcp:
  playwright:
    command: npx
    args: ["-y", "@anthropic-ai/mcp-playwright"]
---
```

The `skill_mcp` tool invokes these operations with full schema discovery.

#### OAuth-Enabled MCPs

Skills can define OAuth-protected remote MCP servers. OAuth 2.1 with full RFC compliance (RFC 9728, 8414, 8707, 7591) is supported:

```yaml
---
description: My API skill
mcp:
  my-api:
    url: https://api.example.com/mcp
    oauth:
      clientId: ${CLIENT_ID}
      scopes: ["read", "write"]
---
```

When a skill MCP has `oauth` configured:
- **Auto-discovery**: Fetches `/.well-known/oauth-protected-resource` (RFC 9728), falls back to `/.well-known/oauth-authorization-server` (RFC 8414)
- **Dynamic Client Registration**: Auto-registers with servers supporting RFC 7591 (clientId becomes optional)
- **PKCE**: Mandatory for all flows
- **Resource Indicators**: Auto-generated from MCP URL per RFC 8707
- **Token Storage**: Persisted in `~/.config/opencode/mcp-oauth.json` (chmod 0600)
- **Auto-refresh**: Tokens refresh on 401; step-up authorization on 403 with `WWW-Authenticate`
- **Dynamic Port**: OAuth callback server uses an auto-discovered available port

Pre-authenticate via CLI:

```bash
bunx oh-my-opencode mcp oauth login <server-name> --server-url https://api.example.com
```

---

## Context Injection

### Directory AGENTS.md

Auto-injects AGENTS.md when reading files. Walks from file directory to project root:

```
project/
├── AGENTS.md              # Injected first
├── src/
│   ├── AGENTS.md          # Injected second
│   └── components/
│       ├── AGENTS.md      # Injected third
│       └── Button.tsx     # Reading this injects all 3
```

### Conditional Rules

Inject rules from `.claude/rules/` when conditions match:

```markdown
---
globs: ["*.ts", "src/**/*.js"]
description: "TypeScript/JavaScript coding rules"
---
- Use PascalCase for interface names
- Use camelCase for function names
```

Supports:
- `.md` and `.mdc` files
- `globs` field for pattern matching
- `alwaysApply: true` for unconditional rules
- Walks upward from file to project root, plus `~/.claude/rules/`

---

## Claude Code Compatibility

Full compatibility layer for Claude Code configurations.

### Config Loaders

| Type | Locations |
|------|-----------|
| **Commands** | `~/.claude/commands/`, `.claude/commands/` |
| **Skills** | `~/.claude/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md` |
| **Agents** | `~/.claude/agents/*.md`, `.claude/agents/*.md` |
| **MCPs** | `~/.claude/.mcp.json`, `.mcp.json`, `.claude/.mcp.json` |

MCP configs support environment variable expansion: `${VAR}`.

### Data Storage

| Data | Location | Format |
|------|----------|--------|
| TaskGraph Nodes | `.sisyphus/tasks/<scope>/<container>/task_*.json` | Fork-owned TaskGraph V2 storage |
| Transcripts | `~/.claude/transcripts/` | JSONL |

### Compatibility Toggles

Disable specific features:

```json
{
  "claude_code": {
    "mcp": false,
    "commands": false,
    "skills": false,
    "agents": false,
    "hooks": false,
    "plugins": false
  }
}
```

| Toggle | Disables |
|--------|----------|
| `mcp` | `.mcp.json` files (keeps built-in MCPs) |
| `commands` | `~/.claude/commands/`, `.claude/commands/` |
| `skills` | `~/.claude/skills/`, `.claude/skills/` |
| `agents` | `~/.claude/agents/` (keeps built-in agents) |
| `hooks` | settings.json hooks |
| `plugins` | Claude Code marketplace plugins |

Disable specific plugins:

```json
{
  "claude_code": {
    "plugins_override": {
      "claude-mem@thedotmack": false
    }
  }
}
```
