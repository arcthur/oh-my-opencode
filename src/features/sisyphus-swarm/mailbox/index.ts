/**
 * Sisyphus Swarm Mailbox
 *
 * File-based message passing between Swarm agents.
 *
 * @example
 * ```typescript
 * import { sendMessage, startPolling, ProtocolMessage } from "./mailbox"
 *
 * // Send a task assignment
 * sendMessage(teamName, myAgentId, workerAgentId, {
 *   type: "task_assignment",
 *   taskId: "task_001",
 *   title: "Implement feature X",
 *   description: "...",
 *   assignedBy: myAgentId,
 *   timestamp: Date.now(),
 * }, config)
 *
 * // Poll for messages
 * const watcher = startPolling(teamName, myAgentId, async (message) => {
 *   console.log("Received:", message.payload.type)
 *   // Handle message...
 * }, config)
 *
 * // Later: stop polling
 * watcher.dispose()
 * ```
 */

// Types
export {
  // Protocol message types
  ProtocolMessageSchema,
  type ProtocolMessage,

  // Individual message schemas
  MailboxMessageSchema,
  type MailboxMessage,
  PermissionRequestSchema,
  type PermissionRequest,
  PermissionResponseSchema,
  type PermissionResponse,
  ShutdownRequestSchema,
  type ShutdownRequest,
  ShutdownApprovedSchema,
  type ShutdownApproved,
  ShutdownRejectedSchema,
  type ShutdownRejected,
  TaskAssignmentSchema,
  type TaskAssignment,
  TaskCompletedSchema,
  type TaskCompleted,
  TaskRejectedSchema,
  type TaskRejected,
  IdleNotificationSchema,
  type IdleNotification,
  JoinRequestSchema,
  type JoinRequest,
  JoinApprovedSchema,
  type JoinApproved,
  JoinRejectedSchema,
  type JoinRejected,

  // Plan Approval
  PlanApprovalRequestSchema,
  type PlanApprovalRequest,
  PlanApprovalResponseSchema,
  type PlanApprovalResponse,

  // Mode Control
  PermissionModeSchema,
  type PermissionMode,
  ModeSetRequestSchema,
  type ModeSetRequest,
  ModeSetResponseSchema,
  type ModeSetResponse,
} from "./types"

// Reader
export {
  // Inbox types
  InboxMessageSchema,
  type InboxMessage,
  InboxMetaSchema,
  type InboxMeta,
  InboxSchema,
  type Inbox,

  // Read functions
  readInboxMeta,
  readInboxRaw,
  readInbox,
  readUnread,
  readByType,
  readUnreadByType,
  getLastReadTimestamp,
  hasUnread,
  countUnread,
  findMessage,
} from "./reader"

// Writer
export {
  getInboxDir,
  generateMessageId,
  createInbox,
  ensureInbox,
  sendMessage,
  broadcast,
  markAsRead,
  markAllAsRead,
  deleteMessages,
  clearInbox,
  pruneOldMessages,
} from "./writer"

// Watcher
export {
  type Disposable,
  type MessageHandler,
  type ErrorHandler,
  type WatcherOptions,
  startPolling,
  startWatching,
  waitForMessage,
  MessageQueue,
} from "./watcher"
