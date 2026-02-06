import type { OhMyOpenCodeConfig } from "../../config/schema"
import { parseContextManifestFromMarkdown, renderContextPacksForPrompt } from "../context-manifests"
import { createTask, listTaskIds, readTask } from "./task-pool/pool"

const SAFE_PACK_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

function isSafePackId(id: string): boolean {
  return SAFE_PACK_ID_REGEX.test(id)
}

function splitPackIds(raw: string): string[] {
  return raw
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && isSafePackId(s))
}

function extractContextPackIdsFromBlock(block: string): string[] {
  const lines = block.split(/\r?\n/g)
  const ids: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const match = line.match(/^\s*(?:[-*]\s*)?Context Packs?\s*:\s*(.*?)\s*$/i)
    if (!match) continue

    const remainder = (match[1] ?? "").trim()
    if (remainder.length > 0) {
      ids.push(...splitPackIds(remainder))
      continue
    }

    // Multi-line bullet list form:
    // Context Packs:
    // - global
    // - tooling
    for (let j = i + 1; j < lines.length; j++) {
      const next = (lines[j] ?? "").trim()
      if (next.length === 0) break

      const bullet = next.match(/^[-*]\s*([a-zA-Z0-9][a-zA-Z0-9._-]{0,63})\s*$/)
      if (!bullet) break
      if (isSafePackId(bullet[1]!)) ids.push(bullet[1]!)
    }
  }

  const seen = new Set<string>()
  return ids.filter((id) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export type PrometheusPlanTodo = {
  todoNumber: number
  title: string
  isComplete: boolean
  rawBlock: string
  contextPackIds: string[]
}

function findTodoSection(markdown: string): string {
  const lines = markdown.split(/\r?\n/g)
  const startIdx = lines.findIndex((l) => /^##\s+TODOs\b/i.test(l.trim()))
  if (startIdx === -1) return markdown

  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? ""
    if (/^##\s+/.test(line)) {
      endIdx = i
      break
    }
  }

  return lines.slice(startIdx + 1, endIdx).join("\n")
}

export function parsePrometheusPlanTodos(markdown: string): PrometheusPlanTodo[] {
  const section = findTodoSection(markdown)
  const lines = section.split(/\r?\n/g)

  type StartMatch = { isComplete: boolean; todoNumber: number; title: string }
  function matchTodoStart(line: string): StartMatch | null {
    const match = line.match(/^\s*-\s*\[([ xX])\]\s*(\d+)\.\s*(.+?)\s*$/)
    if (!match) return null
    const checked = (match[1] ?? "").toLowerCase() === "x"
    const todoNumber = Number.parseInt(match[2] ?? "", 10)
    if (!Number.isFinite(todoNumber)) return null
    const title = (match[3] ?? "").trim()
    if (!title) return null
    return { isComplete: checked, todoNumber, title }
  }

  const todos: PrometheusPlanTodo[] = []

  let current: { start: StartMatch; lines: string[] } | null = null
  for (const line of lines) {
    const start = matchTodoStart(line)
    if (start) {
      if (current) {
        const rawBlock = current.lines.join("\n").trimEnd()
        todos.push({
          todoNumber: current.start.todoNumber,
          title: current.start.title,
          isComplete: current.start.isComplete,
          rawBlock,
          contextPackIds: extractContextPackIdsFromBlock(rawBlock),
        })
      }
      current = { start, lines: [line] }
      continue
    }

    if (current) current.lines.push(line)
  }

  if (current) {
    const rawBlock = current.lines.join("\n").trimEnd()
    todos.push({
      todoNumber: current.start.todoNumber,
      title: current.start.title,
      isComplete: current.start.isComplete,
      rawBlock,
      contextPackIds: extractContextPackIdsFromBlock(rawBlock),
    })
  }

  return todos
}

export type SyncPlanTodosInput = {
  config: Partial<OhMyOpenCodeConfig>
  listId: string
  planId: string
  planMarkdown: string
  manifestMarkdown?: string
  renderOptions?: {
    maxTotalChars?: number
    maxCharsPerPack?: number
    maxItemsPerPack?: number
  }
}

export type SyncPlanTodosResult = {
  created: Array<{ todoNumber: number; taskId: string }>
  skipped: Array<{ todoNumber: number; reason: string }>
}

export function syncPlanTodosToTaskPool(input: SyncPlanTodosInput): SyncPlanTodosResult {
  const { config, listId, planId, planMarkdown, manifestMarkdown } = input
  const renderOptions = input.renderOptions ?? {}

  const todos = parsePrometheusPlanTodos(planMarkdown).filter((t) => !t.isComplete)

  const manifest = manifestMarkdown
    ? parseContextManifestFromMarkdown(manifestMarkdown)
    : null

  const existingKeys = new Set<string>()
  for (const taskId of listTaskIds(listId, config)) {
    const task = readTask(listId, taskId, config)
    const key = task?.metadata?.planTaskKey
    if (typeof key === "string" && key.trim().length > 0) {
      existingKeys.add(key)
    }
  }

  const created: Array<{ todoNumber: number; taskId: string }> = []
  const skipped: Array<{ todoNumber: number; reason: string }> = []

  for (const todo of todos) {
    const planTaskKey = `${planId}#${todo.todoNumber}`
    if (existingKeys.has(planTaskKey)) {
      skipped.push({ todoNumber: todo.todoNumber, reason: "already_exists" })
      continue
    }

    const snippet =
      manifest && todo.contextPackIds.length > 0
        ? renderContextPacksForPrompt(manifest, todo.contextPackIds, {
            maxTotalChars: renderOptions.maxTotalChars,
            maxCharsPerPack: renderOptions.maxCharsPerPack,
            maxItemsPerPack: renderOptions.maxItemsPerPack,
          })
        : ""

    const descriptionParts = [
      `# Plan Task: ${todo.todoNumber}. ${todo.title}`,
      ``,
      `Plan Task Key: ${planTaskKey}`,
      ``,
      `## Original TODO Block`,
      ``,
      todo.rawBlock.trimEnd(),
      snippet.trim() ? `\n\n${snippet.trimEnd()}` : "",
    ].filter(Boolean)

    const subject = `${todo.todoNumber}. ${todo.title}`
    const task = createTask(
      listId,
      {
        subject,
        description: descriptionParts.join("\n"),
        metadata: {
          planId,
          planTaskKey,
          todoNumber: todo.todoNumber,
          contextPackIds: todo.contextPackIds,
        },
      },
      config
    )

    existingKeys.add(planTaskKey)
    created.push({ todoNumber: todo.todoNumber, taskId: task.id })
  }

  return { created, skipped }
}
