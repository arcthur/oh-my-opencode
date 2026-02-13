import type { PluginInput } from "@opencode-ai/plugin";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import { findProjectRoot, findRuleFiles } from "./finder";
import {
  createContentHash,
  isDuplicateByContentHash,
  isDuplicateByRealPath,
  shouldApplyRule,
} from "./matcher";
import { parseRuleFrontmatter } from "./parser";
import {
  clearInjectedRules,
  loadInjectedRules,
  saveInjectedRules,
} from "./storage";
import { getRuleInjectionFilePath } from "./output-path";
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

interface RuleToInject {
  relativePath: string;
  matchReason: string;
  summary?: string;
  distance: number;
}

const TRACKED_TOOLS = ["read", "write", "edit", "multiedit"];

function hasPointerFields(content: string): boolean {
  return content.includes("Path:") && content.includes("Next: Read");
}

export function createRulesInjectorHook(ctx: PluginInput) {
  const sessionCaches = new Map<
    string,
    { contentHashes: Set<string>; realPaths: Set<string> }
  >();

  function getSessionCache(sessionID: string): {
    contentHashes: Set<string>;
    realPaths: Set<string>;
  } {
    if (!sessionCaches.has(sessionID)) {
      sessionCaches.set(sessionID, loadInjectedRules(sessionID));
    }
    return sessionCaches.get(sessionID)!;
  }

  function resolveFilePath(path: string): string | null {
    if (!path) return null;
    if (path.startsWith("/")) return path;
    return resolve(ctx.directory, path);
  }

  function buildRuleSummary(body: string): string | undefined {
    const line = body
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.length > 0);
    if (!line) return undefined;
    return line.slice(0, 120);
  }


  async function processFilePathForInjection(
    filePath: string,
    sessionID: string,
    output: ToolExecuteOutput
  ): Promise<void> {
    const resolved = resolveFilePath(filePath);
    if (!resolved) return;

    const projectRoot = findProjectRoot(resolved);
    const cache = getSessionCache(sessionID);
    const home = homedir();

    const ruleFileCandidates = findRuleFiles(projectRoot, home, resolved);
    const toInject: RuleToInject[] = [];

    for (const candidate of ruleFileCandidates) {
      if (isDuplicateByRealPath(candidate.realPath, cache.realPaths)) continue;

      try {
        const rawContent = readFileSync(candidate.path, "utf-8");
        const { metadata, body } = parseRuleFrontmatter(rawContent);

        let matchReason: string;
        if (candidate.isSingleFile) {
          matchReason = "copilot-instructions (always apply)";
        } else {
          const matchResult = shouldApplyRule(metadata, resolved, projectRoot);
          if (!matchResult.applies) continue;
          matchReason = matchResult.reason ?? "matched";
        }

        const contentHash = createContentHash(body);
        if (isDuplicateByContentHash(contentHash, cache.contentHashes)) continue;

        const relativePath = projectRoot
          ? relative(projectRoot, candidate.path)
          : candidate.path;

        toInject.push({
          relativePath,
          matchReason,
          summary: buildRuleSummary(body),
          distance: candidate.distance,
        });

        cache.realPaths.add(candidate.realPath);
        cache.contentHashes.add(contentHash);
      } catch {}
    }

    if (toInject.length === 0) return;

    toInject.sort((a, b) => a.distance - b.distance);

    for (const rule of toInject) {
      const summaryLine = rule.summary ? `\nSummary: ${rule.summary}` : "";
      const injection = `

[Pointer Card]
Path: ${rule.relativePath}
Why: Rule matched (${rule.matchReason}).${summaryLine}
Next: Read ${rule.relativePath}
`;
      const decision = contextBudgetArbiter.decide({
        sessionID,
        source: "rules-injector",
        channel: "tool-output",
        id: rule.relativePath,
        priority: "high",
        content: injection,
      });
      if (decision.accepted && hasPointerFields(decision.finalContent)) {
        output.output += decision.finalContent;
        continue;
      }

      const minimalPointer = `
[Pointer]
Path: ${rule.relativePath}
Next: Read ${rule.relativePath}
`;
      const fallbackDecision = contextBudgetArbiter.decide({
        sessionID,
        source: "rules-injector",
        channel: "tool-output",
        id: `${rule.relativePath}:pointer-fallback`,
        priority: "critical",
        content: minimalPointer,
      });
      if (fallbackDecision.accepted && hasPointerFields(fallbackDecision.finalContent)) {
        output.output += fallbackDecision.finalContent;
      } else {
        output.output += minimalPointer;
      }
    }

    saveInjectedRules(sessionID, cache);
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    const toolName = input.tool.toLowerCase();

    if (TRACKED_TOOLS.includes(toolName)) {
      const filePath = getRuleInjectionFilePath(output);
      if (!filePath) return;
      await processFilePathForInjection(filePath, input.sessionID, output);
      return;
    }
  };

  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    output: ToolExecuteBeforeOutput
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
        clearInjectedRules(sessionInfo.id);
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined;
      if (sessionID) {
        sessionCaches.delete(sessionID);
        clearInjectedRules(sessionID);
      }
    }
  };

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
