import type { PluginInput } from "@opencode-ai/plugin";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  loadInjectedPaths,
  saveInjectedPaths,
  clearInjectedPaths,
} from "./storage";
import { AGENTS_FILENAME } from "./constants";
import { contextBudgetArbiter } from "../../features/context-view";

interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

interface ToolExecuteBeforeOutput {
  args: unknown;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

function hasPointerFields(content: string): boolean {
  return content.includes("Path:") && content.includes("Next: Read");
}

export function createDirectoryAgentsInjectorHook(ctx: PluginInput) {
  const sessionCaches = new Map<string, Set<string>>();

  function getSessionCache(sessionID: string): Set<string> {
    if (!sessionCaches.has(sessionID)) {
      sessionCaches.set(sessionID, loadInjectedPaths(sessionID));
    }
    return sessionCaches.get(sessionID)!;
  }

  function readSummaryLine(filePath: string): string | null {
    try {
      const content = readFileSync(filePath, "utf-8");
      const line = content
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find((item) => item.length > 0);
      if (!line) return null;
      return line.slice(0, 120);
    } catch {
      return null;
    }
  }

  function resolveFilePath(path: string): string | null {
    if (!path) return null;
    if (path.startsWith("/")) return path;
    return resolve(ctx.directory, path);
  }

  function findAgentsMdUp(startDir: string): string[] {
    const found: string[] = [];
    let current = startDir;

    while (true) {
      // Skip root AGENTS.md - OpenCode's system.ts already loads it via custom()
      // See: https://github.com/code-yeongyu/oh-my-opencode/issues/379
      const isRootDir = current === ctx.directory;
      if (!isRootDir) {
        const agentsPath = join(current, AGENTS_FILENAME);
        if (existsSync(agentsPath)) {
          found.push(agentsPath);
        }
      }

      if (isRootDir) break;
      const parent = dirname(current);
      if (parent === current) break;
      if (!parent.startsWith(ctx.directory)) break;
      current = parent;
    }

    return found.reverse();
  }

  async function processFilePathForInjection(
    filePath: string,
    sessionID: string,
    output: ToolExecuteOutput,
  ): Promise<void> {
    const resolved = resolveFilePath(filePath);
    if (!resolved) return;

    const dir = dirname(resolved);
    const cache = getSessionCache(sessionID);
    const agentsPaths = findAgentsMdUp(dir);

    for (const agentsPath of agentsPaths) {
      const agentsDir = dirname(agentsPath);
      if (cache.has(agentsDir)) continue;

      try {
        const summary = readSummaryLine(agentsPath);
        const summaryLine = summary ? `\nSummary: ${summary}` : "";
        const injection = `

[Pointer Card]
Path: ${agentsPath}
Why: Directory-specific AGENTS guidance may apply to this file scope.${summaryLine}
Next: Read ${agentsPath}
`;
        const decision = contextBudgetArbiter.decide({
          sessionID,
          source: "directory-agents",
          channel: "tool-output",
          id: agentsPath,
          priority: "normal",
          content: injection,
        });
        if (decision.accepted && hasPointerFields(decision.finalContent)) {
          output.output += decision.finalContent;
          cache.add(agentsDir);
          continue;
        }

        const minimalPointer = `
[Pointer]
Path: ${agentsPath}
Next: Read ${agentsPath}
`;
        const fallbackDecision = contextBudgetArbiter.decide({
          sessionID,
          source: "directory-agents",
          channel: "tool-output",
          id: `${agentsPath}:pointer-fallback`,
          priority: "critical",
          content: minimalPointer,
        });
        if (fallbackDecision.accepted && hasPointerFields(fallbackDecision.finalContent)) {
          output.output += fallbackDecision.finalContent;
        } else {
          output.output += minimalPointer;
        }
        cache.add(agentsDir);
      } catch {}
    }

    saveInjectedPaths(sessionID, cache);
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput,
  ) => {
    const toolName = input.tool.toLowerCase();

    if (toolName === "read") {
      await processFilePathForInjection(output.title, input.sessionID, output);
      return;
    }
  };

  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    output: ToolExecuteBeforeOutput,
  ): Promise<void> => {
    void input;
    void output;
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        sessionCaches.delete(sessionInfo.id);
        clearInjectedPaths(sessionInfo.id);
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined;
      if (sessionID) {
        sessionCaches.delete(sessionID);
        clearInjectedPaths(sessionID);
      }
    }
  };

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
