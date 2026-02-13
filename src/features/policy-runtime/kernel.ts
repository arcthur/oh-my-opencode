import type {
  ActionExpr,
  ContractClause,
  ExecutionContract,
  PolicyDecision,
  PolicyEventInput,
} from "../../contracts/types"

interface ClauseMatch {
  clause: ContractClause
  decision: PolicyDecision
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function getByPath(input: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".")
  let current: unknown = input
  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function conditionPaths(condition: Record<string, unknown>): string[] {
  const paths: string[] = []

  const equalsRule = condition.equals
  if (equalsRule && typeof equalsRule === "object") {
    paths.push(...Object.keys(equalsRule as Record<string, unknown>))
  }

  const notEqualsRule = condition.notEquals
  if (notEqualsRule && typeof notEqualsRule === "object") {
    paths.push(...Object.keys(notEqualsRule as Record<string, unknown>))
  }

  for (const path of Object.keys(condition)) {
    if (path === "equals" || path === "notEquals") {
      continue
    }
    paths.push(path)
  }

  return paths
}

function hasGuardPath(paths: string[]): boolean {
  return paths.some((path) => path.startsWith("payload.guards.") || path.startsWith("guards."))
}

function matchesSelector(clause: ContractClause, event: PolicyEventInput): boolean {
  const selector = clause.selector
  const toolNames = toArray(selector.toolName)
  if (toolNames.length > 0) {
    if (!event.toolName || !toolNames.includes(event.toolName)) {
      return false
    }
  }

  if (selector.agent && selector.agent !== event.agent) {
    return false
  }

  if (selector.sessionTags && selector.sessionTags.length > 0) {
    const tags = new Set(event.sessionTags ?? [])
    for (const requiredTag of selector.sessionTags) {
      if (!tags.has(requiredTag)) {
        return false
      }
    }
  }

  return true
}

function matchesCondition(clause: ContractClause, event: PolicyEventInput): boolean {
  const condition = clause.condition
  const keys = Object.keys(condition)
  if (keys.length === 0) {
    return true
  }

  const payload = event.payload ?? {}
  const source: Record<string, unknown> = {
    payload,
    sessionID: event.sessionID,
    hookPoint: event.hookPoint,
    toolName: event.toolName,
    agent: event.agent,
    sessionTags: event.sessionTags,
    ...payload,
  }

  if (hasGuardPath(conditionPaths(condition))) {
    const version = getByPath(source, "payload.guardsVersion") ?? getByPath(source, "guardsVersion")
    if (version !== 1) {
      const actual = version === undefined ? "undefined" : String(version)
      throw new Error(
        `[policy-runtime] incompatible guards payload version for clause ${clause.id}: expected 1, got ${actual}`
      )
    }
  }

  const equalsRule = condition.equals
  if (equalsRule && typeof equalsRule === "object") {
    for (const [path, expected] of Object.entries(equalsRule as Record<string, unknown>)) {
      if (getByPath(source, path) !== expected) {
        return false
      }
    }
  }

  const notEqualsRule = condition.notEquals
  if (notEqualsRule && typeof notEqualsRule === "object") {
    for (const [path, expected] of Object.entries(notEqualsRule as Record<string, unknown>)) {
      if (getByPath(source, path) === expected) {
        return false
      }
    }
  }

  for (const [path, expected] of Object.entries(condition)) {
    if (path === "equals" || path === "notEquals") continue
    if (getByPath(source, path) !== expected) {
      return false
    }
  }

  return true
}

function actionToDecision(action: ActionExpr): PolicyDecision["decision"] {
  switch (action.type) {
    case "deny":
      return "deny"
    case "modify":
      return "modify"
    case "audit":
      return "audit"
    default:
      return "allow"
  }
}

function compareClause(a: ContractClause, b: ContractClause): number {
  if (a.priority !== b.priority) {
    return a.priority - b.priority
  }
  return a.id.localeCompare(b.id)
}

function toMatch(clause: ContractClause, event: PolicyEventInput, matchedClauseIds: string[]): ClauseMatch {
  const now = Date.now()
  const decision: PolicyDecision = {
    decisionId: `policy_${now}_${Math.random().toString(36).slice(2, 10)}`,
    clauseId: clause.id,
    matchedClauseIds,
    hookPoint: event.hookPoint,
    enforcement: clause.enforcement,
    decision: actionToDecision(clause.action),
    mutation: clause.action.mutation,
    message: clause.action.message,
    reasonCode: clause.reasonCode,
    timestamp: now,
    trace: {
      hookNodeId:
        event.traceHookNodeId
        ?? (`internal:policy-enforce:${event.hookPoint}` as PolicyDecision["trace"]["hookNodeId"]),
      sessionID: event.sessionID,
      toolName: event.toolName,
    },
  }

  return { clause, decision }
}

function restrictiveness(decision: PolicyDecision["decision"]): number {
  switch (decision) {
    case "deny":
      return 4
    case "modify":
      return 3
    case "audit":
      return 2
    case "allow":
      return 1
    default:
      return 0
  }
}

function mostRestrictive(matches: ClauseMatch[]): PolicyDecision[] {
  const allIds = matches.map((m) => m.clause.id)

  let winner = matches[0]
  for (const m of matches) {
    if (restrictiveness(m.decision.decision) > restrictiveness(winner.decision.decision)) {
      winner = m
    }
  }

  return [{ ...winner.decision, matchedClauseIds: allIds }]
}

export function evaluatePolicyDecisions(
  contract: ExecutionContract,
  event: PolicyEventInput
): PolicyDecision[] {
  const candidates = contract.clauses
    .filter((clause) => clause.enabled)
    .filter((clause) => clause.hookPoints.includes(event.hookPoint))
    .filter((clause) => matchesSelector(clause, event))
    .filter((clause) => matchesCondition(clause, event))
    .sort(compareClause)

  if (candidates.length === 0) {
    return []
  }

  const matchedModes = [...new Set(candidates.map((clause) => clause.conflictResolution))]
  const mode = matchedModes.length === 1
    ? matchedModes[0]
    : contract.defaultConflictResolution
  const allIds = candidates.map((c) => c.id)
  const matches = candidates.map((clause) => toMatch(clause, event, [clause.id]))

  if (mode === "merge") {
    return matches.map((m) => ({ ...m.decision, matchedClauseIds: allIds }))
  }

  if (mode === "first-match") {
    return [{ ...matches[0].decision, matchedClauseIds: allIds }]
  }

  return mostRestrictive(matches)
}
