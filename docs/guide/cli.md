# CLI Guide

This document covers the Oh-My-OpenCode CLI surface implemented in `src/cli/index.ts`.

## 1. Overview

```bash
# Show help
bunx oh-my-opencode

# Alternative runtime
npx oh-my-opencode
```

## 2. Available Commands

| Command | Description |
|---------|-------------|
| `install` | Interactive/non-interactive setup wizard |
| `run <message>` | Run OpenCode and wait for todo/background completion |
| `get-local-version` | Show installed version and check npm latest |
| `doctor` | Environment diagnostics and health checks |
| `mcp oauth ...` | OAuth token management for MCP servers |
| `version` | Print package version |

## 3. `install`

Interactive setup:

```bash
bunx oh-my-opencode install
```

Non-interactive mode:

```bash
bunx oh-my-opencode install --no-tui \
  --claude=<no|yes|max20> \
  --gemini=<no|yes> \
  --copilot=<no|yes> \
  [--openai=<no|yes>] \
  [--opencode-zen=<no|yes>] \
  [--zai-coding-plan=<no|yes>] \
  [--kimi-for-coding=<no|yes>] \
  [--skip-auth]
```

Notes:
- In `--no-tui` mode, `--claude`, `--gemini`, and `--copilot` are required.
- `--skip-auth` skips post-install auth hints only; it does not disable providers.

## 4. `run <message>`

Run a session and keep polling until:
- all todos are completed/cancelled, and
- child/background sessions become idle.

```bash
bunx oh-my-opencode run "Fix the bug in index.ts"
```

Options:

| Option | Description |
|--------|-------------|
| `-a, --agent <name>` | Agent override (`Sisyphus`, `Hephaestus`, `Prometheus`, etc.) |
| `-d, --directory <path>` | Working directory for the prompt call |
| `-t, --timeout <ms>` | Timeout in milliseconds (`0` or omitted means no timeout in runner) |

## 5. `get-local-version`

```bash
bunx oh-my-opencode get-local-version
bunx oh-my-opencode get-local-version --json
bunx oh-my-opencode get-local-version --directory /path/to/project
```

Options:

| Option | Description |
|--------|-------------|
| `-d, --directory <path>` | Working directory used for config context |
| `--json` | JSON output for scripting |

## 6. `doctor`

```bash
bunx oh-my-opencode doctor
bunx oh-my-opencode doctor --verbose
bunx oh-my-opencode doctor --json
bunx oh-my-opencode doctor --category authentication
```

Options:

| Option | Description |
|--------|-------------|
| `--verbose` | Show detailed diagnostics |
| `--json` | Emit machine-readable result |
| `--category <category>` | Run a single category |

Categories:
- `installation`
- `configuration`
- `authentication`
- `dependencies`
- `tools`
- `updates`

## 7. `mcp oauth`

OAuth management for remote MCP servers.

```bash
# Login
bunx oh-my-opencode mcp oauth login <server-name> --server-url https://api.example.com

# Login with explicit client ID/scopes
bunx oh-my-opencode mcp oauth login my-api --server-url https://api.example.com --client-id my-client --scopes read write

# Logout (current implementation requires --server-url)
bunx oh-my-opencode mcp oauth logout <server-name> --server-url https://api.example.com

# Status (all servers or one server)
bunx oh-my-opencode mcp oauth status
bunx oh-my-opencode mcp oauth status <server-name>
```

Common options:

| Option | Description |
|--------|-------------|
| `--server-url <url>` | OAuth server URL (required for login; effectively required for logout in current implementation) |
| `--client-id <id>` | OAuth client ID (optional if DCR is supported) |
| `--scopes <scopes...>` | OAuth scopes |

Token storage: `~/.config/opencode/mcp-oauth.json` (permission `0600`).

## 8. Configuration Files

Config lookup priority:
1. `.opencode/oh-my-opencode.json` (or `.jsonc`)
2. `~/.config/opencode/oh-my-opencode.json` (or `.jsonc`)

JSONC is supported (comments + trailing commas).

## 9. `version`

```bash
bunx oh-my-opencode version
```

Prints `oh-my-opencode v<version>`.

## 10. Troubleshooting

```bash
# Re-run setup
bunx oh-my-opencode install

# Diagnose
bunx oh-my-opencode doctor --verbose

# Narrow down by category
bunx oh-my-opencode doctor --category configuration
```
