# Kiro CLI V3 (Experimental)

> ⚠️ **Experimental** — Kiro CLI V3 is an early release and not yet stable. For everyday use, we recommend the stable V2 setup in [Kiro as an Agent](./agents-kiro.md). This page is for users who want to try V3 early. V3 runs alongside your existing 2.x install, so your current setup stays unchanged until you opt in.

## What's new in V3

V3 is built on the same unified agent harness as Kiro IDE and Kiro Web. Highlights:

- **Spec-driven development** — define requirements, generate designs, and execute task plans in the terminal.
- **Plan mode** — explore the codebase and produce a step-by-step plan before making changes.
- **Capability-based permissions** — fine-grained, auditable control via `permissions.yaml`.
- **Enhanced hooks** — standalone `.kiro/hooks/*.json` files with new triggers and a versioned schema.
- **Shared `.kiro` config** — Steering, Hooks, and Skills can travel between Kiro IDE / Web / CLI.

## Configuring the V3 Agent in Fello

The configuration is the same as the stable setup, except the **Args** field — V3 requires explicit engine and authentication flags:

| Field | Example Value | Description |
|------|-------|------|
| **ID** | `kiro-v3` | Unique identifier; a separate ID lets you keep the stable Kiro agent too |
| **Command** | `kiro-cli` | The executable command (must be in your system PATH) |
| **Args** | `acp --agent-engine=v3 --auth-method=cli` | Starts the ACP service on the V3 engine, with the CLI's own login handling authentication |

### V3 launch flags

| Flag | Purpose |
|------|------|
| `acp` | Starts the ACP protocol service (NDJSON over stdio) |
| `--agent-engine=v3` | Uses the V3 unified agent harness |
| `--auth-method=cli` | Authenticates via the CLI login (recommended for Fello, so Fello doesn't manage tokens) |

> 💡 V3 no longer accepts the 2.x launch flags `--agent`, `--model`, `--effort`, `--trust-all-tools`, or `--trust-tools`. Model, mode, and permissions are selected within the session or handled by Kiro's permission flow.

## How It Works

Fello launches `kiro-cli acp --agent-engine=v3 --auth-method=cli` as a subprocess and talks to it over stdio using NDJSON. V3 shares the same unified harness as Kiro IDE / Web, so supported `.kiro` configuration can travel between surfaces. All data is processed locally.

## Common Issues

| Issue | Solution |
|------|---------|
| `command not found: kiro-cli` | Make sure Kiro CLI is installed and in your system PATH, then restart Fello and try again |
| No response after startup | Run `kiro-cli acp --agent-engine=v3 --auth-method=cli` in a terminal to check whether it starts properly, and look for any authentication issues |
| Authentication expired | Run `kiro-cli auth login` in a terminal to re-authorize |
| Session issues or instability | V3 is still early. The V3 session store is not backward-compatible with 2.x — to return to a stable setup, switch Args back to `acp`. In V3 you can upgrade custom agent configs with `/upgrade-agent` |

---

> 📖 [What's new in V3](https://kiro.dev/docs/cli/v3/) · [ACP client migration](https://kiro.dev/docs/cli/v3/acp-migration/) · [Back to Kiro as an Agent](./agents-kiro.md)
