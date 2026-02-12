import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

type ForbiddenPattern = { name: string; regex: RegExp }
type Violation = { filePath: string; line: number; pattern: string; text: string }

const FORBIDDEN: ForbiddenPattern[] = [
  { name: "TodoRead", regex: /\bTodoRead\b/ },
  { name: "TodoWrite", regex: /\bTodoWrite\b/ },
  { name: "todoread", regex: /\btodoread\b/i },
  { name: "todowrite", regex: /\btodowrite\b/i },
  { name: "session.todo", regex: /session\.todo/ },
  { name: "include_todos", regex: /\binclude_todos\b/ },
]

function listTsFiles(rootDir: string, skipPaths: Set<string>): string[] {
  const results: string[] = []
  const entries = readdirSync(rootDir, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = join(rootDir, entry.name)
    if (skipPaths.has(absolutePath)) continue

    if (entry.isDirectory()) {
      results.push(...listTsFiles(absolutePath, skipPaths))
      continue
    }

    if (entry.isFile() && absolutePath.endsWith(".ts")) {
      results.push(absolutePath)
    }
  }

  return results
}

function findViolations(filePath: string, patterns: ForbiddenPattern[]): Violation[] {
  const content = readFileSync(filePath, "utf-8")
  const lines = content.split(/\r?\n/)
  const violations: Violation[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        violations.push({
          filePath,
          line: i + 1,
          pattern: pattern.name,
          text: line.trim(),
        })
      }
    }
  }

  return violations
}

describe("task graph v2 guard (no todo compatibility)", () => {
  test("forbidden todo/todowrite compatibility markers are absent in src/", () => {
    // #given
    const sourceRoot = resolve(import.meta.dir, "../../src")
    expect(statSync(sourceRoot).isDirectory()).toBe(true)

    const selfPath = resolve(import.meta.dir, "task-graph.no-todo-compat.static.test.ts")
    const tsFiles = listTsFiles(sourceRoot, new Set([selfPath]))

    // #when
    const violations: Violation[] = []
    for (const filePath of tsFiles) {
      violations.push(...findViolations(filePath, FORBIDDEN))
    }

    // #then
    if (violations.length > 0) {
      const formatted = violations
        .slice(0, 50)
        .map((v) => `${v.filePath}:${v.line} [${v.pattern}] ${v.text}`)
        .join("\n")
      throw new Error(`Found forbidden todo compatibility markers in src/:\n${formatted}`)
    }
  })
})
