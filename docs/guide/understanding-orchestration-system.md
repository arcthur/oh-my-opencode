# Understanding the Orchestration System

Oh My OpenCode's orchestration system transforms a simple AI agent into a coordinated development team. This document explains how the Prometheus → Sisyphus Execution Mode → Junior workflow creates high-quality, reliable code output.

---

## The Core Philosophy

Traditional AI coding tools follow a simple pattern: user asks → AI responds. This works for small tasks but fails for complex work because:

1. **Context overload**: Large tasks exceed context windows
2. **Cognitive drift**: AI loses track of requirements mid-task
3. **Verification gaps**: No systematic way to ensure completeness
4. **Human = Bottleneck**: Requires constant user intervention

The orchestration system solves these problems through **specialization and delegation**.

---

## The Three-Layer Architecture

```mermaid
flowchart TB
    subgraph Planning["Planning Layer (Human + Prometheus)"]
        User[("User")]
        Prometheus["Prometheus<br/>(Planner)<br/>Claude Opus 4.6"]
        MultiPlan["multi_plan<br/>(Multi-Model Planning)<br/>Tool"]
        Synth["Plan Synthesizer<br/>(plan-synthesizer)<br/>Opus-class"]
    end
    
    subgraph Execution["Execution Layer (Orchestrator)"]
        Orchestrator["Sisyphus Execution Mode<br/>(Conductor)<br/>Claude Opus 4.6"]
    end
    
    subgraph Workers["Worker Layer (Specialized Agents)"]
        Junior["Sisyphus-Junior<br/>(Task Executor)<br/>Claude Sonnet 4.5"]
        Oracle["Oracle<br/>(Architecture)<br/>GPT-5.2"]
        Explore["Explore<br/>(Codebase Grep)<br/>Grok Code Fast-1"]
        Librarian["Librarian<br/>(Docs/OSS)<br/>GLM-4.7"]
        Multimodal["Multimodal Looker<br/>(Image/PDF)<br/>Gemini 3 Flash"]
    end
    
    User -->|"Describe work"| Prometheus
    Prometheus -->|"Interview"| User
    Prometheus -->|"Generate plan draft"| PlanDraft[".sisyphus/plans/{planId}.md<br/>(planner output)"]
    Prometheus -->|"Generate context manifest"| Manifest[".sisyphus/context-manifests/{planId}.md"]
    Prometheus -->|"Complex plan?"| MultiPlan
    MultiPlan -->|"Compare + Synthesize"| Synth
    Synth -->|"Unified plan + report"| Prometheus
    
    User -->|"/start-work"| Orchestrator
    Orchestrator --> WorkState[".sisyphus/work.yaml<br/>(STATE SSOT)"]
    PlanDraft -->|"Migrate on /start-work"| Plan[".sisyphus/plans/{planId}/plan.md<br/>(TASK SSOT)"]
    Plan -->|"Read tasks"| Orchestrator
    WorkState -->|"Resume state"| Orchestrator
    
    Orchestrator -->|"delegate_task(category + load_skills)"| Junior
    Orchestrator -->|"delegate_task(subagent_type)"| Oracle
    Orchestrator -->|"delegate_task(subagent_type)"| Explore
    Orchestrator -->|"delegate_task(subagent_type)"| Librarian
    Orchestrator -->|"delegate_task(subagent_type)"| Multimodal
    
    Junior -->|"Results + Learnings"| Orchestrator
    Oracle -->|"Advice"| Orchestrator
    Explore -->|"Code patterns"| Orchestrator
    Librarian -->|"Documentation"| Orchestrator
    Multimodal -->|"Extracted info"| Orchestrator
```

---

## Layer 1: Planning (Prometheus + Multi-Model Planning)

### Prometheus: Your Strategic Consultant

Prometheus is **not just a planner** - it's an intelligent interviewer that helps you think through what you actually need.

**The Interview Process:**

```mermaid
stateDiagram-v2
    [*] --> Interview: User describes work
    Interview --> Research: Launch explore/librarian agents
    Research --> Interview: Gather codebase context
    Interview --> ClearanceCheck: After each response
    
    ClearanceCheck --> Interview: Requirements unclear
    ClearanceCheck --> PlanGeneration: All requirements clear
    
    state ClearanceCheck {
        [*] --> Check
        Check: ✓ Core objective defined?
        Check: ✓ Scope boundaries established?
        Check: ✓ No critical ambiguities?
        Check: ✓ Technical approach decided?
        Check: ✓ Test strategy confirmed?
    }
    
    PlanGeneration --> MultiPlanDecision: Complex plan?
    MultiPlanDecision --> MultiPlanRun: Call multi_plan (optional)
    MultiPlanRun --> WritePlan: Use unified plan output
    WritePlan --> HighAccuracyChoice: Present to user
    
    HighAccuracyChoice --> MultiPlanRun: User wants high accuracy (debate mode)
    HighAccuracyChoice --> Done: User accepts plan
    
    Done --> [*]: Guide to /start-work
```

**Intent-Specific Strategies:**

Prometheus adapts its interview style based on what you're doing:

| Intent | Prometheus Focus | Example Questions |
|--------|------------------|-------------------|
| **Refactoring** | Safety - behavior preservation | "What tests verify current behavior?" "Rollback strategy?" |
| **Build from Scratch** | Discovery - patterns first | "Found pattern X in codebase. Follow it or deviate?" |
| **Mid-sized Task** | Guardrails - exact boundaries | "What must NOT be included? Hard constraints?" |
| **Architecture** | Strategic - long-term impact | "Expected lifespan? Scale requirements?" |

### Multi-Model Planning: Deep Verification and Synthesis

For complex or high-accuracy planning, Prometheus can call `multi_plan` to:

- Generate multiple independent plans in parallel
- Compare and score them (clarity/verification/context/big picture)
- Run optional deep verification (file reference audit, execution simulation)
- Resolve conflicts and synthesize one unified final plan
- Optionally run a debate round (rebuttals) for maximum scrutiny

---

## Layer 2: Execution (Sisyphus Execution Mode)

### The Conductor Mindset

The Orchestrator is like an orchestra conductor: **it doesn't play instruments, it ensures perfect harmony**.

```mermaid
flowchart LR
    subgraph Orchestrator["Sisyphus Execution Mode"]
        Read["1. Read Plan"]
        Analyze["2. Analyze Tasks"]
        Wisdom["3. Accumulate Wisdom"]
        Delegate["4. Delegate Tasks"]
        Verify["5. Verify Results"]
        Report["6. Final Report"]
    end
    
    Read --> Analyze
    Analyze --> Wisdom
    Wisdom --> Delegate
    Delegate --> Verify
    Verify -->|"More tasks"| Delegate
    Verify -->|"All done"| Report
    
    Delegate -->|"run_in_background=false"| Workers["Workers"]
    Workers -->|"Results + Learnings"| Verify
```

**What Orchestrator CAN do:**
- Read files to understand context
- Run commands to verify results
- Use `lsp_diagnostics` to check for errors
- Search patterns with `grep` / `glob` / `ast_grep_*`
- Create git commits **after verification** (atomic, scoped)

**What Orchestrator SHOULD delegate (for isolation + throughput):**
- Medium/large code changes (implementation, refactors)
- Test creation and multi-file migrations
- Specialized work that benefits from a focused context window (UI/UX, deep reasoning, research)

### Wisdom Accumulation

The power of orchestration is **cumulative learning**. After each task:

1. Extract learnings from subagent's response
2. Categorize into: Conventions, Successes, Failures, Gotchas, Commands
3. Pass forward to ALL subsequent subagents

This prevents repeating mistakes and ensures consistent patterns.

**Notepad System:**

```
.sisyphus/notepads/{plan-name}/
├── learnings.md      # Patterns, conventions, successful approaches
├── decisions.md      # Architectural choices and rationales
├── issues.md         # Problems, blockers, gotchas encountered
├── verification.md   # Test results, validation outcomes
└── problems.md       # Unresolved issues, technical debt
```

### Parallel Execution

Independent tasks run in parallel:

```typescript
// Orchestrator identifies parallelizable groups from plan
// Group A: Tasks 2, 3, 4 (no file conflicts)
delegate_task({
  category: "ultrabrain",
  load_skills: [],
  description: "task 2",
  prompt: "Task 2...",
  run_in_background: true,
})
delegate_task({
  category: "visual-engineering",
  load_skills: ["frontend-ui-ux"],
  description: "task 3",
  prompt: "Task 3...",
  run_in_background: true,
})
delegate_task({
  category: "unspecified-low",
  load_skills: [],
  description: "task 4",
  prompt: "Task 4...",
  run_in_background: true,
})
// All run simultaneously
```

---

## Layer 3: Workers (Specialized Agents)

### Sisyphus-Junior: The Task Executor

Junior is the **workhorse** that actually writes code. Key characteristics:

- **Focused**: No implementation delegation. `delegate_task` is **research-scoped only** (explore/librarian, no categories, `load_skills=[]`).
- **Disciplined**: Obsessive todo tracking
- **Verified**: Prompt requires `lsp_diagnostics` clean (and tests when applicable) before claiming completion; Orchestrator still verifies independently.
- **Constrained**: `task` tool is denied. Plan/ledger artifacts under `.sisyphus/` are treated as read-only by convention (SSOT is owned by the orchestrator workflow).

**Why Sonnet is Sufficient:**

Junior doesn't need to be the smartest - it needs to be reliable. With:
1. Detailed prompts from Orchestrator (50-200 lines)
2. Accumulated wisdom passed forward
3. Clear MUST DO / MUST NOT DO constraints
4. Verification requirements

Even a mid-tier model executes precisely. The intelligence is in the **system**, not individual agents.

### System Reminder Mechanism

The hook system ensures Junior never stops halfway:

```
[SYSTEM REMINDER - TODO CONTINUATION]

You have incomplete todos! Complete ALL before responding:
- [ ] Implement user service ← IN PROGRESS
- [ ] Add validation
- [ ] Write tests

DO NOT respond until all todos are marked completed.
```

This "work continuation" mechanism (the Sisyphus “boulder pushing” metaphor) is why the system is named after Sisyphus.

---

## The delegate_task Tool: Category + Skill System

### Why Categories are Revolutionary

**The Problem with Model Names:**

```typescript
// Avoid routing by raw model strings ("use gpt-5.2", "use opus") as the *contract*.
// Prefer either:
// - semantic categories (intent presets), or
// - explicit specialists via subagent_type.

delegate_task({
  subagent_type: "oracle",
  load_skills: [],
  description: "architecture review",
  prompt: "...",
  run_in_background: false,
})
```

**The Solution: Semantic Categories:**

```typescript
// NEW: Category describes INTENT, not implementation
delegate_task({
  category: "ultrabrain",
  load_skills: [],
  description: "deep reasoning task",
  prompt: "...",
  run_in_background: false,
})
delegate_task({
  category: "visual-engineering",
  load_skills: ["frontend-ui-ux"],
  description: "visual task",
  prompt: "...",
  run_in_background: false,
})
delegate_task({
  category: "quick",
  load_skills: [],
  description: "quick fix",
  prompt: "...",
  run_in_background: false,
})
```

### Built-in Categories

| Category | Model | When to Use |
|----------|-------|-------------|
| `visual-engineering` | Gemini 3 Pro | Frontend, UI/UX, design, styling, animation |
| `ultrabrain` | GPT-5.3 Codex (xhigh) | Deep logical reasoning, complex architecture decisions |
| `deep` | GPT-5.3 Codex (medium) | Goal-oriented autonomous problem-solving for hairy tasks |
| `artistry` | Gemini 3 Pro (high) | Highly creative/artistic tasks, novel ideas |
| `quick` | Claude Haiku 4.5 | Trivial tasks - single file changes, typo fixes |
| `unspecified-low` | Claude Sonnet 4.5 | Tasks that don't fit other categories, low effort |
| `unspecified-high` | Claude Opus 4.6 (max) | Tasks that don't fit other categories, high effort |
| `writing` | Gemini 3 Flash | Documentation, prose, technical writing |

### Custom Categories

You can define your own categories:

```json
// .opencode/oh-my-opencode.json
{
  "categories": {
    "unity-game-dev": {
      "model": "openai/gpt-5.2",
      "temperature": 0.3,
      "prompt_append": "You are a Unity game development expert..."
    }
  }
}
```

### Skills: Domain-Specific Instructions

Skills prepend specialized instructions to subagent prompts:

```typescript
// Category + Skill combination
delegate_task({
  category: "visual-engineering",
  load_skills: ["frontend-ui-ux"], // Adds UI/UX expertise
  description: "UI implementation",
  prompt: "...",
  run_in_background: false,
})

delegate_task({
  category: "deep",
  load_skills: ["playwright"], // Adds browser automation expertise
  description: "browser verification",
  prompt: "...",
  run_in_background: false,
})
```

**Example Evolution:**

| Before | After |
|--------|-------|
| Hardcoded: `frontend-ui-ux-engineer` (Gemini 3 Pro) | `category: "visual-engineering" + load_skills: ["frontend-ui-ux"]` |
| One-size-fits-all | `category: "visual-engineering" + load_skills: ["unity-master"]` |
| Model bias | Category-based: model abstraction eliminates bias |

---

## The Orchestrator → Junior Workflow

```mermaid
sequenceDiagram
    participant User
    participant Orchestrator as Sisyphus Execution Mode
    participant Junior as Sisyphus-Junior
    participant Notepad as .sisyphus/notepads/
    
    User->>Orchestrator: /start-work
    Orchestrator->>Orchestrator: Read plan, build parallelization map
    
    loop For each task (parallel when possible)
        Orchestrator->>Notepad: Read accumulated wisdom
        Orchestrator->>Orchestrator: Build 7-section prompt
        
        Note over Orchestrator: Prompt Structure:<br/>1. TASK (exact checkbox)<br/>2. EXPECTED OUTCOME<br/>3. REQUIRED SKILLS<br/>4. REQUIRED TOOLS<br/>5. MUST DO<br/>6. MUST NOT DO<br/>7. CONTEXT + Wisdom
        
        Orchestrator->>Junior: delegate_task(category, load_skills, description, prompt, run_in_background)
        
        Junior->>Junior: Create todos, execute
        Junior->>Junior: Verify (lsp_diagnostics, tests)
        Junior->>Notepad: Append learnings
        Junior->>Orchestrator: Results + completion status
        
        Orchestrator->>Orchestrator: Verify independently
        Note over Orchestrator: NEVER trust subagent claims<br/>Run lsp_diagnostics at PROJECT level<br/>Run full test suite<br/>Read actual changed files
        
        alt Verification fails
            Orchestrator->>Junior: Re-delegate with failure context
        else Verification passes
            Orchestrator->>Orchestrator: Mark task complete, continue
        end
    end
    
    Orchestrator->>User: Final report with all results
```

---

## Why This Architecture Works

### 1. Separation of Concerns

- **Planning** (Prometheus): High reasoning, interview, strategic thinking
- **Orchestration** (Sisyphus Execution Mode): Coordination, verification, wisdom accumulation
- **Execution** (Junior): Focused implementation, no distractions

### 2. Explicit Over Implicit

Every Junior prompt includes:
- Exact task from plan
- Clear success criteria
- Forbidden actions
- All accumulated wisdom
- Reference files with line numbers

No assumptions. No guessing.

### 3. Trust But Verify

The Orchestrator **never trusts subagent claims**:
- Runs `lsp_diagnostics` at project level
- Executes full test suite
- Reads actual file changes
- Cross-references requirements

### 4. Model Optimization

Expensive models (Opus, GPT-5.2) used only where needed:
- Planning decisions (once per project)
- Debugging consultation (rare)
- Complex architecture (rare)

Bulk work goes to cost-effective models (Sonnet, Haiku, Flash).

---

## Getting Started

1. **Enter Prometheus Mode**: Press **Tab** at the prompt
2. **Describe Your Work**: "I want to add user authentication to my app"
3. **Answer Interview Questions**: Prometheus will ask about patterns, preferences, constraints
4. **Review the Plan**: Check `.sisyphus/plans/` for generated work plan
5. **Run `/start-work`**: Orchestrator takes over
6. **Observe**: Watch tasks complete with verification
7. **Done**: All todos complete, code verified, ready to ship

---

## Further Reading

- [Overview](./overview.md) - Quick start guide
- [Ultrawork Journey](../journeys/ultrawork.md) - Philosophy behind the system
- [Installation Guide](./installation.md) - Detailed installation instructions
- [Configuration](../reference/configuration.md) - Customize the orchestration
