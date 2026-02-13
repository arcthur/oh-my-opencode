import * as fs from "fs";
import * as path from "path";
import {
  CURRENT_CONFIG_VERSION,
  type OhMyOpenCodeConfig,
  validateStrictOhMyOpenCodeConfig,
} from "./config";
import {
  log,
  deepMerge,
  getOpenCodeConfigDir,
  addConfigLoadError,
  parseJsonc,
  detectConfigFile,
} from "./shared";

function assertNoLegacySingleFileConfig(basePath: string): void {
  const detected = detectConfigFile(basePath);
  if (detected.format === "none") {
    return;
  }

  throw new Error(
    `Detected legacy single-file config at ${detected.path}. ` +
      `This build only supports modular config directories at ${basePath}/`,
  );
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadConfigFromDirectory(
  configDirPath: string,
  ctx: unknown
): OhMyOpenCodeConfig | null {
  if (!fs.existsSync(configDirPath)) {
    return null;
  }

  try {
    const stat = fs.statSync(configDirPath);
    if (!stat.isDirectory()) {
      throw new Error(`Expected config directory, but found file: ${configDirPath}`);
    }

    const moduleFiles = fs
      .readdirSync(configDirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".jsonc")))
      .map((entry) => entry.name)
      .sort();

    if (moduleFiles.length === 0) {
      throw new Error(`No config module files found in ${configDirPath}`);
    }

    let mergedRawConfig: Record<string, unknown> = {};
    for (const moduleFile of moduleFiles) {
      const modulePath = path.join(configDirPath, moduleFile);
      const moduleContent = fs.readFileSync(modulePath, "utf-8");
      const rawModule = parseJsonc<unknown>(moduleContent);
      if (!isConfigObject(rawModule)) {
        throw new Error(`Config module root must be a JSON object: ${modulePath}`);
      }
      mergedRawConfig = deepMerge(mergedRawConfig, rawModule) ?? mergedRawConfig;
    }

    const result = validateStrictOhMyOpenCodeConfig(mergedRawConfig);

    if (!result.success) {
      const errorMsg = result.errors.join(", ");
      log(`Config validation error in ${configDirPath}:`, result.errors);
      throw new Error(`Invalid config ${configDirPath}: ${errorMsg}`);
    }

    log(`Config loaded from ${configDirPath}`, {
      agents: result.data.agents,
      module_files: moduleFiles,
    });
    return result.data;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Error loading config from ${configDirPath}:`, err);
    addConfigLoadError({ path: configDirPath, error: errorMsg });
    throw new Error(`Failed to load config ${configDirPath}: ${errorMsg}`);
  }
}

export function mergeConfigs(
  base: OhMyOpenCodeConfig,
  override: OhMyOpenCodeConfig
): OhMyOpenCodeConfig {
  return {
    ...base,
    ...override,
    agents: deepMerge(base.agents, override.agents),
    categories: deepMerge(base.categories, override.categories),
    disabled_agents: [
      ...new Set([
        ...(base.disabled_agents ?? []),
        ...(override.disabled_agents ?? []),
      ]),
    ],
    disabled_mcps: [
      ...new Set([
        ...(base.disabled_mcps ?? []),
        ...(override.disabled_mcps ?? []),
      ]),
    ],
    disabled_hooks: [
      ...new Set([
        ...(base.disabled_hooks ?? []),
        ...(override.disabled_hooks ?? []),
      ]),
    ],
    disabled_commands: [
      ...new Set([
        ...(base.disabled_commands ?? []),
        ...(override.disabled_commands ?? []),
      ]),
    ],
    disabled_skills: [
      ...new Set([
        ...(base.disabled_skills ?? []),
        ...(override.disabled_skills ?? []),
      ]),
    ],
    claude_code: deepMerge(base.claude_code, override.claude_code),
  };
}

export function loadPluginConfig(
  directory: string,
  ctx: unknown
): OhMyOpenCodeConfig {
  // Modular config directories only (legacy single-file configs are rejected).
  const configDir = getOpenCodeConfigDir({ binary: "opencode" });
  const userConfigDirPath = path.join(configDir, "oh-my-opencode");

  const projectConfigDirPath = path.join(directory, ".opencode", "oh-my-opencode");

  assertNoLegacySingleFileConfig(userConfigDirPath);
  assertNoLegacySingleFileConfig(projectConfigDirPath);

  // Load user config first (base)
  let config: OhMyOpenCodeConfig =
    loadConfigFromDirectory(userConfigDirPath, ctx) ?? { config_version: CURRENT_CONFIG_VERSION };

  // Override with project config
  const projectConfig = loadConfigFromDirectory(projectConfigDirPath, ctx);
  if (projectConfig) {
    config = mergeConfigs(config, projectConfig);
  }

  log("Final merged config", {
    agents: config.agents,
    disabled_agents: config.disabled_agents,
    disabled_mcps: config.disabled_mcps,
    disabled_hooks: config.disabled_hooks,
    claude_code: config.claude_code,
  });
  return config;
}
