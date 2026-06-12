# Skills 技能

> 🎯 **Skills** 是 Fello 的 Agent 技能扩展系统。通过安装 Skills，Agent 可以获得特定领域的专业能力——无需修改 Agent 本身，即插即用。


## 什么是 Skills

Skills 是一组预定义的指令和辅助文件，Agent 通过 MCP 工具查询和激活这些技能，获取执行特定任务的专业知识。

- 📦 **即插即用** — 安装后 Agent 自动发现可用技能，按需激活
- 🌍 **社区市场** — 从 skills.sh 市场浏览和安装社区贡献的技能

---

## Skills 作用域

| 级别 | 存储位置 | 适用场景 |
|------|---------|---------|
| **项目级** | `.fello/skills/`（项目根目录下） | 仅对当前项目生效的专属技能 |
| **用户级** | `~/.fello/skills/`、`~/.agents/skills/`、`~/.claude/skills/` | 所有项目共享的通用技能 |

> 💡 **兼容性：** Fello 同时扫描 `~/.agents/skills/` 和 `~/.claude/skills/` 目录，与其他 AI 工具的 Skills 格式兼容。

---

## 浏览和安装 Skills

### 从内置市场安装

1. 在 Fello 中打开 **Skills** 面板
2. 浏览 skills.sh 市场中的可用技能
3. 点击 **Install** 安装到用户级或项目级

### 通过 skills 工具安装

访问 https://www.skills.sh/ 可以查询想要的 skills。

在终端中通过 `npx skills` 命令行工具安装：

```bash
npx skills add <owner/repo>          # 安装到用户级（全局）
npx skills add <owner/repo> --local  # 安装到项目级
```

### 手动安装

```bash
# 用户级安装
cp -r my-skill ~/.agents/skills/

# 项目级安装
cp -r my-skill .agents/skills/
```

---

## Agent 如何使用 Skills

Skills 通过 MCP 协议暴露给 Agent。Agent 在对话中自动完成以下流程：

1. **list_skills** — 查询当前可用的全部技能列表及其描述
2. **activate_skill** — 根据需求激活对应技能，加载其完整指令和辅助文件
3. 按照技能指令执行操作，完成用户请求

> ✨ **智能匹配：** Agent 会根据用户请求的内容自动判断是否需要激活某个技能。例如，当你要求操作飞书文档时，Agent 会自动激活 `lark-doc` Skill；当你提到日程管理时，会自动激活 `lark-calendar` Skill。

> 💡 **手动指定 Skill：** 在输入框中输入 `@` 可以手动指定使用某个 Skill，Agent 会优先使用该技能来响应你的请求。


---

## 启用/禁用 Skills 功能

Skills 是会话级的功能开关，可以在两个时机控制：

- 🆕 **创建会话时** — 在新建会话对话框的 Features 区域，开关「技能」选项
- ⚙️ **会话进行中** — 点击顶部 ⚙️ 设置按钮，切换「技能」开关后重启会话

---

## Skill 的结构

每个 Skill 是一个目录，包含：

| 文件 | 说明 |
|------|------|
| `SKILL.md` | 技能的主指令文件，Agent 激活时读取 |
| `references/` | 辅助参考文件目录（可选） |
| `package.json` | 技能元数据（名称、描述、版本等） |

> 💡 **了解更多：** 如果你想创建自己的 Skill，请参考 [skills.sh](https://skills.sh) 的开发文档。

---

## 📖 相关文档

| 文档 | 关联说明 |
|------|---------|
| ← [快速开始](./quick-start.md) | 从这里来：Skills 入门 |
| → [MCP 服务器配置](./mcp-servers.md) | MCP 和 Skills 都是扩展 Agent 的方式，互为补充 |
