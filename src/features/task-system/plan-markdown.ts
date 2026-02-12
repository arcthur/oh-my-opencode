export interface PlanTaskDefinition {
  task_number: number
  title: string
  raw_block: string
  context_pack_ids: string[]
  scenario_refs: string[]
  depends_on_task_numbers: number[]
}

export interface PlanBddAlignmentIssue {
  task_number: number
  title: string
  reason: "missing_scenario_ref"
}

const SAFE_PACK_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const SAFE_SCENARIO_REF_REGEX = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/

function isSafePackId(id: string): boolean {
  return SAFE_PACK_ID_REGEX.test(id)
}

function isSafeScenarioRef(id: string): boolean {
  return SAFE_SCENARIO_REF_REGEX.test(id)
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

function splitScenarioRefs(raw: string): string[] {
  return raw
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && isSafeScenarioRef(s))
}

function extractScenarioRefsFromBlock(block: string): string[] {
  const lines = block.split(/\r?\n/g)
  const refs: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const match = line.match(
      /^\s*(?:[-*]\s*)?Scenario\s+Ref(?:erence)?s?\s*:\s*(.*?)\s*$/i
    )
    if (!match) continue

    const remainder = (match[1] ?? "").trim()
    if (remainder.length > 0) {
      refs.push(...splitScenarioRefs(remainder))
      continue
    }

    // Multi-line bullet list form:
    // Scenario Refs:
    // - S-001
    // - S-002
    for (let j = i + 1; j < lines.length; j++) {
      const next = (lines[j] ?? "").trim()
      if (next.length === 0) break

      const bullet = next.match(/^[-*]\s*([A-Za-z][A-Za-z0-9._:-]{0,63})\s*$/)
      if (!bullet) break
      if (isSafeScenarioRef(bullet[1]!)) refs.push(bullet[1]!)
    }
  }

  const seen = new Set<string>()
  return refs.filter((id) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function extractDependsOnTaskNumbersFromBlock(block: string): number[] {
  const lines = block.split(/\r?\n/g)
  const deps: number[] = []

  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*]\s*)?Depends On\s*:\s*(.*?)\s*$/i)
    if (!match) continue

    const raw = (match[1] ?? "").trim()
    if (!raw) continue

    for (const part of raw.split(/[,\s]+/g)) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const value = Number.parseInt(trimmed, 10)
      if (Number.isFinite(value)) deps.push(value)
    }
  }

  const seen = new Set<number>()
  return deps.filter((n) => {
    if (!Number.isFinite(n)) return false
    if (seen.has(n)) return false
    seen.add(n)
    return true
  })
}

function findTasksSection(markdown: string): string {
  const lines = markdown.split(/\r?\n/g)
  const startIdx = lines.findIndex((l) => /^##\s+Tasks\b/i.test(l.trim()))
  if (startIdx === -1) return ""

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

type TaskStartMatch = { task_number: number; title: string }

function matchTaskStart(line: string): TaskStartMatch | null {
  // Bullet form: - 1. Title
  const bullet = line.match(/^\s*[-*]\s*(\d+)\.\s*(.+?)\s*$/)
  if (bullet) {
    const num = Number.parseInt(bullet[1] ?? "", 10)
    const title = (bullet[2] ?? "").trim()
    if (Number.isFinite(num) && title) return { task_number: num, title }
  }

  // Ordered list form: 1. Title
  const ordered = line.match(/^\s*(\d+)\.\s*(.+?)\s*$/)
  if (ordered) {
    const num = Number.parseInt(ordered[1] ?? "", 10)
    const title = (ordered[2] ?? "").trim()
    if (Number.isFinite(num) && title) return { task_number: num, title }
  }

  return null
}

export function parsePlanTasksFromMarkdown(markdown: string): PlanTaskDefinition[] {
  const section = findTasksSection(markdown)
  if (!section.trim()) return []

  const lines = section.split(/\r?\n/g)
  const tasks: PlanTaskDefinition[] = []

  let current: { start: TaskStartMatch; lines: string[] } | null = null
  for (const line of lines) {
    const start = matchTaskStart(line)
    if (start) {
      if (current) {
        const rawBlock = current.lines.join("\n").trimEnd()
        tasks.push({
          task_number: current.start.task_number,
          title: current.start.title,
          raw_block: rawBlock,
          context_pack_ids: extractContextPackIdsFromBlock(rawBlock),
          scenario_refs: extractScenarioRefsFromBlock(rawBlock),
          depends_on_task_numbers: extractDependsOnTaskNumbersFromBlock(rawBlock),
        })
      }
      current = { start, lines: [line] }
      continue
    }

    if (current) current.lines.push(line)
  }

  if (current) {
    const rawBlock = current.lines.join("\n").trimEnd()
    tasks.push({
      task_number: current.start.task_number,
      title: current.start.title,
      raw_block: rawBlock,
      context_pack_ids: extractContextPackIdsFromBlock(rawBlock),
      scenario_refs: extractScenarioRefsFromBlock(rawBlock),
      depends_on_task_numbers: extractDependsOnTaskNumbersFromBlock(rawBlock),
    })
  }

  const seen = new Set<number>()
  return tasks.filter((task) => {
    if (!Number.isFinite(task.task_number)) return false
    if (!task.title.trim()) return false
    if (seen.has(task.task_number)) return false
    seen.add(task.task_number)
    return true
  })
}

export function findPlanBddAlignmentIssues(markdown: string): PlanBddAlignmentIssue[] {
  return parsePlanTasksFromMarkdown(markdown)
    .filter((task) => task.scenario_refs.length === 0)
    .map((task) => ({
      task_number: task.task_number,
      title: task.title,
      reason: "missing_scenario_ref",
    }))
}
