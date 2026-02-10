import type { HookName } from "../../config"
import type { HookEventType, HookNodeId, RuntimeRegistryEntry } from "./types"
import { validateSemanticGroups } from "./semantic-groups"

const REGISTRY: RuntimeRegistryEntry[] = [
  { name: "task-auto-continuation", events: ["event"] },
  { name: "context-window-governor", events: ["event", "tool.execute.after", "experimental.session.compacting"] },
  { name: "session-state-repair", events: [] },
  { name: "session-notification", events: ["event"] },
  { name: "comment-checker", events: ["tool.execute.before", "tool.execute.after"] },
  { name: "tool-output-truncator", events: ["tool.execute.after"] },
  { name: "directory-agents-injector", events: ["event", "tool.execute.before", "tool.execute.after"] },
  { name: "directory-readme-injector", events: ["event", "tool.execute.before", "tool.execute.after"] },
  { name: "empty-task-response-detector", events: ["tool.execute.after"] },
  { name: "think-mode", events: ["chat.message", "event"] },
  { name: "rules-injector", events: ["event", "tool.execute.before", "tool.execute.after"] },
  { name: "background-notification", events: ["event"] },
  { name: "auto-update-checker", events: ["event"] },
  { name: "startup-toast", events: [] },
  { name: "keyword-detector", events: ["chat.message"] },
  { name: "delegation-nudge-agent-usage", events: ["event", "tool.execute.after"] },
  { name: "non-interactive-env", events: ["tool.execute.before"] },
  { name: "interactive-bash-session", events: ["event", "tool.execute.after"] },
  { name: "thinking-block-validator", events: ["experimental.chat.messages.transform"] },
  { name: "ralph-loop", events: ["event"] },
  { name: "claude-code-hooks", events: ["chat.message", "tool.execute.before", "tool.execute.after", "event", "experimental.session.compacting"] },
  { name: "auto-slash-command", events: ["chat.message", "command.execute.before"] },
  { name: "edit-failure-guidance", events: ["tool.execute.after"] },
  { name: "delegation-failure-guidance", events: ["tool.execute.after"] },
  { name: "prometheus-md-only", events: ["tool.execute.before"] },
  { name: "start-work", events: ["chat.message"] },
  { name: "swarm-from-plan", events: ["chat.message"] },
  { name: "execution-orchestrator", events: ["event", "tool.execute.before", "tool.execute.after"] },
  { name: "planning-with-files", events: ["chat.message", "tool.execute.before", "tool.execute.after", "event"] },
  { name: "silent-tool-output", events: ["tool.execute.before", "tool.execute.after"] },
  { name: "context-manifest-injector", events: ["tool.execute.before"] },
  { name: "repo-overview-injector", events: ["tool.execute.after", "event"] },
  { name: "runtime-tracker", events: ["tool.execute.before", "tool.execute.after", "event"] },
  { name: "anti-slop-enforcer", events: ["tool.execute.after"] },
  { name: "pre-completion-verification", events: ["chat.message", "event"] },
  { name: "delegation-validate-decision", events: ["tool.execute.before"] },
  { name: "conditional-rules", events: ["tool.execute.before", "event"] },
  { name: "session-handoff", events: ["chat.message", "user.prompt.submit", "tool.execute.after", "event"] },
  { name: "question-label-truncator", events: ["tool.execute.before"] },
  { name: "delegation-block-subagent-question", events: ["tool.execute.before"] },
  { name: "write-existing-file-guard", events: ["tool.execute.before"] },
  { name: "continuation-stop-guard", events: ["chat.message", "event"] },
  { name: "delegation-nudge-category-skill", events: ["event", "tool.execute.after"] },
  { name: "sisyphus-junior-notepad", events: ["tool.execute.before"] },
  { name: "tmux-parallel-agents", events: ["event", "tool.execute.before"] },
  { name: "swarm-agent", events: ["event", "tool.execute.before", "tool.execute.after"] },
  // chat.params-only hook (executed outside runtime dispatcher)
  { name: "anthropic-effort", events: [] },
]

export function getRuntimeRegistryEntries(): RuntimeRegistryEntry[] {
  return [...REGISTRY]
}

function toNodeId(hookName: HookName, event: HookEventType): HookNodeId {
  if (hookName === "claude-code-hooks") {
    return `bridge:claude-code-hooks:${event}`
  }
  return `${hookName}:${event}`
}

export function validateRuntimeRegistry(params: {
  schemaHooks: string[]
  registryEntries: RuntimeRegistryEntry[]
  order: Record<HookEventType, HookNodeId[]>
}): void {
  const { schemaHooks, registryEntries, order } = params
  const schema = new Set(schemaHooks)
  const registry = new Set(registryEntries.map((entry) => entry.name))

  const missingInRegistry = [...schema].filter((name) => !registry.has(name as HookName))
  if (missingInRegistry.length > 0) {
    throw new Error(
      `Schema hooks missing in runtime registry: ${missingInRegistry.join(", ")}`
    )
  }

  const extraInRegistry = [...registry].filter((name) => !schema.has(name))
  if (extraInRegistry.length > 0) {
    throw new Error(`Runtime registry contains unknown hooks: ${extraInRegistry.join(", ")}`)
  }

  for (const entry of registryEntries) {
    for (const event of entry.events) {
      const nodeId = toNodeId(entry.name, event)
      if (!order[event].includes(nodeId)) {
        throw new Error(`Missing node in event order: ${nodeId}`)
      }
    }
  }

  for (const [event, nodes] of Object.entries(order) as Array<[HookEventType, HookNodeId[]]>) {
    const seen = new Set<HookNodeId>()
    for (const node of nodes) {
      if (seen.has(node)) {
        throw new Error(`Duplicate node in order for ${event}: ${node}`)
      }
      seen.add(node)

      if (node.startsWith("internal:")) {
        continue
      }

      if (node.startsWith("bridge:")) {
        const bridgeName = node.split(":")[1]
        if (bridgeName !== "claude-code-hooks") {
          throw new Error(`Unknown bridge node in order for ${event}: ${node}`)
        }
        continue
      }

      const hookName = node.split(":")[0] as HookName
      if (!schema.has(hookName)) {
        throw new Error(`Order references unknown hook ${hookName} in ${event}`)
      }
    }
  }

  validateSemanticGroups({ order })
}
