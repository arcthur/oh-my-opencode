import pc from "picocolors"
import type { RunOptions, RunContext } from "./types"
import { createEventState, processEvents, serializeError } from "./events"
import type { OhMyOpenCodeConfig } from "../../config"
import { loadPluginConfig } from "../../plugin-config"
import { pollForCompletion } from "./poll-for-completion"
import { createServerConnection } from "./server-connection"
import { resolveSession } from "./session-resolver"
import { createJsonOutputManager } from "./json-output"
import { executeOnCompleteHook } from "./on-complete-hook"
import { ORCHESTRATOR_PROJECT_ROOT_ENV } from "../../features/orchestrator-tasks/storage"

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_SERVER_HOSTNAME = "127.0.0.1"
const CORE_AGENT_ORDER = ["orchestrator", "executor", "planner"] as const
const DEFAULT_AGENT = "orchestrator"

type EnvVars = Record<string, string | undefined>

export interface RunDependencies {
  createEventState: typeof createEventState
  processEvents: typeof processEvents
  serializeError: typeof serializeError
  loadPluginConfig: typeof loadPluginConfig
  pollForCompletion: typeof pollForCompletion
  createServerConnection: typeof createServerConnection
  resolveSession: typeof resolveSession
  createJsonOutputManager: typeof createJsonOutputManager
  executeOnCompleteHook: typeof executeOnCompleteHook
}

const DEFAULT_RUN_DEPENDENCIES: RunDependencies = {
  createEventState,
  processEvents,
  serializeError,
  loadPluginConfig,
  pollForCompletion,
  createServerConnection,
  resolveSession,
  createJsonOutputManager,
  executeOnCompleteHook,
}

const normalizeAgentName = (agent?: string): string | undefined => {
  if (!agent) return undefined
  const trimmed = agent.trim()
  if (!trimmed) return undefined
  const lowered = trimmed.toLowerCase()
  const coreMatch = CORE_AGENT_ORDER.find((name) => name.toLowerCase() === lowered)
  return coreMatch ?? trimmed
}

const isAgentDisabled = (agent: string, config: OhMyOpenCodeConfig): boolean => {
  const lowered = agent.toLowerCase()
  if (lowered === "orchestrator" && config.orchestrator_agent?.disabled === true) {
    return true
  }
  return (config.disabled_agents ?? []).some(
    (disabled) => disabled.toLowerCase() === lowered
  )
}

const pickFallbackAgent = (config: OhMyOpenCodeConfig): string => {
  for (const agent of CORE_AGENT_ORDER) {
    if (!isAgentDisabled(agent, config)) {
      return agent
    }
  }
  return DEFAULT_AGENT
}

const parseEnvPort = (rawPort?: string): number | undefined => {
  if (!rawPort) return undefined
  const parsed = Number.parseInt(rawPort, 10)
  if (Number.isNaN(parsed)) return undefined
  return parsed
}

export function createSafeEventProcessor(processor: Promise<void>): Promise<void> {
  return processor.catch(() => {})
}

export const resolveRunAgent = (
  options: RunOptions,
  pluginConfig: OhMyOpenCodeConfig,
  env: EnvVars = process.env
): string => {
  const cliAgent = normalizeAgentName(options.agent)
  const envAgent = normalizeAgentName(env.OPENCODE_DEFAULT_AGENT)
  const configAgent = normalizeAgentName(pluginConfig.default_run_agent)
  const resolved = cliAgent ?? envAgent ?? configAgent ?? DEFAULT_AGENT
  const normalized = normalizeAgentName(resolved) ?? DEFAULT_AGENT

  if (isAgentDisabled(normalized, pluginConfig)) {
    const fallback = pickFallbackAgent(pluginConfig)
    const fallbackDisabled = isAgentDisabled(fallback, pluginConfig)
    if (fallbackDisabled) {
      console.log(
        pc.yellow(
          `Requested agent "${normalized}" is disabled and no enabled core agent was found. Proceeding with "${fallback}".`
        )
      )
      return fallback
    }
    console.log(
      pc.yellow(
        `Requested agent "${normalized}" is disabled. Falling back to "${fallback}".`
      )
    )
    return fallback
  }

  return normalized
}

export async function run(
  options: RunOptions,
  deps: Partial<RunDependencies> = {}
): Promise<number> {
  const runtimeDeps: RunDependencies = {
    ...DEFAULT_RUN_DEPENDENCIES,
    ...deps,
  }

  // In CLI run mode there is no TUI for question tool prompts.
  process.env.OPENCODE_CLI_RUN_MODE = "true"

  const startTime = Date.now()
  const {
    message,
    directory = process.cwd(),
    timeout = DEFAULT_TIMEOUT_MS,
  } = options

  const abortController = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const hadProjectRootEnv = Object.prototype.hasOwnProperty.call(
    process.env,
    ORCHESTRATOR_PROJECT_ROOT_ENV
  )
  const originalProjectRootEnv = process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
  const shouldSetProjectRootEnv =
    originalProjectRootEnv === undefined || originalProjectRootEnv === ""
  if (shouldSetProjectRootEnv) {
    process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = directory
  }

  const jsonManager = options.json ? runtimeDeps.createJsonOutputManager() : null
  if (jsonManager) {
    jsonManager.redirectToStderr()
  }

  try {
    const pluginConfig = runtimeDeps.loadPluginConfig(directory, { command: "run" })
    const resolvedAgent = resolveRunAgent(options, pluginConfig)

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        console.log(pc.yellow("\nTimeout reached. Aborting..."))
        abortController.abort()
      }, timeout)
    }

    const resolvedPort = options.port ?? parseEnvPort(process.env.OPENCODE_SERVER_PORT)
    const resolvedHostname = process.env.OPENCODE_SERVER_HOSTNAME || DEFAULT_SERVER_HOSTNAME

    const { client, cleanup: serverCleanup } = await runtimeDeps.createServerConnection({
      port: resolvedPort,
      attach: options.attach,
      signal: abortController.signal,
      hostname: resolvedHostname,
    })

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      serverCleanup()
    }

    process.on("SIGINT", () => {
      console.log(pc.yellow("\nInterrupted. Shutting down..."))
      cleanup()
      process.exit(130)
    })

    try {
      const sessionID = await runtimeDeps.resolveSession({
        client,
        sessionId: options.sessionId,
      })

      console.log(pc.dim(`Session: ${sessionID}`))

      const ctx: RunContext = {
        client,
        sessionID,
        directory,
        abortController,
        taskConfig: pluginConfig,
      }

      const events = await client.event.subscribe({ query: { directory } })
      const eventState = runtimeDeps.createEventState()
      const eventProcessor = createSafeEventProcessor(
        runtimeDeps.processEvents(ctx, events.stream, eventState),
      )

      console.log(pc.dim("\nSending prompt..."))
      await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          agent: resolvedAgent,
          parts: [{ type: "text", text: message }],
        },
        query: { directory },
      })

      console.log(pc.dim("Waiting for completion...\n"))
      const exitCode = await runtimeDeps.pollForCompletion(ctx, eventState, abortController)

      await eventProcessor
      cleanup()

      const durationMs = Date.now() - startTime

      if (options.onComplete) {
        await runtimeDeps.executeOnCompleteHook({
          command: options.onComplete,
          sessionId: sessionID,
          exitCode,
          durationMs,
          messageCount: eventState.messageCount,
          silenceStdout: options.json === true,
        })
      }

      if (jsonManager) {
        jsonManager.emitResult({
          sessionId: sessionID,
          success: exitCode === 0,
          durationMs,
          messageCount: eventState.messageCount,
          summary: eventState.lastPartText.slice(0, 200) || "Run completed",
        })
      }

      return exitCode
    } catch (error) {
      cleanup()
      throw error
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId)
    if (jsonManager) jsonManager.restore()
    if (error instanceof Error && error.name === "AbortError") {
      return 130
    }
    console.error(pc.red(`Error: ${runtimeDeps.serializeError(error)}`))
    return 1
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    if (shouldSetProjectRootEnv) {
      if (hadProjectRootEnv && originalProjectRootEnv !== undefined) {
        process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = originalProjectRootEnv
      } else {
        delete process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
      }
    }
  }
}
