import type { HookEventType, HookFailurePolicy, HookNodeId, RuntimeExecutionNode } from "./types"

interface HookRuntimeDispatcherOptions {
  order: Record<HookEventType, HookNodeId[]>
  onError?: (params: {
    event: HookEventType
    nodeId: HookNodeId
    error: unknown
    policy: HookFailurePolicy
  }) => void
}

export function getDefaultFailurePolicy(event: HookEventType): HookFailurePolicy {
  return event === "tool.execute.before" ? "fail-closed" : "fail-open"
}

export class HookRuntimeDispatcher {
  private readonly order: Record<HookEventType, HookNodeId[]>
  private readonly onError?: HookRuntimeDispatcherOptions["onError"]

  constructor(options: HookRuntimeDispatcherOptions) {
    this.order = options.order
    this.onError = options.onError
  }

  resolveNodeOrder(event: HookEventType, activeNodeIds: HookNodeId[]): HookNodeId[] {
    const eventOrder = this.order[event]
    const active = new Set(activeNodeIds)
    const ordered = eventOrder.filter((nodeId) => active.has(nodeId))

    const missing = [...active].filter((nodeId) => !eventOrder.includes(nodeId))
    if (missing.length > 0) {
      throw new Error(
        `Runtime order missing active nodes for ${event}: ${missing.join(", ")}`
      )
    }

    return ordered
  }

  async dispatch(event: HookEventType, nodes: RuntimeExecutionNode[]): Promise<void> {
    const byId = new Map<HookNodeId, RuntimeExecutionNode>()
    for (const node of nodes) {
      if (byId.has(node.id)) {
        throw new Error(`Duplicate runtime node id: ${node.id}`)
      }
      byId.set(node.id, node)
    }

    const orderedNodeIds = this.resolveNodeOrder(event, [...byId.keys()])

    for (const nodeId of orderedNodeIds) {
      const node = byId.get(nodeId)
      if (!node) continue

      const policy = node.failurePolicy ?? getDefaultFailurePolicy(event)
      try {
        await node.invoke()
      } catch (error) {
        this.onError?.({
          event,
          nodeId,
          error,
          policy,
        })

        if (policy === "fail-closed") {
          throw error
        }
      }
    }
  }
}
