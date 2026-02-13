# Installation

This guide explains how to install the Oh-My-OpenCode plugin for OpenCode and validate that the environment is correctly configured.

## Prerequisites

- OpenCode version: **>= 1.1.1** (minimum supported by this plugin; relies on the OpenCode permission system)
- Runtime for the installer:
  - Recommended: Bun (`bunx`)
  - Alternative: Node.js (`npx`)
- Optional provider access:
  - Anthropic (Claude)
  - OpenAI (ChatGPT)
  - Google (Gemini, typically via Antigravity OAuth)
  - GitHub Copilot

## Installation Flow

```mermaid
flowchart TD
  A["Select providers and capabilities"] --> B["Run installer (interactive or --no-tui)"]
  B --> C["Authenticate providers"]
  C --> D["Run diagnostics (doctor)"]
  D --> E["Start a session (opencode)"]
```

## Install the Plugin

### Interactive installer (recommended)

```bash
bunx oh-my-opencode install
```

### Non-interactive installer (CI / scripting)

```bash
bunx oh-my-opencode install --no-tui \
  --claude=<yes|no|max20> \
  --openai=<yes|no> \
  --gemini=<yes|no> \
  --copilot=<yes|no> \
  [--opencode-zen=<yes|no>] \
  [--zai-coding-plan=<yes|no>] \
  [--kimi-for-coding=<yes|no>] \
  [--skip-auth]
```

Examples:

```bash
# Claude + OpenAI
bunx oh-my-opencode install --no-tui --claude=yes --openai=yes --gemini=no --copilot=no

# Copilot only
bunx oh-my-opencode install --no-tui --claude=no --openai=no --gemini=no --copilot=yes
```

## Authenticate Providers

Use OpenCode auth flow for provider login:

```bash
opencode auth login
```

Notes:
- Oh-My-OpenCode CLI does **not** expose an `auth` subcommand.
- MCP OAuth tokens (for OAuth-protected MCP endpoints) are managed separately via:
  - `bunx oh-my-opencode mcp oauth login ...`
  - `bunx oh-my-opencode mcp oauth logout ...`
  - `bunx oh-my-opencode mcp oauth status ...`

### Google Gemini (Antigravity OAuth)

For Gemini, installer can add auth plugins and provider config, but account login still goes through:

```bash
opencode auth login
```

## Verify the Setup

Run the doctor checks:

```bash
bunx oh-my-opencode doctor
```

Common validations include:

- OpenCode version check
- Plugin registration in OpenCode config
- Configuration file validity (JSON/JSONC)
- Provider authentication presence

## Config Version Policy

- This project supports the **latest config format only**.
- Modular config files in `oh-my-opencode/` are merged; at least one module MUST define `"config_version": 1`.
- If an existing config file is invalid or uses a different version, startup/install will fail fast instead of silently falling back.

## Next Steps

- Overview: `docs/guide/overview.md`
- Orchestration system: `docs/guide/understanding-orchestration-system.md`
- CLI reference: `docs/guide/cli.md`
- Documentation index: `docs/index.md`
