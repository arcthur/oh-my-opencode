import type { PluginInput } from "@opencode-ai/plugin";
import { appendBudgetedOutput } from "../../features/context-view";
import { getSessionAgent } from "../../features/claude-code-session-state";
import {
  loadAgentUsageState,
  saveAgentUsageState,
  clearAgentUsageState,
} from "./storage";
import { TARGET_TOOLS, AGENT_TOOLS, REMINDER_MESSAGE } from "./constants";
import type { AgentUsageState } from "./types";

const TARGET_AGENTS = new Set([
  "sisyphus",
]);

interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
  agent?: string;
}

interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

export function createDelegationNudgeAgentUsageHook(_ctx: PluginInput) {
  const sessionStates = new Map<string, AgentUsageState>();

  function getOrCreateState(sessionID: string): AgentUsageState {
    if (!sessionStates.has(sessionID)) {
      const persisted = loadAgentUsageState(sessionID);
      const state: AgentUsageState = persisted ?? {
        sessionID,
        agentUsed: false,
        reminderShown: false,
        reminderCount: 0,
        updatedAt: Date.now(),
      };
      sessionStates.set(sessionID, state);
    }
    return sessionStates.get(sessionID)!;
  }

  function isTargetAgent(sessionID: string, inputAgent?: string): boolean {
    const agent = getSessionAgent(sessionID) ?? inputAgent;
    if (!agent) return false;
    return TARGET_AGENTS.has(agent.toLowerCase());
  }

  function markAgentUsed(sessionID: string): void {
    const state = getOrCreateState(sessionID);
    state.agentUsed = true;
    state.updatedAt = Date.now();
    saveAgentUsageState(state);
  }

  function resetState(sessionID: string): void {
    sessionStates.delete(sessionID);
    clearAgentUsageState(sessionID);
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput,
  ) => {
    const { tool, sessionID } = input;
    const toolLower = tool.toLowerCase();

    if (!isTargetAgent(sessionID, input.agent)) {
      return;
    }

    if (AGENT_TOOLS.has(toolLower)) {
      markAgentUsed(sessionID);
      return;
    }

    if (!TARGET_TOOLS.has(toolLower)) {
      return;
    }

    const state = getOrCreateState(sessionID);

    if (state.agentUsed || state.reminderShown) {
      return;
    }

    appendBudgetedOutput({
      output,
      sessionID,
      source: "delegation-nudge-agent-usage",
      id: `${input.callID}:agent-usage-reminder`,
      priority: "normal",
      content: REMINDER_MESSAGE,
    });
    state.reminderShown = true;
    state.reminderCount++;
    state.updatedAt = Date.now();
    saveAgentUsageState(state);
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        resetState(sessionInfo.id);
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined;
      if (sessionID) {
        resetState(sessionID);
      }
    }
  };

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
