import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { CheckResult, CheckDefinition, AuthProviderInfo, AuthProviderId } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import { parseJsonc, getDataDir, getOpenCodeConfigDir } from "../../../shared"

const OPENCODE_CONFIG_DIR = getOpenCodeConfigDir({ binary: "opencode" })
const OPENCODE_JSON = join(OPENCODE_CONFIG_DIR, "opencode.json")
const OPENCODE_JSONC = join(OPENCODE_CONFIG_DIR, "opencode.jsonc")
const OPENCODE_AUTH_JSON = join(getDataDir(), "opencode", "auth.json")

const AUTH_PLUGINS: Record<AuthProviderId, { plugin: string; name: string }> = {
  anthropic: { plugin: "builtin", name: "Anthropic (Claude)" },
  openai: { plugin: "opencode-openai-codex-auth", name: "OpenAI (ChatGPT)" },
  google: { plugin: "opencode-antigravity-auth", name: "Google (Gemini)" },
  "github-copilot": { plugin: "builtin", name: "GitHub Copilot" },
}

const AUTH_LOGIN_HINTS: Record<AuthProviderId, string> = {
  anthropic: "Run: opencode auth login (select Anthropic)",
  openai: "Run: opencode auth login (select OpenAI)",
  google: "Run: opencode auth login (select Google / Antigravity)",
  "github-copilot": "Run: opencode auth login (select GitHub Copilot)",
}

const GOOGLE_AUTH_ENV_KEYS = [
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
] as const

function getOpenCodeConfig(): { plugin?: string[] } | null {
  const configPath = existsSync(OPENCODE_JSONC) ? OPENCODE_JSONC : OPENCODE_JSON
  if (!existsSync(configPath)) return null

  try {
    const content = readFileSync(configPath, "utf-8")
    return parseJsonc<{ plugin?: string[] }>(content)
  } catch {
    return null
  }
}

function isPluginInstalled(plugins: string[], pluginName: string): boolean {
  if (pluginName === "builtin") return true
  return plugins.some((p) => p === pluginName || p.startsWith(`${pluginName}@`))
}

interface AuthEntry {
  type?: string
  refresh?: string
  access?: string
  expires?: number
}

type AuthStore = Record<string, AuthEntry>

function getAuthStore(): AuthStore | null {
  if (!existsSync(OPENCODE_AUTH_JSON)) return null

  try {
    const content = readFileSync(OPENCODE_AUTH_JSON, "utf-8")
    const parsed = parseJsonc<AuthStore>(content)
    if (!parsed || typeof parsed !== "object") return null
    return parsed
  } catch {
    return null
  }
}

function hasRefreshToken(entry: AuthEntry | undefined): boolean {
  return typeof entry?.refresh === "string" && entry.refresh.trim().length > 0
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0
}

export function getGoogleConfiguredEnvKey(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  for (const key of GOOGLE_AUTH_ENV_KEYS) {
    if (hasEnvValue(env[key])) {
      return key
    }
  }
  return null
}

export function getAuthProviderInfo(providerId: AuthProviderId): AuthProviderInfo {
  const config = getOpenCodeConfig()
  const plugins = config?.plugin ?? []
  const authConfig = AUTH_PLUGINS[providerId]
  const authStore = getAuthStore()
  const authEntry = authStore?.[providerId]

  const pluginInstalled = isPluginInstalled(plugins, authConfig.plugin)
  const hasOAuth = hasRefreshToken(authEntry)
  const googleEnvKey = providerId === "google" ? getGoogleConfiguredEnvKey() : null

  const configured =
    providerId === "anthropic"
      ? pluginInstalled
      : providerId === "google"
        ? hasOAuth || googleEnvKey !== null
        : hasOAuth

  const configuredVia = providerId === "anthropic" && configured
    ? "plugin"
    : hasOAuth
      ? "oauth"
      : googleEnvKey !== null
        ? "environment"
        : undefined
  const error = pluginInstalled && !configured
    ? providerId === "google"
      ? `No Google auth found: configure OAuth or one of ${GOOGLE_AUTH_ENV_KEYS.join(", ")}`
      : `No OAuth refresh token found for provider "${providerId}"`
    : undefined

  return {
    id: providerId,
    name: authConfig.name,
    pluginInstalled,
    configured,
    configuredVia,
    configuredEnvVar: googleEnvKey ?? undefined,
    error,
  }
}

export async function checkAuthProvider(providerId: AuthProviderId): Promise<CheckResult> {
  const info = getAuthProviderInfo(providerId)
  const checkId = `auth-${providerId}` as keyof typeof CHECK_NAMES
  const checkName = CHECK_NAMES[checkId] || info.name

  if (!info.pluginInstalled) {
    return {
      name: checkName,
      status: "skip",
      message: "Auth plugin not installed",
      details: [
        `Plugin: ${AUTH_PLUGINS[providerId].plugin}`,
        "Run: bunx oh-my-opencode install",
      ],
    }
  }

  if (!info.configured) {
    const details = [
      info.error ?? "No valid OAuth token found",
      AUTH_LOGIN_HINTS[providerId],
    ]
    if (providerId === "google") {
      details.push(
        `Or set environment variable: ${GOOGLE_AUTH_ENV_KEYS.join(" / ")}`
      )
    }
    return {
      name: checkName,
      status: "warn",
      message: "Auth not configured",
      details,
    }
  }

  const details = [AUTH_LOGIN_HINTS[providerId]]
  if (info.configuredVia === "environment" && info.configuredEnvVar) {
    details.unshift(`Configured via environment variable: ${info.configuredEnvVar}`)
  }

  return {
    name: checkName,
    status: "pass",
    message: "Auth configured",
    details,
  }
}

export async function checkAnthropicAuth(): Promise<CheckResult> {
  return checkAuthProvider("anthropic")
}

export async function checkOpenAIAuth(): Promise<CheckResult> {
  return checkAuthProvider("openai")
}

export async function checkGoogleAuth(): Promise<CheckResult> {
  return checkAuthProvider("google")
}

export async function checkGithubCopilotAuth(): Promise<CheckResult> {
  return checkAuthProvider("github-copilot")
}

export function getAuthCheckDefinitions(): CheckDefinition[] {
  return [
    {
      id: CHECK_IDS.AUTH_ANTHROPIC,
      name: CHECK_NAMES[CHECK_IDS.AUTH_ANTHROPIC],
      category: "authentication",
      check: checkAnthropicAuth,
      critical: false,
    },
    {
      id: CHECK_IDS.AUTH_OPENAI,
      name: CHECK_NAMES[CHECK_IDS.AUTH_OPENAI],
      category: "authentication",
      check: checkOpenAIAuth,
      critical: false,
    },
    {
      id: CHECK_IDS.AUTH_GOOGLE,
      name: CHECK_NAMES[CHECK_IDS.AUTH_GOOGLE],
      category: "authentication",
      check: checkGoogleAuth,
      critical: false,
    },
    {
      id: CHECK_IDS.AUTH_GITHUB_COPILOT,
      name: CHECK_NAMES[CHECK_IDS.AUTH_GITHUB_COPILOT],
      category: "authentication",
      check: checkGithubCopilotAuth,
      critical: false,
    },
  ]
}
