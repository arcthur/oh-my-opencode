/**
 * Sisyphus Swarm tmux Integration
 *
 * Manages tmux windows and git worktrees for Swarm agents.
 */

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

// Orchestrator
export {
  type SwarmWindowInfo,
  type SwarmOrchestratorConfig,
  SwarmOrchestrator,
  createSwarmOrchestrator,
} from "./orchestrator"
