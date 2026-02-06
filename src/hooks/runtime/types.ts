import type { HookName } from "../../config"

export type HookEventType =
  | "chat.message"
  | "user.prompt.submit"
  | "tool.execute.before"
  | "tool.execute.after"
  | "event"
  | "experimental.chat.messages.transform"
  | "experimental.session.compacting"

export type BridgeHookNodeId = `bridge:claude-code-hooks:${HookEventType}`
export type InternalHookNodeId = `internal:${string}:${HookEventType}`
export type HookNodeId = `${HookName}:${HookEventType}` | BridgeHookNodeId | InternalHookNodeId

export type HookFailurePolicy = "fail-open" | "fail-closed"

export interface RuntimeExecutionNode {
  id: HookNodeId
  invoke: () => Promise<void>
  failurePolicy?: HookFailurePolicy
}

export interface RuntimeRegistryEntry {
  name: HookName
  events: HookEventType[]
}
