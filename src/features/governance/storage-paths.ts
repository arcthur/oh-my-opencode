import { homedir } from "node:os"
import { join } from "node:path"

export const ORCHESTRATOR_HOME_DIR_ENV = "ORCHESTRATOR_HOME_DIR"

export function getOrchestratorHomeDir(): string {
  const overridden = process.env[ORCHESTRATOR_HOME_DIR_ENV]
  if (typeof overridden === "string" && overridden.trim().length > 0) {
    return overridden
  }
  return join(homedir(), ".orchestrator")
}

export function getGovernanceTracesDir(): string {
  return join(getOrchestratorHomeDir(), "traces")
}

export function getGovernanceLedgerDir(): string {
  return join(getOrchestratorHomeDir(), "ledger")
}
