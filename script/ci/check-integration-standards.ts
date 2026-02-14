import { readFileSync } from "node:fs"

type LineRule = {
  id: string
  pattern: RegExp
  message: string
}

type FileRuleContext = {
  file: string
  content: string
  lines: string[]
  allowedRuleIds: Set<string>
}

type FileRuleViolation = {
  id: string
  message: string
  line: number
  code?: string
}

const lineRules: LineRule[] = [
  {
    id: "mock-module",
    pattern: /\bmock\.module\s*\(/,
    message: "integration tests must not replace module dependencies with mock.module",
  },
  {
    id: "vi-mock",
    pattern: /\bvi\.mock\s*\(/,
    message: "integration tests must not replace module dependencies with vi.mock",
  },
  {
    id: "spy-on",
    pattern: /\bspyOn\s*\(/,
    message: "integration tests should assert observable outcomes instead of spyOn call internals",
  },
  {
    id: "sleep",
    pattern: /await\s+new\s+Promise\s*\(/,
    message: "integration tests must use condition polling helpers instead of fixed sleeps",
  },
  {
    id: "set-timeout",
    pattern: /\bsetTimeout\s*\(/,
    message: "integration tests must avoid direct setTimeout scheduling in test bodies",
  },
]

type Violation = {
  file: string
  line: number
  ruleId: string
  message: string
  code: string
}

function isLineComment(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith("//")
}

function firstMatchLine(lines: string[], pattern: RegExp): number {
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index] ?? "")) return index + 1
  }
  return 1
}

function parseAllowedRuleIds(content: string): Set<string> {
  const allowed = new Set<string>()
  const matches = content.matchAll(/integration-allow:\s*([a-z0-9,\-\s]+)/gi)
  for (const match of matches) {
    const raw = match[1] ?? ""
    const ids = raw.split(",").map((item) => item.trim()).filter(Boolean)
    for (const id of ids) allowed.add(id)
  }
  return allowed
}

function evaluateFileRules(context: FileRuleContext): FileRuleViolation[] {
  const violations: FileRuleViolation[] = []
  const { content, lines, allowedRuleIds } = context

  const hasSrcReference = /(?:from\s+["'`]|require\(\s*["'`]|import\(\s*["'`])(?:\.\.\/)+src\//.test(content)
  if (!hasSrcReference) {
    violations.push({
      id: "src-reference",
      message: "integration test must reference production code under src/",
      line: 1,
      code: "Missing import/require/import() path targeting src/",
    })
  }

  const mutatesProcessOrFsState = /\b(tmpdir|mkdtemp|process\.chdir|process\.env(?:\[|\.))/m.test(content)
  const hasCleanup = /\b(afterEach|afterAll)\s*\(|\bfinally\s*\{/m.test(content)
  if (mutatesProcessOrFsState && !hasCleanup && !allowedRuleIds.has("state-cleanup")) {
    const line = firstMatchLine(lines, /\b(tmpdir|mkdtemp|process\.chdir|process\.env(?:\[|\.))/)
    violations.push({
      id: "state-cleanup",
      message: "tests that mutate filesystem/process state must include cleanup (afterEach/afterAll/finally)",
      line,
      code: lines[line - 1]?.trim() ?? "",
    })
  }

  const hasNetworkClientCall = /\b(fetch\s*\(|axios\b|http\.request\s*\(|https\.request\s*\(|new\s+WebSocket\s*\(|undici\b)/m.test(content)
  const hasNetworkAllowAnnotation = /integration-allow-network/m.test(content)
  if (hasNetworkClientCall && !hasNetworkAllowAnnotation && !allowedRuleIds.has("network-egress")) {
    const line = firstMatchLine(lines, /\b(fetch\s*\(|axios\b|http\.request\s*\(|https\.request\s*\(|new\s+WebSocket\s*\(|undici\b)/)
    violations.push({
      id: "network-egress",
      message: "integration tests must not call real outbound network clients without explicit annotation",
      line,
      code: lines[line - 1]?.trim() ?? "",
    })
  }

  if (!allowedRuleIds.has("vitest-import") && /from\s+["'`]vitest["'`]/.test(content)) {
    const line = firstMatchLine(lines, /from\s+["'`]vitest["'`]/)
    violations.push({
      id: "vitest-import",
      message: "integration tests must use bun:test (vitest is not supported in this repo's test runner)",
      line,
      code: lines[line - 1]?.trim() ?? "",
    })
  }

  if (!allowedRuleIds.has("as-any") && /\bas\s+any\b/.test(content)) {
    const line = firstMatchLine(lines, /\bas\s+any\b/)
    violations.push({
      id: "as-any",
      message: "integration tests must avoid 'as any' and prefer typing or unknown + narrowing",
      line,
      code: lines[line - 1]?.trim() ?? "",
    })
  }

  if (!allowedRuleIds.has("ts-suppression") && /@ts-ignore|@ts-expect-error/.test(content)) {
    const line = firstMatchLine(lines, /@ts-ignore|@ts-expect-error/)
    violations.push({
      id: "ts-suppression",
      message: "integration tests must not suppress type errors with @ts-ignore/@ts-expect-error",
      line,
      code: lines[line - 1]?.trim() ?? "",
    })
  }

  return violations
}

function collectViolations(file: string, content: string): Violation[] {
  const violations: Violation[] = []
  const lines = content.split(/\r?\n/)
  const allowedRuleIds = parseAllowedRuleIds(content)

  for (const violation of evaluateFileRules({ file, content, lines, allowedRuleIds })) {
    violations.push({
      file,
      line: violation.line,
      ruleId: violation.id,
      message: violation.message,
      code: violation.code ?? "",
    })
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    if (isLineComment(line)) continue

    for (const rule of lineRules) {
      if (allowedRuleIds.has(rule.id)) continue
      if (!rule.pattern.test(line)) continue
      violations.push({
        file,
        line: index + 1,
        ruleId: rule.id,
        message: rule.message,
        code: line.trim(),
      })
    }
  }

  return violations
}

async function listIntegrationTests(): Promise<string[]> {
  const files: string[] = []
  const glob = new Bun.Glob("test/integration/**/*.test.ts")
  for await (const file of glob.scan(".")) {
    files.push(file)
  }
  files.sort()
  return files
}

async function main(): Promise<void> {
  const files = await listIntegrationTests()
  const violations: Violation[] = []

  for (const file of files) {
    const content = readFileSync(file, "utf-8")
    violations.push(...collectViolations(file, content))
  }

  if (violations.length === 0) {
    console.log(`Integration standards check passed (${files.length} files scanned)`)
    return
  }

  console.error(`Integration standards check failed (${violations.length} violations)`)
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} [${violation.ruleId}] ${violation.message}`)
    console.error(`  ${violation.code}`)
  }

  process.exitCode = 1
}

await main()
