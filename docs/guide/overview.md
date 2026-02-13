# Oh My OpenCode Overview

Learn about Oh My OpenCode, a plugin that transforms OpenCode into the best agent harness.

---

## TL;DR

> **orchestrator agent strongly recommends Opus 4.6 model. Using other models may result in significantly degraded experience.**

**Feeling lazy?** Just include `ultrawork` (or `ulw`) in your prompt. That's it. The agent figures out the rest.

**Need precision?** Press **Tab** to enter planner mode, create a work plan through an interview process, then run `/start-work` to execute it with full orchestration.

---

## What Oh My OpenCode Does for You

- **Build features from descriptions**: Just tell the agent what you want. It makes a plan, writes the code, and ensures it works. Automatically. You don't have to care about the details.
- **Debug and fix issues**: Describe a bug or paste an error. The agent analyzes your codebase, identifies the problem, and implements a fix.
- **Navigate any codebase**: Ask anything about your codebase. The agent maintains awareness of your entire project structure.
- **Automate tedious tasks**: Fix lint issues, resolve merge conflicts, write release notes - all in a single command.

---

## Two Ways to Work

### Option 1: Ultrawork Mode (For Quick Work)

If you're feeling lazy, just include **`ultrawork`** (or **`ulw`**) in your prompt:

```
ulw add authentication to my Next.js app
```

The agent will automatically:
1. navigator your codebase to understand existing patterns
2. Research best practices via specialized agents
3. Implement the feature following your conventions
4. Verify with diagnostics and tests
5. Keep working until complete

This is the "just do it" mode. Full automatic mode.
The agent is already smart enough, so it explores the codebase and make plans itself.
**You don't have to think that deep. Agent will think that deep.**

### Option 2: planner Mode (For Precise Work)

For complex or critical tasks, press **Tab** to switch to planner mode.

**How it works:**

1. **planner interviews you** - Acts as your personal consultant, asking clarifying questions while researching your codebase to understand exactly what you need.

2. **Plan generation** - scope-analyst analyzes the request, planner generates a detailed work plan with tasks, acceptance criteria, and guardrails, and reviewer reviews the plan for executability.

3. **Run `/start-work`** - workflow-automator Execution Mode takes over:
   - Distributes tasks to specialized sub-agents
   - Verifies each task completion independently
   - Accumulates learnings across tasks
   - Tracks progress across sessions (resume anytime)

**When to use planner:**
- Multi-day or multi-session projects
- Critical production changes
- Complex refactoring spanning many files
- When you want a documented decision trail

---

## Critical Usage Guidelines

### Use the Right Orchestrator for the Job

- Use `orchestrator` for open-ended, ad-hoc orchestration.
- Use `planner -> /start-work` when you need strict plan-first execution with workflow-automator.

**Correct workflow:**
```
1. Press Tab → Enter planner mode
2. Describe work → planner interviews you
3. Confirm plan → Review .orchestrator/plans/*/plan.md
4. Run /start-work → workflow-automator executes
```

**planner and workflow-automator Execution Mode are a pair for precise execution workflows.**

---

## Model Configuration

Oh My OpenCode automatically configures models based on your available providers. You don't need to manually specify every model.

### How Models Are Determined

**1. At Installation Time (Interactive Installer)**

When you run `bunx oh-my-opencode install`, the installer asks which providers you have:
- Claude Pro/Max subscription?
- OpenAI/ChatGPT Plus?
- Google Gemini?
- GitHub Copilot?
- OpenCode Zen?
- Z.ai Coding Plan?

Based on your answers, it generates `~/.config/opencode/oh-my-opencode/00-core.json` with optimal model assignments for each agent and category.

**2. At Runtime (Fallback Chain)**

Each agent has a **provider priority chain**. The system tries providers in order until it finds an available model:

```
Example: interpreter
google → openai → zai-coding-plan → anthropic → opencode
   ↓        ↓           ↓              ↓           ↓
gemini   gpt-5.2     glm-4.6v       haiku     gpt-5-nano
```

If you have Gemini, it uses `google/gemini-3-flash`. No Gemini but have Claude? Uses `anthropic/claude-haiku-4-5`. And so on.

### Example Configuration

Here's a real-world config for a user with **Claude, OpenAI, Gemini, and Z.ai** all available:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  "agents": {
    // Override specific agents only - rest use fallback chain
    "orchestrator": { "model": "anthropic/claude-sonnet-4-5", "variant": "max" },
    "librarian": { "model": "zai-coding-plan/glm-4.7" },
    "navigator": { "model": "opencode/gpt-5-nano" },
    "interpreter": { "model": "zai-coding-plan/glm-4.6v" }
  },
  "categories": {
    // Override categories for cost optimization
    "quick": { "model": "opencode/gpt-5-nano" },
    "unspecified-low": { "model": "zai-coding-plan/glm-4.7" }
  }
}
```

**Key points:**
- You only need to override what you want to change
- Unspecified agents/categories use the automatic fallback chain
- Mix providers freely (Claude for main work, Z.ai for cheap tasks, etc.)

### Finding Available Models

Run `opencode models` to see all available models in your environment. Model names follow the format `provider/model-name`.

### Learn More

For detailed configuration options including per-agent settings, category customization, and more, see the [Configuration Contract](../reference/configuration.md).

---

## Next Steps

- [Understanding the Orchestration System](./understanding-orchestration-system.md) - Deep dive into planner → Orchestrator → Junior workflow
- [Ultrawork Journey](../journeys/ultrawork.md) - Philosophy and principles behind Oh My OpenCode
- [Installation Guide](./installation.md) - Detailed installation instructions
- [Configuration Contract](../reference/configuration.md) - Customize agents, models, and behaviors
- [Feature Catalog](./features.md) - Complete feature documentation
