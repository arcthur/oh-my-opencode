# AGENTS KNOWLEDGE BASE

## OVERVIEW

This fork ships **10 AI agents** for multi-model orchestration.

Each agent has:
- A factory (or prompt constants for Prometheus)
- Prompt metadata (for dynamic prompt sections)
- A model requirement + fallback chain (see `src/shared/model-requirements.ts`)

**Orchestrators / Primary agents**:
- Sisyphus, Prometheus

**Subagents**:
- Hephaestus, Oracle, Librarian, Explore, Multimodal-Looker, Metis, Momus, Sisyphus-Junior

## STRUCTURE

```
agents/
├── dynamic-agent-prompt-builder.ts  # Dynamic prompt generation
├── sisyphus/                 # Primary agent prompt
├── sisyphus-junior.ts          # Category-spawned executor (task blocked; research-scoped delegate_task for explore/librarian only)
├── oracle.ts                   # Strategic advisor (GPT-5.2)
├── librarian.ts                # Multi-repo research (GitHub CLI, Context7)
├── explore.ts                  # Fast contextual grep
├── multimodal-looker.ts        # Media analyzer (Gemini 3 Flash)
├── prometheus/                 # Prometheus system prompt (brainstorm/interview/plan/QA)
├── metis.ts                    # Pre-planning consultant (intent classification, AI-slop detection)
├── momus.ts                    # Plan reviewer (blocking-issue verification, executability check)
├── hephaestus.ts               # Autonomous deep worker (GPT 5.3 Codex)
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
| Sisyphus | `anthropic/claude-opus-4-6` | 0.1 | `requiresAnyModel` gate; fallback chain prefers Claude → Kimi → GLM. |
| Prometheus | `anthropic/claude-opus-4-6` | 0.1 | Planner prompt is exported as constants under `src/agents/prometheus/*`. |
| Hephaestus | `openai/gpt-5.3-codex` | 0.1 | `requiresModel: gpt-5.3-codex`. |
| oracle | `openai/gpt-5.2` | 0.1 | GPT models use `reasoningEffort`; Claude models use `thinking`. |
| librarian | `zai-coding-plan/glm-4.7` | 0.1 | Fallback: `opencode/glm-4.7-free`. |
| explore | `github-copilot/grok-code-fast-1` | 0.1 | Fast contextual grep; fallback chain prefers cheap models. |
| multimodal-looker | `google/gemini-3-flash` | 0.1 | Read-only / media analysis. |
| Metis | `anthropic/claude-opus-4-6` | 0.3 | Pre-planning consultant; intent classification, AI-slop detection. |
| Momus | `openai/gpt-5.2` | 0.1 | Plan reviewer; blocking-issue verification, practical executability check. |
| Sisyphus-Junior | `anthropic/claude-sonnet-4-5` | 0.1 | Category-spawned executor; denies `task`, `delegate_task` is research-scoped (explore/librarian only). |

## HOW TO ADD

1. Create `src/agents/my-agent.ts` exporting a factory and (optionally) prompt metadata.
2. Add to `agentSources` and `agentMetadata` in `src/agents/utils.ts`.
3. Add model requirements (fallback chain / gating) in `src/shared/model-requirements.ts` when applicable.
4. Update `AgentNameSchema` in `src/config/schema.ts`.
5. Wire into plugin initialization if needed (`src/index.ts`, config handler, hooks).

## TOOL RESTRICTIONS

| Agent | Denied Tools |
|-------|-------------|
| oracle | write, edit, task, delegate_task |
| librarian | write, edit, task, delegate_task |
| explore | write, edit, task, delegate_task |
| multimodal-looker | Allowlist: read only |
| metis | write, edit, task (delegate_task limited to explore/librarian) |
| momus | write, edit, task, delegate_task |
| Sisyphus-Junior | task *(delegate_task is research-scoped: explore/librarian only)* |

## PATTERNS

- **Factory**: `createXXXAgent(model: string): AgentConfig` (+ `createXXXAgent.mode = "primary" | "subagent"`).
- **Metadata**: `XXX_PROMPT_METADATA` feeds Sisyphus prompt sections dynamically.
- **Model resolution**: `createBuiltinAgents()` resolves `uiSelectedModel` + overrides + category defaults + fallback chains.
- **Tool restrictions**: Prefer `createAgentToolRestrictions()` / `createAgentToolAllowlist()`; keep `src/shared/agent-tool-restrictions.ts` in sync for `session.prompt`.
- **Thinking vs reasoning**: Claude models generally use `thinking`; GPT models use `reasoningEffort`.

## ANTI-PATTERNS

- **Trust reports**: NEVER trust "I'm done" - verify outputs.
- **High temp**: Don't use >0.3 for code agents.
- **Sequential calls**: Prefer `delegate_task(..., run_in_background=true)` for exploration.
