import type { BuiltinSkill } from "../types"

export const parallelAgentsSkill: BuiltinSkill = {
  name: "parallel-agents",
  description:
    "Parallel agent orchestration using git worktrees for filesystem isolation and tmux for monitoring/rescue. Use when users want to spawn multiple agents concurrently, isolate changes per agent, inspect status across agents, rescue stuck confirmations, or merge completed branches safely. Triggers: worktree, tmux, swarm, parallel agents, spawn, isolate, merge branch, agent status, rescue.",
  template: `# Parallel Agents Skill (git worktrees + tmux)

Orchestrate multiple AI coding agents in parallel by creating **one git worktree per agent** and managing them in **tmux** windows.
This enables real filesystem isolation (agents can touch the same files without stepping on each other until merge time) and provides a deterministic operational loop: spawn → monitor → rescue → merge → cleanup.

This skill is designed to work with **Claude Code**, **Codex**, and **OpenCode**.

## Mode Detection (First Step)

Classify the user's intent and jump to the relevant section:

| User Request Pattern | Mode | Jump To |
|---------------------|------|---------|
| "spawn N agents", "split into 3 tasks", "parallelize", "worktrees" | \`SPAWN\` | Section 1 |
| "list agents", "which ones are running", "status", "inspect panes" | \`STATUS\` | Section 2 |
| "stuck", "waiting", "(y/n)", "approve", "rescue" | \`RESCUE\` | Section 3 |
| "merge results", "integrate", "cleanup worktrees" | \`MERGE_CLEANUP\` | Section 4 |
| "tmux hook", "auto rescue", "opencode background" | \`INTEGRATION\` | Section 5 |

## Prerequisites

- You are inside a tmux session (\`$TMUX\` is set).
- \`tmux\` is installed and available on PATH.
- The project is a git repository.

If any prerequisite is missing, explain what is missing and provide the minimal next step (e.g., "start a tmux session first", "install tmux", "run inside a git repo").

## Conventions (Recommended)

- **Worktree directory**: \`../{project}__worktrees/\` (sibling of the main repo)
- **Branch naming**: \`feature-<name>\` or \`fix-<name>\` (choose a consistent scheme)
- **tmux window prefix**: \`wm-\` (worktree-managed)

## 1) SPAWN: Create worktree + tmux window + agent

### 1.1 Create a new worktree (new branch)

\`\`\`bash
project="$(basename \"$(pwd)\")"
worktrees_dir="../${"${"}project}__worktrees"
branch="feature-name"
path="$worktrees_dir/$branch"

mkdir -p "$worktrees_dir"
git worktree add -b "$branch" "$path"
\`\`\`

For an existing branch:

\`\`\`bash
git worktree add "$path" "$branch"
\`\`\`

### 1.2 Create a tmux window in the worktree directory

\`\`\`bash
window="wm-$branch"
tmux new-window -n "$window" -c "$path"
\`\`\`

### 1.3 Start an agent in the new window

Pick ONE of the following based on what the user is running:

\`\`\`bash
# Claude Code
claude

# Codex
codex

# OpenCode
opencode
\`\`\`

If the user provides a task, pass it as an initial prompt (only if the CLI supports it in their setup).

## 2) STATUS: Inspect agent status across windows

### 2.1 List worktree-related windows

\`\`\`bash
tmux list-windows -F '#I:#W' | grep -E '^[0-9]+:wm-'
\`\`\`

### 2.2 Capture pane output (prefer absolute targeting)

\`\`\`bash
session="$(tmux display-message -p '#S')"
tmux capture-pane -t "$session:2.1" -p -S -50
\`\`\`

### 2.3 Status detection patterns

Priority order: **error > waiting > working > done > idle**.

| Status | Pattern | Meaning |
|--------|---------|---------|
| error | \`error\\|exception\\|traceback\\|FAILED\\|Permission denied\` | Agent hit an error |
| waiting | \`(y/n)\\|[Y/n]\\|[y/N]\\|approve\\|confirm\\|AskUserQuestion\` | Needs user input |
| working | \`Reading\\|Writing\\|Bash\\(\\|executing\\|processing\\|Searching\` | Actively processing |
| done | last non-empty line matches prompt-only pattern (\`$\\|>\`) | Back at shell prompt |
| idle | none of the above | Unclear / no recent signal |

Prompt-only line regex:
\`\`\`regex
^[A-Za-z0-9_@:/~._ -]*[$>][[:space:]]*$
\`\`\`

## 3) RESCUE: Unblock a waiting agent (confirmation prompts)

### 3.1 Verify the pane is actually waiting

\`\`\`bash
session="$(tmux display-message -p '#S')"
target="$session:2.1"
tmux capture-pane -t "$target" -p -S -30 | grep -E \"\\(y/n\\)|\\[Y/n\\]|\\[y/N\\]|approve|confirm|AskUserQuestion\" -n
\`\`\`

### 3.2 Send "y" + Enter (ONLY after verification)

\`\`\`bash
tmux send-keys -t "$target" "y" Enter
\`\`\`

**Safety rules (non-negotiable):**
- NEVER send destructive keys (\`C-c\`, \`exit\`, \`rm\`, etc.) without verifying context.
- If the prompt is not an approval prompt, STOP and ask the user what to do.

## 4) MERGE_CLEANUP: Merge branches back to main and clean up

### 4.1 Merge

Run in the **main worktree**:

\`\`\`bash
git checkout main
git merge "$branch"
\`\`\`

If conflicts occur: resolve in the main worktree, re-run tests, and only then proceed.

### 4.2 Cleanup worktree + branch

\`\`\`bash
# Close tmux window first (optional but recommended)
session="$(tmux display-message -p '#S')"
tmux kill-window -t "$session:wm-$branch" 2>/dev/null || true

# Remove worktree (SAFE by default; fails if dirty)
git worktree remove "$path"

# Delete branch (only after merge is verified)
git branch -d "$branch"
\`\`\`

If \`git worktree remove\` fails due to uncommitted changes, DO NOT use \`--force\` unless the user explicitly confirms data loss.

## 5) INTEGRATION: Oh-My-OpenCode tmux hook (optional)

This repo includes a hook \`tmux-parallel-agents\` that can create tmux windows and worktrees for OpenCode background sessions.

Configure it in \`oh-my-opencode.json\` via the top-level \`tmux_parallel_agents\` section:

\`\`\`jsonc
{
  "tmux_parallel_agents": {
    "enabled": true,
    "layout": "main-vertical",
    "auto_rescue": false,
    "worktree": {
      "enabled": true,
      "dir_pattern": "../{project}__worktrees",
      "copy_files": [".env", ".env.local"],
      "symlink": ["node_modules"],
      "auto_cleanup": false
    }
  }
}
\`\`\`

Notes:
- The hook is only active when running inside tmux and \`tmux_parallel_agents.enabled\` is \`true\`.
- The hook must also not be disabled via \`disabled_hooks\` (hook name: \`tmux-parallel-agents\`).
- Treat \`worktree.auto_cleanup=true\` as potentially destructive; it uses forced removal.
- Hook implementation: \`src/hooks/tmux-parallel-agents/index.ts\`
`,
}
