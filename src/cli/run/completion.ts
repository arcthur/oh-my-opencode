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
