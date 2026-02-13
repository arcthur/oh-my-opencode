import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"
import type { PolicyDecision } from "../../contracts"

export interface PolicyEvaluatorConfig {
  enabled: boolean
  async: boolean
  metrics: string[]
  baseDir?: string
}

export interface PolicyEvaluationInput {
  sessionID: string
  decision: PolicyDecision
  outcome: "applied" | "blocked" | "skipped" | "error" | "superseded"
  latencyMs?: number
}

interface PolicyEvaluationEntry {
  id: string
  timestamp: number
  sessionID: string
  decisionId: string
  clauseId: string
  hookPoint: string
  outcome: "applied" | "blocked" | "skipped" | "error" | "superseded"
  metrics: Record<string, number>
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function defaultConfig(): PolicyEvaluatorConfig {
  return {
    enabled: true,
    async: true,
    metrics: ["task_success", "groundedness", "cost", "latency"],
    baseDir: join(getOpenCodeStorageDir(), "policy-evaluator"),
  }
}

function buildMetrics(input: PolicyEvaluationInput, enabledMetrics: string[]): Record<string, number> {
  const metrics: Record<string, number> = {}
  for (const metric of enabledMetrics) {
    switch (metric) {
      case "task_success":
        metrics.task_success = input.outcome === "applied" ? 1 : 0
        break
      case "groundedness":
        metrics.groundedness = input.decision.matchedClauseIds.length > 0 ? 1 : 0
        break
      case "cost":
        metrics.cost = input.decision.decision === "modify" ? 2 : 1
        break
      case "latency":
        metrics.latency = input.latencyMs ?? 0
        break
      default:
        metrics[metric] = 0
        break
    }
  }
  return metrics
}

export class AsyncPolicyEvaluator {
  private config: PolicyEvaluatorConfig

  constructor(config?: Partial<PolicyEvaluatorConfig>) {
    this.config = { ...defaultConfig(), ...config }
  }

  configure(next: Partial<PolicyEvaluatorConfig>): void {
    this.config = { ...this.config, ...next }
  }

  evaluate(input: PolicyEvaluationInput): void {
    if (!this.config.enabled) {
      return
    }

    const write = () => {
      const baseDir = this.config.baseDir ?? defaultConfig().baseDir!
      const filePath = join(baseDir, `${input.sessionID}.jsonl`)
      ensureDir(dirname(filePath))
      const entry: PolicyEvaluationEntry = {
        id: `eval_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        timestamp: Date.now(),
        sessionID: input.sessionID,
        decisionId: input.decision.decisionId,
        clauseId: input.decision.clauseId,
        hookPoint: input.decision.hookPoint,
        outcome: input.outcome,
        metrics: buildMetrics(input, this.config.metrics),
      }
      appendFileSync(filePath, `${JSON.stringify(entry)}\n`)
    }

    const writeFailOpen = () => {
      try {
        write()
      }
      catch (error) {
        console.warn(
          "[oh-my-opencode][policy-evaluator] failed to persist policy evaluation",
          error,
        )
      }
    }

    if (this.config.async) {
      setImmediate(writeFailOpen)
      return
    }
    writeFailOpen()
  }
}

export const asyncPolicyEvaluator = new AsyncPolicyEvaluator()
