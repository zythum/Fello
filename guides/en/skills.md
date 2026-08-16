# Skills

> 🎯 **Skills** is Fello's Agent skill extension system. By installing Skills, Agents gain specialized capabilities in specific domains — no modification to the Agent itself, plug and play.

## What Are Skills

Skills are a set of predefined instructions and auxiliary files. The Agent queries and activates them through MCP tools to obtain the expertise needed to perform specific tasks.

- 📦 **Plug and play** — After installation, the Agent automatically discovers available skills and activates them on demand
- 🌍 **Community marketplace** — Browse and install community-contributed skills from the skills.sh marketplace

---

## Skill Scopes

| Level | Storage Location | Use Case |
|------|---------|---------|
| **Project** | `.fello/skills/` (in the project root) | Dedicated skills that only take effect for the current project |
| **User** | `~/.fello/skills/`, `~/.agents/skills/`, `~/.claude/skills/` | General skills shared across all projects |

> 💡 **Compatibility:** Fello also scans the `~/.agents/skills/` and `~/.claude/skills/` directories, and is compatible with the Skills format of other AI tools.

---

## Browsing and Installing Skills

### Install from the Built-in Marketplace

1. Open the **Skills** panel in Fello
2. Browse the available skills in the skills.sh marketplace
3. Click **Install** to install at the user or project level

### Install via the skills Tool

Visit https://skills.sh to find the skills you want.

Install them in the terminal with the `npx skills` command-line tool:

```bash
npx skills add <owner/repo>          # Install at the user level (global)
npx skills add <owner/repo> --local  # Install at the project level
```

### Manual Installation

```bash
# User-level installation
cp -r my-skill ~/.fello/skills/

# Project-level installation
cp -r my-skill .fello/skills/
```

---

## How Agents Use Skills

Skills are exposed to the Agent through the MCP protocol. The Agent automatically completes the following flow during a conversation:

1. **list_skills** — Query the full list of currently available skills and their descriptions
2. **activate_skill** — Activate the matching skill based on the need, loading its full instructions and auxiliary files
3. Follow the skill instructions to execute the operation and fulfill the user's request

> ✨ **Smart matching:** The Agent automatically decides whether to activate a skill based on the content of your request. For example, when you ask to work with Feishu documents, the Agent automatically activates the `lark-doc` Skill; when you mention schedule management, it automatically activates the `lark-calendar` Skill.

> 💡 **Manually specify a Skill:** Type `@` in the input box to manually specify a Skill to use; the Agent will prioritize that Skill when responding to your request.


---

## Enabling/Disabling Skills

Skills are a session-level toggle that can be controlled at two points:

- 🆕 **When creating a session** — Toggle the "Skills" option in the Features area of the new session dialog
- ⚙️ **During a session** — Click the ⚙️ settings button at the top, toggle the "Skills" switch, then restart the session

---

## Skill Structure

Each Skill is a directory containing:

| File | Description |
|------|------|
| `SKILL.md` | The Skill's main instruction file, read when the Agent activates it |
| `references/` | Auxiliary reference files directory (optional) |
| `package.json` | Skill metadata (name, description, version, etc.) |

> 💡 **Learn more:** To create your own Skill, refer to the [skills.sh](https://skills.sh) development documentation.

---

## 📖 Related Docs

| Doc | Related info |
|------|---------|
| ← [Quick Start](./quick-start.md) | Coming from here: getting started with Skills |
| → [MCP Server Configuration](./mcp-servers.md) | MCP and Skills are both ways to extend Agents and complement each other |
