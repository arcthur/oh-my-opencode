import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { createInbox } from "./writer"
import type { InboxMessage } from "./reader"
import { sendMessage } from "./writer"
import { startPolling, waitForMessage, type Disposable, type MessageHandler, type WatcherOptions } from "./watcher"
import type { EnvelopeAuth, ProtocolMessage } from "./types"
import type { MailboxTransport } from "./transport"

export class FsMailboxTransport implements MailboxTransport {
  constructor(private readonly config: Partial<OhMyOpenCodeConfig>) {}

  createInbox(teamName: string, agentId: string): void {
    createInbox(teamName, agentId, this.config)
  }

  sendMessage(
    teamName: string,
    fromAgentId: string,
    toAgentId: string,
    payload: ProtocolMessage,
    options?: { epoch?: number; auth?: EnvelopeAuth }
  ): string {
    return sendMessage(teamName, fromAgentId, toAgentId, payload, this.config, options)
  }

  startPolling(
    teamName: string,
    agentId: string,
    handler: MessageHandler,
    options?: WatcherOptions
  ): Disposable {
    return startPolling(teamName, agentId, handler, this.config, options)
  }

  waitForMessage(
    teamName: string,
    agentId: string,
    messageType: ProtocolMessage["type"],
    timeoutMs?: number
  ): Promise<InboxMessage> {
    return waitForMessage(teamName, agentId, messageType, this.config, timeoutMs)
  }
}

export function createFsMailboxTransport(
  config: Partial<OhMyOpenCodeConfig>
): MailboxTransport {
  return new FsMailboxTransport(config)
}
