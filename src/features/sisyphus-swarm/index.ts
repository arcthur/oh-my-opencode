/**
 * Sisyphus Swarm - Multi-Agent Coordination System
 *
 * Enables multiple independent Claude Code agents to coordinate
 * via file-based mailbox protocol.
 *
 * Architecture:
 * ```
 * ┌─────────┐     ┌─────────┐     ┌─────────┐
 * │ Agent A │     │ Agent B │     │ Agent C │
 * └────┬────┘     └────┬────┘     └────┬────┘
 *      │               │               │
 *      └───────────────┴───────────────┘
 *                      ▼
 *         .sisyphus/teams/{team}/inboxes/
 * ```
 *
 * @see docs/journeys/swarm-coordination.md for end-to-end usage
 * @see src/features/sisyphus-swarm/ARCHITECTURE.md for implementation-level architecture notes
 *
 * @example
 * ```typescript
 * import {
 *   createCoordinator,
 *   createWorker,
 *   createSwarmTask,
 * } from "./features/sisyphus-swarm"
 *
 * // Start coordinator
 * const coordinator = await createCoordinator({
 *   teamName: "my-team",
 *   name: "coordinator",
 *   sessionId: "sess_123",
 * }, config)
 *
 * // Add tasks
 * coordinator.addTask({
 *   title: "Implement feature X",
 *   description: "...",
 * })
 *
 * // Start workers (in separate processes/terminals)
 * const worker = await createWorker({
 *   teamName: "my-team",
 *   name: "worker-1",
 *   sessionId: "sess_456",
 *   onTask: async (task) => {
 *     // Execute task...
 *     return { success: true }
 *   },
 * }, config)
 * ```
 */

// Feature metadata
export const SWARM_VERSION = "0.4.0"
export const SWARM_STORAGE_PATH = ".sisyphus/teams"

// Re-export mailbox module
export * from "./mailbox"

// Re-export team module
export * from "./team"

// Re-export task graph module
export * from "./task-graph"

// Re-export agent module
export * from "./agent"

// Re-export tmux module
export * from "./tmux"

// Re-export sync module
export * from "./sync"

// Re-export runtime module
export * from "./runtime"
