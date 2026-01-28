/**
 * Tool Criticality Registry
 *
 * Manages criticality metadata for tools to determine when
 * user approval is required before execution.
 */

import type { ToolCriticalityMeta, ApprovalPreview } from "./types"
import { existsSync } from "node:fs"

/**
 * Check if a path is a system or sensitive path
 */
function isSystemPath(filePath: string): boolean {
  const systemPatterns = [
    /^\/etc\//,
    /^\/usr\//,
    /^\/bin\//,
    /^\/sbin\//,
    /^\/var\//,
    /^\/root\//,
    /^\/System\//,  // macOS
    /^\/Library\//,  // macOS
    /^\/?\./, // Hidden files/directories at root
  ]
  return systemPatterns.some((p) => p.test(filePath))
}

/**
 * Check if a command is potentially dangerous
 */
function isDangerousCommand(command: string): boolean {
  const dangerousPatterns = [
    /\brm\s+(-[rRfF]+|--force|--recursive)/,  // rm -rf, rm -r, rm -f, rm -R
    /\bsudo\b/,
    />\s*\//, // redirect to root path
    /\bdd\s+/,
    /\bmkfs\b/,
    /\bchmod\s+(777|666|a\+rwx)\b/,
    /\bchown\s+root\b/,
    /\bgit\s+(push\s+--force|reset\s+--hard|clean\s+-fd)/,
    /\bdocker\s+(rm|rmi|prune|system\s+prune)/,
    /\bkubectl\s+delete\b/,
    /\bdropdb\b/,
    /\bdrop\s+database\b/i,
    /\btruncate\s+table\b/i,
  ]
  return dangerousPatterns.some((p) => p.test(command))
}

/**
 * Extract command preview from Bash command
 */
function extractBashPreview(command: string): ApprovalPreview {
  const lines = command.split("\n").filter((l) => l.trim())
  const primaryCommand = lines[0] || command

  // Try to identify affected paths
  const pathMatches = command.match(/(?:\/[\w\-./]+)+/g) || []
  const affectedItems = pathMatches.slice(0, 5).map((p) => ({
    type: "path",
    identifier: p,
    action: "target",
  }))

  return {
    title: "Shell Command Execution",
    description: `Execute: ${primaryCommand.substring(0, 100)}${primaryCommand.length > 100 ? "..." : ""}`,
    affectedItems,
    estimatedImpact: {
      externalCalls: 1,
    },
  }
}

/**
 * Default tool criticality definitions
 */
const DEFAULT_CRITICALITY: Record<string, ToolCriticalityMeta> = {
  Bash: {
    critical: (args: unknown) => {
      const command = (args as { command?: string })?.command ?? ""
      return isDangerousCommand(command)
    },
    reason: "Potentially dangerous shell command",
    category: "irreversible",
    generatePreview: (args: unknown) => {
      const command = (args as { command?: string })?.command ?? ""
      return extractBashPreview(command)
    },
  },

  Write: {
    critical: (args: unknown) => {
      const filePath = (args as { file_path?: string })?.file_path ?? ""
      // Critical if overwriting existing file or system paths
      return isSystemPath(filePath) || existsSync(filePath)
    },
    reason: "Creating or overwriting files",
    category: "destructive",
    generatePreview: (args: unknown) => {
      const filePath = (args as { file_path?: string })?.file_path ?? ""
      const content = (args as { content?: string })?.content ?? ""
      const exists = existsSync(filePath)
      return {
        title: exists ? "Overwrite File" : "Create File",
        description: `Will ${exists ? "overwrite" : "create"}: ${filePath}`,
        affectedItems: [
          {
            type: "file",
            identifier: filePath,
            action: exists ? "overwrite" : "create",
          },
        ],
        estimatedImpact: {
          filesAffected: 1,
          tokensRequired: Math.ceil(content.length / 4),
        },
      }
    },
  },

  Edit: {
    critical: (args: unknown) => {
      const filePath = (args as { file_path?: string })?.file_path ?? ""
      return isSystemPath(filePath)
    },
    reason: "Editing system file",
    category: "destructive",
    generatePreview: (args: unknown) => {
      const filePath = (args as { file_path?: string })?.file_path ?? ""
      const oldString = (args as { old_string?: string })?.old_string ?? ""
      const newString = (args as { new_string?: string })?.new_string ?? ""
      return {
        title: "Edit File",
        description: `Modify: ${filePath}`,
        affectedItems: [
          {
            type: "file",
            identifier: filePath,
            action: "edit",
          },
        ],
        estimatedImpact: {
          filesAffected: 1,
          tokensRequired: Math.ceil((oldString.length + newString.length) / 4),
        },
      }
    },
  },

  Task: {
    critical: (args: unknown) => {
      const prompt = (args as { prompt?: string })?.prompt ?? ""
      const criticalKeywords = ["delete", "remove", "drop", "destroy", "force", "wipe", "purge"]
      const lowerPrompt = prompt.toLowerCase()
      return criticalKeywords.some((k) => lowerPrompt.includes(k))
    },
    reason: "Delegating potentially destructive task",
    category: "external",
    generatePreview: (args: unknown) => {
      const prompt = (args as { prompt?: string })?.prompt ?? ""
      const subagentType = (args as { subagent_type?: string })?.subagent_type ?? "unknown"
      return {
        title: "Delegate Task",
        description: `Spawn ${subagentType} agent: ${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}`,
        affectedItems: [
          {
            type: "agent",
            identifier: subagentType,
            action: "spawn",
          },
        ],
        estimatedImpact: {
          externalCalls: 1,
        },
      }
    },
  },

  delegate_task: {
    critical: (args: unknown) => {
      const prompt = (args as { prompt?: string })?.prompt ?? ""
      const criticalKeywords = ["delete", "remove", "drop", "destroy", "force", "wipe", "purge"]
      const lowerPrompt = prompt.toLowerCase()
      return criticalKeywords.some((k) => lowerPrompt.includes(k))
    },
    reason: "Delegating potentially destructive task",
    category: "external",
    generatePreview: (args: unknown) => {
      const prompt = (args as { prompt?: string })?.prompt ?? ""
      const agent = (args as { agent?: string })?.agent ?? "default"
      return {
        title: "Delegate Task",
        description: `Delegate to ${agent}: ${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}`,
        affectedItems: [
          {
            type: "agent",
            identifier: agent,
            action: "delegate",
          },
        ],
        estimatedImpact: {
          externalCalls: 1,
        },
      }
    },
  },
}

/**
 * Tool Criticality Registry
 *
 * Manages and evaluates tool criticality for approval gate decisions.
 */
export class ToolCriticalityRegistry {
  private registry: Map<string, ToolCriticalityMeta>

  constructor() {
    this.registry = new Map(Object.entries(DEFAULT_CRITICALITY))
  }

  /**
   * Register criticality metadata for a tool
   */
  register(toolName: string, meta: ToolCriticalityMeta): void {
    this.registry.set(toolName, meta)
  }

  /**
   * Unregister a tool
   */
  unregister(toolName: string): boolean {
    return this.registry.delete(toolName)
  }

  /**
   * Get criticality metadata for a tool
   */
  get(toolName: string): ToolCriticalityMeta | undefined {
    return this.registry.get(toolName)
  }

  /**
   * Check if a tool call is critical
   */
  isCritical(toolName: string, args: unknown): boolean {
    const meta = this.registry.get(toolName)
    if (!meta) return false

    if (typeof meta.critical === "function") {
      try {
        return meta.critical(args)
      } catch {
        // If evaluation fails, err on the side of caution
        return true
      }
    }

    return meta.critical
  }

  /**
   * Get preview for a critical tool call
   */
  getPreview(toolName: string, args: unknown): ApprovalPreview | undefined {
    const meta = this.registry.get(toolName)
    if (!meta?.generatePreview) return undefined

    try {
      return meta.generatePreview(args)
    } catch {
      return {
        title: `Approve ${toolName}`,
        description: meta.reason,
        affectedItems: [],
      }
    }
  }

  /**
   * Get reason for a critical tool
   */
  getReason(toolName: string): string | undefined {
    return this.registry.get(toolName)?.reason
  }

  /**
   * Get category for a critical tool
   */
  getCategory(toolName: string): ToolCriticalityMeta["category"] | undefined {
    return this.registry.get(toolName)?.category
  }

  /**
   * List all registered tools
   */
  listTools(): string[] {
    return Array.from(this.registry.keys())
  }

  /**
   * Check if a tool is registered
   */
  has(toolName: string): boolean {
    return this.registry.has(toolName)
  }

  /**
   * Bulk register multiple tools
   */
  registerBulk(tools: Record<string, ToolCriticalityMeta>): void {
    for (const [name, meta] of Object.entries(tools)) {
      this.registry.set(name, meta)
    }
  }

  /**
   * Reset to default criticality definitions
   */
  reset(): void {
    this.registry.clear()
    for (const [name, meta] of Object.entries(DEFAULT_CRITICALITY)) {
      this.registry.set(name, meta)
    }
  }
}

/**
 * Global singleton instance
 */
let globalRegistry: ToolCriticalityRegistry | undefined

/**
 * Get the global tool criticality registry
 */
export function getToolCriticalityRegistry(): ToolCriticalityRegistry {
  if (!globalRegistry) {
    globalRegistry = new ToolCriticalityRegistry()
  }
  return globalRegistry
}

/**
 * Reset the global registry (for testing)
 */
export function resetToolCriticalityRegistry(): void {
  globalRegistry = undefined
}
