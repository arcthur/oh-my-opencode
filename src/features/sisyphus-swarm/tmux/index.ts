/**
 * Sisyphus Swarm tmux Integration
 *
 * Manages tmux windows and git worktrees for Swarm agents.
 */

import {
  closeSwarmWindowsByTeam as closeSwarmWindowsByTeamImpl,
  inspectSwarmWindowsByTeam as inspectSwarmWindowsByTeamImpl,
} from "./utils"

// Utils
export {
  isInsideTmux,
  hasTmuxBinary,
  isGitRepo,
  getCurrentSession,
  getCurrentWindow,
  slugify,
  STATUS_PATTERNS,
  detectStatus,
  capturePaneContent,
  sendKeys,
  createTmuxWindow,
  closeTmuxWindow,
  renameTmuxWindow,
  setWindowOption,
  getTmuxWindowOption,
  listTmuxWindows,
  createGitWorktree,
  removeGitWorktree,
  runInNewWindow,
  getOpenCodeSwarmCommand,
  // Swarm environment detection
  SWARM_ENV,
  getSwarmEnvContext,
  isSwarmAgent,
} from "./utils"

// Avoid live re-exports for these to keep Bun module mocks from patching ./utils exports.
export const inspectSwarmWindowsByTeam = inspectSwarmWindowsByTeamImpl
export const closeSwarmWindowsByTeam = closeSwarmWindowsByTeamImpl

// Orchestrator
export {
  type SwarmWindowInfo,
  type SwarmOrchestratorConfig,
  SwarmOrchestrator,
  createSwarmOrchestrator,
} from "./orchestrator"
