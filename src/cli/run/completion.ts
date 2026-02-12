import pc from "picocolors"
import { countIncompleteTasks } from "../../features/task-system"
import { resolveActiveTaskSelector } from "../../features/work-state"
import type { RunContext, ChildSession, SessionStatus } from "./types"

export async function checkCompletionConditions(ctx: RunContext): Promise<boolean> {
  try {
    if (!await areAllTasksComplete(ctx)) {
      return false
    }

    if (!await areAllChildrenIdle(ctx)) {
      return false
    }

    if (!await hasMainSessionTerminalOutput(ctx)) {
      return false
    }

    return true
  } catch (err) {
    console.error(pc.red(`[completion] API error: ${err}`))
    return false
  }
}

async function areAllTasksComplete(ctx: RunContext): Promise<boolean> {
  const resolved = resolveActiveTaskSelector(ctx.directory, ctx.sessionID)
  const incompleteTasks = countIncompleteTasks(resolved.selector, ctx.taskConfig ?? {})

  if (incompleteTasks > 0) {
    console.log(pc.dim(`  Waiting: ${incompleteTasks} tasks remaining`))
    return false
  }

  return true
}

async function areAllChildrenIdle(ctx: RunContext): Promise<boolean> {
  const allStatuses = await fetchAllStatuses(ctx)
  return areAllDescendantsIdle(ctx, ctx.sessionID, allStatuses)
}

interface CompletionMessage {
  info?: {
    id?: string
    role?: string
    finish?: string
  }
}

function extractMessages(payload: unknown): CompletionMessage[] {
  const data = (payload as { data?: unknown })?.data ?? payload
  return Array.isArray(data) ? (data as CompletionMessage[]) : []
}

function hasTerminalAssistantMessage(messages: CompletionMessage[]): boolean {
  let lastUser: CompletionMessage | undefined
  let lastAssistant: CompletionMessage | undefined
  let lastUserIndex = -1
  let lastAssistantIndex = -1

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!lastAssistant && msg.info?.role === "assistant") {
      lastAssistant = msg
      lastAssistantIndex = i
    }
    if (!lastUser && msg.info?.role === "user") {
      lastUser = msg
      lastUserIndex = i
    }
    if (lastAssistant && lastUser) {
      break
    }
  }

  if (!lastAssistant) {
    return false
  }

  const finish = lastAssistant.info?.finish
  if (!finish || finish === "tool-calls" || finish === "unknown") {
    return false
  }

  const lastUserId = lastUser?.info?.id
  const lastAssistantId = lastAssistant.info?.id
  if (!lastUserId || !lastAssistantId) {
    if (lastUserIndex < 0) {
      return true
    }
    return lastAssistantIndex > lastUserIndex
  }

  return lastUserId < lastAssistantId
}

async function hasMainSessionTerminalOutput(ctx: RunContext): Promise<boolean> {
  const messagesRes = await ctx.client.session.messages({
    path: { id: ctx.sessionID },
  })
  const messages = extractMessages(messagesRes)
  const complete = hasTerminalAssistantMessage(messages)
  if (!complete) {
    console.log(pc.dim("  Waiting: main session has no terminal assistant output yet"))
  }
  return complete
}

async function fetchAllStatuses(
  ctx: RunContext
): Promise<Record<string, SessionStatus>> {
  const statusRes = await ctx.client.session.status()
  return (statusRes.data ?? {}) as Record<string, SessionStatus>
}

async function areAllDescendantsIdle(
  ctx: RunContext,
  sessionID: string,
  allStatuses: Record<string, SessionStatus>
): Promise<boolean> {
  const childrenRes = await ctx.client.session.children({
    path: { id: sessionID },
  })
  const children = (childrenRes.data ?? []) as ChildSession[]

  for (const child of children) {
    const status = allStatuses[child.id]
    if (status && status.type !== "idle") {
      console.log(
        pc.dim(`  Waiting: session ${child.id.slice(0, 8)}... is ${status.type}`)
      )
      return false
    }

    const descendantsIdle = await areAllDescendantsIdle(
      ctx,
      child.id,
      allStatuses
    )
    if (!descendantsIdle) {
      return false
    }
  }

  return true
}
