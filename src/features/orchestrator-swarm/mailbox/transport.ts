import type { OhMyOpenCodeConfig } from "../../../config/schema"
import type { EnvelopeAuth, ProtocolMessage } from "./types"
import type { InboxMessage } from "./reader"
import type { Disposable, MessageHandler, WatcherOptions } from "./watcher"

export interface MailboxTransport {
  createInbox(teamName: string, agentId: string): void
  sendMessage(
    teamName: string,
    fromAgentId: string,
    toAgentId: string,
    payload: ProtocolMessage,
    options?: { epoch?: number; auth?: EnvelopeAuth }
  ): string
  startPolling(
    teamName: string,
    agentId: string,
    handler: MessageHandler,
    options?: WatcherOptions
  ): Disposable
  waitForMessage(
    teamName: string,
    agentId: string,
    messageType: ProtocolMessage["type"],
    timeoutMs?: number
  ): Promise<InboxMessage>
}

export interface MailboxTransportFactoryOptions {
  config: Partial<OhMyOpenCodeConfig>
}
