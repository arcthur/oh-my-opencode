export interface RepoOverview {
  /** Project name from package.json or directory name */
  name: string
  /** Brief description from package.json or README */
  description?: string
  /** Detected technology stack */
  techStack: string[]
  /** Package manager (npm, yarn, pnpm, bun) */
  packageManager?: string
  /** Key build/dev commands */
  commands: {
    build?: string
    dev?: string
    test?: string
    lint?: string
    start?: string
  }
  /** Core entry points and important files */
  coreFiles: string[]
  /** High-level directory structure */
  structure: string
  /** Detected frameworks */
  frameworks: string[]
  /** Testing framework if detected */
  testFramework?: string
}

export interface RepoOverviewConfig {
  /** Enable repository overview injection (default: true) */
  enabled: boolean
  /** Auto-generate overview on first tool use (default: true) */
  auto_generate: boolean
  /** Max lines for directory tree (default: 50) */
  max_tree_depth: number
  /** Cache duration in ms (default: 1 hour) */
  cache_duration_ms: number
  /**
   * Minimum tool calls before injecting overview (default: 1 = first tool use)
   * Set to 2+ to skip injection for trivial one-shot interactions.
   */
  min_tool_calls: number
}

export interface RepoOverviewCoordinationConfig {
  /**
   * If true, defer overview injection on Read tool calls so codemap-injector
   * owns read-time context and avoids duplicate context blocks.
   */
  suppress_read_injection_when_codemap_enabled: boolean
}

export const DEFAULT_CONFIG: RepoOverviewConfig = {
  enabled: true,
  auto_generate: true,
  max_tree_depth: 50,
  cache_duration_ms: 60 * 60 * 1000, // 1 hour
  min_tool_calls: 1, // Inject on first tool use by default
}

export const DEFAULT_COORDINATION_CONFIG: RepoOverviewCoordinationConfig = {
  suppress_read_injection_when_codemap_enabled: false,
}
