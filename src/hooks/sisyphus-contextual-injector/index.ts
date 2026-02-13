import type { PluginInput } from "@opencode-ai/plugin"
import { contextBudgetArbiter, injectBudgetedPrompt } from "../../features/context-view"
import { getSessionAgent } from "../../features/claude-code-session-state"
import {
  SISYPHUS_CATEGORY_SKILLS_PROMPT_INJECTION,
  SISYPHUS_DELEGATION_PROMPT_STRUCTURE_VERBOSE,
  SISYPHUS_GITHUB_WORKFLOW_VERBOSE,
  SISYPHUS_INJECTABLE_SECTION_IDS,
  SISYPHUS_PARALLEL_DISPATCH_MATRIX_VERBOSE,
  SISYPHUS_PARALLEL_EXECUTION_VERBOSE,
  SISYPHUS_PHASE1_VERBOSE,
  SISYPHUS_PRE_DELEGATION_PLANNING_VERBOSE,
} from "../../agents/sisyphus/injectable-sections"

export const HOOK_NAME = "sisyphus-contextual-injector"

const GITHUB_WORKFLOW_PATTERN = /\b(pr|pull request|look into)\b/i
const OPEN_ENDED_PATTERN = /\b(improve|refactor|add feature|new feature|optimi[sz]e|cleanup)\b/i
const IMPLEMENTATION_TOOLS = new Set(["edit", "write"])

function isSisyphusSession(sessionID?: string, inputAgent?: string): boolean {
  if (!sessionID) return false
  const resolved = (getSessionAgent(sessionID) ?? inputAgent)?.toLowerCase()
  return resolved === "sisyphus"
}

function getTextPartIndex(parts: Array<{ type: string; text?: string }>): number {
  return parts.findIndex((p) => p.type === "text" && typeof p.text === "string")
}

function prependBudgetedChatText(input: {
  sessionID: string
  parts: Array<{ type: string; text?: string }>
  id: string
  content: string
}): void {
  const textPartIndex = getTextPartIndex(input.parts)
  if (textPartIndex < 0) return

  const decision = contextBudgetArbiter.decide({
    sessionID: input.sessionID,
    source: HOOK_NAME,
    channel: "chat-message",
    id: input.id,
    priority: "high",
    content: `${input.content}\n\n---\n\n`,
    oncePerSession: true,
  })
  if (!decision.accepted) return

  const original = input.parts[textPartIndex].text ?? ""
  input.parts[textPartIndex].text = `${decision.finalContent}${original}`
}

function appendBudgetedSystemMessage(input: {
  sessionID: string
  output: { message?: string }
  id: string
  content: string
  priority?: "critical" | "high" | "normal" | "low"
}): void {
  const decision = contextBudgetArbiter.decide({
    sessionID: input.sessionID,
    source: HOOK_NAME,
    channel: "synthetic-message",
    id: input.id,
    priority: input.priority ?? "high",
    content: `\n${input.content}`,
    oncePerSession: true,
  })
  if (!decision.accepted) return
  input.output.message = `${input.output.message ?? ""}${decision.finalContent}`
}

export function createSisyphusContextualInjectorHook(_ctx: PluginInput) {
  return {
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string }>
      }
    ): Promise<void> => {
      if (!isSisyphusSession(input.sessionID, input.agent)) {
        return
      }

      const promptText = output.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n")

      if (GITHUB_WORKFLOW_PATTERN.test(promptText)) {
        prependBudgetedChatText({
          sessionID: input.sessionID,
          parts: output.parts,
          id: SISYPHUS_INJECTABLE_SECTION_IDS.githubWorkflow,
          content: SISYPHUS_GITHUB_WORKFLOW_VERBOSE,
        })
      }

      if (OPEN_ENDED_PATTERN.test(promptText)) {
        prependBudgetedChatText({
          sessionID: input.sessionID,
          parts: output.parts,
          id: SISYPHUS_INJECTABLE_SECTION_IDS.phase1,
          content: SISYPHUS_PHASE1_VERBOSE,
        })
      }
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID?: string; callID?: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      if (!isSisyphusSession(input.sessionID)) {
        return
      }

      const sessionID = input.sessionID!
      const toolLower = input.tool.toLowerCase()

      if (toolLower === "delegate_task") {
        // NOTE: Injected at tool.execute.before — too late for the current call's
        // <delegation-decision> block, but provides schema reference for subsequent
        // delegate_task calls in the same session.
        appendBudgetedSystemMessage({
          sessionID,
          output,
          id: SISYPHUS_INJECTABLE_SECTION_IDS.preDelegation,
          content: `${SISYPHUS_PRE_DELEGATION_PLANNING_VERBOSE}\n\n${SISYPHUS_PARALLEL_EXECUTION_VERBOSE}\n\n${SISYPHUS_DELEGATION_PROMPT_STRUCTURE_VERBOSE}`,
        })

        if (output.args.run_in_background === true) {
          appendBudgetedSystemMessage({
            sessionID,
            output,
            id: SISYPHUS_INJECTABLE_SECTION_IDS.parallelMatrix,
            content: SISYPHUS_PARALLEL_DISPATCH_MATRIX_VERBOSE,
          })
        }

        const hasCategory = typeof output.args.category === "string" && output.args.category.length > 0
        if (hasCategory) {
          injectBudgetedPrompt({
            output: { args: output.args },
            sessionID,
            source: HOOK_NAME,
            id: SISYPHUS_INJECTABLE_SECTION_IDS.categorySkills,
            priority: "high",
            content: SISYPHUS_CATEGORY_SKILLS_PROMPT_INJECTION,
            channel: "delegate-prompt",
            oncePerSession: true,
          })
        }
        return
      }

      if (IMPLEMENTATION_TOOLS.has(toolLower)) {
        appendBudgetedSystemMessage({
          sessionID,
          output,
          id: SISYPHUS_INJECTABLE_SECTION_IDS.phase1,
          content: SISYPHUS_PHASE1_VERBOSE,
          priority: "normal",
        })
      }
    },

    event: async ({
      event,
    }: {
      event: { type: string; properties?: unknown }
    }) => {
      const props = event.properties as Record<string, unknown> | undefined
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          contextBudgetArbiter.clearSession(sessionInfo.id)
        }
        return
      }

      if (event.type === "session.compacted") {
        const sessionID = (props?.sessionID ??
          (props?.info as { id?: string } | undefined)?.id) as string | undefined
        if (sessionID) {
          contextBudgetArbiter.resetOncePerSession(sessionID)
        }
      }
    },
  }
}

