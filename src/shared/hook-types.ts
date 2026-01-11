/**
 * Shared type definitions for hook implementations
 */

export interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
}

export interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
}

export interface EventInput {
  event: {
    type: string
    properties?: unknown
  }
}

export interface MessageInput {
  sessionID: string
  message: {
    role: string
    content: string
  }
}
