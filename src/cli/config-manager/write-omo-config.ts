import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { parseJsonc } from "../../shared"
import type { ConfigMergeResult, InstallConfig } from "../types"
import { getConfigDir, getOmoConfigDirPath, getOmoConfigPath } from "./config-context"
import { deepMergeRecord } from "./deep-merge-record"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { generateOmoConfig } from "./generate-omo-config"
import { CURRENT_CONFIG_VERSION } from "../../config/version"

function isEmptyOrWhitespace(content: string): boolean {
  return content.trim().length === 0
}

function getVersionMismatchError(version: unknown): string {
  const received = version === undefined ? "undefined" : JSON.stringify(version)
  return `Existing config_version must be ${CURRENT_CONFIG_VERSION} before update (received: ${received}). This build supports latest config only.`
}

export function writeOmoConfig(installConfig: InstallConfig): ConfigMergeResult {
  try {
    ensureConfigDirectoryExists()
  } catch (err) {
    return { success: false, configPath: getConfigDir(), error: formatErrorWithSuggestion(err, "create config directory") }
  }

  const omoConfigPath = getOmoConfigPath()
  const omoConfigDirPath = getOmoConfigDirPath()

  try {
    mkdirSync(omoConfigDirPath, { recursive: true })

    const newConfig = generateOmoConfig(installConfig)

    if (existsSync(omoConfigPath)) {
      const stat = statSync(omoConfigPath)
      const content = readFileSync(omoConfigPath, "utf-8")

      if (stat.size === 0 || isEmptyOrWhitespace(content)) {
        return {
          success: false,
          configPath: omoConfigPath,
          error: `Existing config is empty: ${omoConfigPath}. Delete it and rerun install to regenerate latest config.`,
        }
      }

      const existing = parseJsonc<Record<string, unknown>>(content)
      if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
        return {
          success: false,
          configPath: omoConfigPath,
          error: `Existing config is not a JSON object: ${omoConfigPath}. Delete it and rerun install to regenerate latest config.`,
        }
      }

      if (existing.config_version !== CURRENT_CONFIG_VERSION) {
        return {
          success: false,
          configPath: omoConfigPath,
          error: getVersionMismatchError(existing.config_version),
        }
      }

      const merged = deepMergeRecord(existing, newConfig)
      writeFileSync(omoConfigPath, JSON.stringify(merged, null, 2) + "\n")
    } else {
      writeFileSync(omoConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
    }

    return { success: true, configPath: omoConfigPath }
  } catch (err) {
    return { success: false, configPath: omoConfigPath, error: formatErrorWithSuggestion(err, "write oh-my-opencode config") }
  }
}
