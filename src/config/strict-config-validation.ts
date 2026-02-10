import { CURRENT_CONFIG_VERSION } from "./version"
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "./schema"

interface StrictConfigValidationSuccess {
  success: true
  data: OhMyOpenCodeConfig
  errors: []
}

interface StrictConfigValidationFailure {
  success: false
  data: null
  errors: string[]
}

export type StrictConfigValidationResult =
  | StrictConfigValidationSuccess
  | StrictConfigValidationFailure

function formatConfigVersionError(received: unknown): string {
  const displayedValue =
    received === undefined ? "undefined" : JSON.stringify(received)
  return `config_version must be ${CURRENT_CONFIG_VERSION} (received: ${displayedValue}). This build only supports the latest config format.`
}

export function validateStrictOhMyOpenCodeConfig(
  rawConfig: unknown,
): StrictConfigValidationResult {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return {
      success: false,
      data: null,
      errors: ["Config root must be a JSON object."],
    }
  }

  const configObject = rawConfig as Record<string, unknown>
  if (configObject.config_version !== CURRENT_CONFIG_VERSION) {
    return {
      success: false,
      data: null,
      errors: [formatConfigVersionError(configObject.config_version)],
    }
  }

  const result = OhMyOpenCodeConfigSchema.safeParse(configObject)
  if (!result.success) {
    return {
      success: false,
      data: null,
      errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    }
  }

  return {
    success: true,
    data: result.data,
    errors: [],
  }
}
