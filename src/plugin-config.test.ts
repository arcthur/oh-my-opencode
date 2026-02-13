import { describe, expect, it, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CURRENT_CONFIG_VERSION, type OhMyOpenCodeConfig } from "./config";
import { loadConfigFromDirectory, loadPluginConfig, mergeConfigs } from "./plugin-config";

function withVersion(config: Omit<OhMyOpenCodeConfig, "config_version">): OhMyOpenCodeConfig {
  return {
    config_version: CURRENT_CONFIG_VERSION,
    ...config,
  };
}

describe("config loading strictness", () => {
  let tempDir: string | null = null;
  const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
    }
  });

  it("throws when config_version is missing in module config directory", () => {
    tempDir = mkdtempSync(join(tmpdir(), "omo-config-test-"));
    const configDir = join(tempDir, "oh-my-opencode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "agents.json"),
      JSON.stringify({ agents: { oracle: { model: "openai/gpt-5.2" } } }, null, 2),
    );

    expect(() => loadConfigFromDirectory(configDir, {})).toThrow("config_version");
  });

  it("throws when legacy project single-file config exists", () => {
    tempDir = mkdtempSync(join(tmpdir(), "omo-project-config-test-"));
    process.env.OPENCODE_CONFIG_DIR = join(tempDir, "user");
    mkdirSync(process.env.OPENCODE_CONFIG_DIR, { recursive: true });

    const projectRoot = join(tempDir, "project");
    const projectConfigDir = join(projectRoot, ".opencode");
    mkdirSync(projectConfigDir, { recursive: true });
    writeFileSync(
      join(projectConfigDir, "oh-my-opencode.json"),
      JSON.stringify({ config_version: CURRENT_CONFIG_VERSION, agents: { oracle: { model: "openai/gpt-5.2" } } }, null, 2),
    );

    expect(() => loadPluginConfig(projectRoot, {})).toThrow("legacy single-file config");
  });

  it("loads and merges module files from user and project config directories", () => {
    tempDir = mkdtempSync(join(tmpdir(), "omo-modular-config-test-"));
    process.env.OPENCODE_CONFIG_DIR = join(tempDir, "user");

    const userConfigDir = join(process.env.OPENCODE_CONFIG_DIR, "oh-my-opencode");
    mkdirSync(userConfigDir, { recursive: true });
    writeFileSync(
      join(userConfigDir, "00-core.json"),
      JSON.stringify({ config_version: CURRENT_CONFIG_VERSION }, null, 2),
    );
    writeFileSync(
      join(userConfigDir, "10-agents.json"),
      JSON.stringify(
        {
          agents: {
            oracle: { model: "openai/gpt-5.2" },
          },
          categories: {
            quick: { model: "openai/gpt-5.1-codex-mini" },
          },
        },
        null,
        2,
      ),
    );

    const projectConfigDir = join(tempDir, "project", ".opencode", "oh-my-opencode");
    mkdirSync(projectConfigDir, { recursive: true });
    writeFileSync(
      join(projectConfigDir, "00-core.json"),
      JSON.stringify({ config_version: CURRENT_CONFIG_VERSION }, null, 2),
    );
    writeFileSync(
      join(projectConfigDir, "20-overrides.json"),
      JSON.stringify(
        {
          agents: {
            oracle: { temperature: 0.2 },
            explore: { model: "anthropic/claude-haiku-4-5" },
          },
        },
        null,
        2,
      ),
    );

    const config = loadPluginConfig(join(tempDir, "project"), {});

    expect(config.agents?.oracle?.model).toBe("openai/gpt-5.2");
    expect(config.agents?.oracle?.temperature).toBe(0.2);
    expect(config.agents?.explore?.model).toBe("anthropic/claude-haiku-4-5");
    expect(config.categories?.quick?.model).toBe("openai/gpt-5.1-codex-mini");
  });
});

describe("mergeConfigs", () => {
  describe("categories merging", () => {
    // given base config has categories, override has different categories
    // when merging configs
    // then should deep merge categories, not override completely

    it("should deep merge categories from base and override", () => {
      const base = withVersion({
        categories: {
          general: {
            model: "openai/gpt-5.2",
            temperature: 0.5,
          },
          quick: {
            model: "anthropic/claude-haiku-4-5",
          },
        },
      });

      const override = withVersion({
        categories: {
          general: {
            temperature: 0.3,
          },
          visual: {
            model: "google/gemini-3-pro-preview",
          },
        },
      }) as unknown as OhMyOpenCodeConfig;

      const result = mergeConfigs(base, override);

      // then general.model should be preserved from base
      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
      // then general.temperature should be overridden
      expect(result.categories?.general?.temperature).toBe(0.3);
      // then quick should be preserved from base
      expect(result.categories?.quick?.model).toBe("anthropic/claude-haiku-4-5");
      // then visual should be added from override
      expect(result.categories?.visual?.model).toBe("google/gemini-3-pro-preview");
    });

    it("should preserve base categories when override has no categories", () => {
      const base: OhMyOpenCodeConfig = withVersion({
        categories: {
          general: {
            model: "openai/gpt-5.2",
          },
        },
      });

      const override: OhMyOpenCodeConfig = withVersion({});

      const result = mergeConfigs(base, override);

      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
    });

    it("should use override categories when base has no categories", () => {
      const base: OhMyOpenCodeConfig = withVersion({});

      const override: OhMyOpenCodeConfig = withVersion({
        categories: {
          general: {
            model: "openai/gpt-5.2",
          },
        },
      });

      const result = mergeConfigs(base, override);

      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
    });
  });

  describe("existing behavior preservation", () => {
    it("should deep merge agents", () => {
      const base: OhMyOpenCodeConfig = withVersion({
        agents: {
          oracle: { model: "openai/gpt-5.2" },
        },
      });

      const override: OhMyOpenCodeConfig = withVersion({
        agents: {
          oracle: { temperature: 0.5 },
          explore: { model: "anthropic/claude-haiku-4-5" },
        },
      });

      const result = mergeConfigs(base, override);

      expect(result.agents?.oracle?.model).toBe("openai/gpt-5.2");
      expect(result.agents?.oracle?.temperature).toBe(0.5);
      expect(result.agents?.explore?.model).toBe("anthropic/claude-haiku-4-5");
    });

    it("should merge disabled arrays without duplicates", () => {
      const base: OhMyOpenCodeConfig = withVersion({
        disabled_hooks: ["comment-checker", "think-mode"],
      });

      const override: OhMyOpenCodeConfig = withVersion({
        disabled_hooks: ["think-mode", "session-state-repair"],
      });

      const result = mergeConfigs(base, override);

      expect(result.disabled_hooks).toContain("comment-checker");
      expect(result.disabled_hooks).toContain("think-mode");
      expect(result.disabled_hooks).toContain("session-state-repair");
      expect(result.disabled_hooks?.length).toBe(3);
    });
  });
});
