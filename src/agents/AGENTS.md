# AGENTS KNOWLEDGE BASE

## OVERVIEW

This fork ships **10 AI agents** for multi-model orchestration.

Each agent has:
- A factory (or prompt constants for planner)
- Prompt metadata (for dynamic prompt sections)
- A model requirement + fallback chain (see `src/shared/model-requirements.ts`)

**Orchestrators / Primary agents**:
- orchestrator, planner

**Subagents**:
- executor, advisor, librarian, navigator, interpreter, scope-analyst, reviewer, specialist

## STRUCTURE

```
agents/
├── dynamic-agent-prompt-builder.ts  # Dynamic prompt generation
├── orchestrator/                 # Primary agent prompt
├── specialist.ts          # Category-spawned executor (task blocked; research-scoped delegate_task for navigator/librarian only)
├── advisor.ts                   # Strategic advisor (GPT-5.2)
├── librarian.ts                # Multi-repo research (GitHub CLI, Context7)
├── navigator.ts                  # Fast contextual grep
├── interpreter.ts        # Media analyzer (Gemini 3 Flash)
├── planner/                 # planner system prompt (brainstorm/interview/plan/QA)
├── scope-analyst.ts                    # Pre-planning consultant (intent classification, AI-slop detection)
├── reviewer.ts                    # Plan reviewer (blocking-issue verification, executability check)
├── executor.ts               # Autonomous deep worker (GPT 5.3 Codex)
├── agent-builder.ts            # Agent build pipeline (factory invocation, category/skill expansion)
├── env-context.ts              # OmO-specific environment context (time, timezone, locale)
├── custom-agent-summaries.ts   # Custom agent summary parsing and metadata building
├── builtin-agents/             # Modular agent creation infrastructure
├── types.ts                    # AgentOverrideConfig, AgentPromptMetadata, AgentFactory
├── utils.ts                    # createBuiltinAgents(), model resolution, category/skill expansion
└── index.ts                    # builtinAgents export
```

## AGENT MODELS

The exact fallback chains are defined in `src/shared/model-requirements.ts`.

| Agent | Default / Preferred Model | Temp | Notes |
|-------|---------------------------|------|-------|
| orchestrator | `anthropic/claude-opus-4-6` | 0.1 | `requiresAnyModel` gate; fallback chain prefers Claude → Kimi → GLM. |
| planner | `anthropic/claude-opus-4-6` | 0.1 | Planner prompt is exported as constants under `src/agents/planner/*`. |
| executor | `openai/gpt-5.3-codex` | 0.1 | `requiresModel: gpt-5.3-codex`. |
| advisor | `openai/gpt-5.2` | 0.1 | GPT models use `reasoningEffort`; Claude models use `thinking`. |
| librarian | `zai-coding-plan/glm-4.7` | 0.1 | Fallback: `opencode/glm-4.7-free`. |
| navigator | `github-copilot/grok-code-fast-1` | 0.1 | Fast contextual grep; fallback chain prefers cheap models. |
| interpreter | `google/gemini-3-flash` | 0.1 | Read-only / media analysis. |
| scope-analyst | `anthropic/claude-opus-4-6` | 0.3 | Pre-planning consultant; intent classification, AI-slop detection. |
| reviewer | `openai/gpt-5.2` | 0.1 | Plan reviewer; blocking-issue verification, practical executability check. |
| specialist | `anthropic/claude-sonnet-4-5` | 0.1 | Category-spawned executor; denies `task`, `delegate_task` is research-scoped (navigator/librarian only). |

## HOW TO ADD

1. Create `src/agents/my-agent.ts` exporting a factory and (optionally) prompt metadata.
2. Add to `agentSources` and `agentMetadata` in `src/agents/utils.ts`.
3. Add model requirements (fallback chain / gating) in `src/shared/model-requirements.ts` when applicable.
4. Update `AgentNameSchema` in `src/config/schema.ts`.
5. Wire into plugin initialization if needed (`src/index.ts`, config handler, hooks).

## TOOL RESTRICTIONS

| Agent | Denied Tools |
|-------|-------------|
| advisor | write, edit, task, delegate_task |
| librarian | write, edit, task, delegate_task |
| navigator | write, edit, task, delegate_task |
| interpreter | Allowlist: read only |
| scope-analyst | write, edit, task (delegate_task limited to navigator/librarian) |
| reviewer | write, edit, task, delegate_task |
| specialist | task *(delegate_task is research-scoped: navigator/librarian only)* |

## PATTERNS

- **Factory**: `createXXXAgent(model: string): AgentConfig` (+ `createXXXAgent.mode = "primary" | "subagent"`).
- **Metadata**: `XXX_PROMPT_METADATA` feeds orchestrator prompt sections dynamically.
- **Model resolution**: `createBuiltinAgents()` resolves `uiSelectedModel` + overrides + category defaults + fallback chains.
- **Tool restrictions**: Prefer `createAgentToolRestrictions()` / `createAgentToolAllowlist()`; keep `src/shared/agent-tool-restrictions.ts` in sync for `session.prompt`.
- **Thinking vs reasoning**: Claude models generally use `thinking`; GPT models use `reasoningEffort`.

## ANTI-PATTERNS

- **Trust reports**: NEVER trust "I'm done" - verify outputs.
- **High temp**: Don't use >0.3 for code agents.
- **Sequential calls**: Prefer `delegate_task(..., run_in_background=true)` for exploration.
