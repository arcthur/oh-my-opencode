import { log } from "./logger"

const PROVIDER_ENV_ALIASES = [
  {
    source: "GEMINI_API_KEY",
    target: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
  {
    source: "GOOGLE_API_KEY",
    target: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
] as const

export interface AppliedEnvAlias {
  source: string
  target: string
}

export interface ProviderEnvCompatResult {
  applied: AppliedEnvAlias[]
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0
}

export function applyProviderEnvCompat(env: NodeJS.ProcessEnv = process.env): ProviderEnvCompatResult {
  const applied: AppliedEnvAlias[] = []

  for (const alias of PROVIDER_ENV_ALIASES) {
    const sourceValue = env[alias.source]
    const targetValue = env[alias.target]
    if (!hasEnvValue(sourceValue) || hasEnvValue(targetValue)) {
      continue
    }

    env[alias.target] = sourceValue
    applied.push(alias)
  }

  if (applied.length > 0) {
    log("[provider-env-compat] applied aliases", { applied })
  }

  return { applied }
}
