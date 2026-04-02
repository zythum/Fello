# Fello 项目简介

Fello 是一个基于 ACP（Agent Client Protocol）的桌面端 AI 对话客户端，当前运行在 Electron + Node.js 上，通过 `kiro-cli acp` 连接 Kiro Agent，提供完整的对话、工具调用、权限管理和文件浏览功能。

## 核心功能

- 多会话管理：创建、切换、删除、恢复（session/load）会话
- 流式对话：实时显示 agent 回复、thinking 过程、tool 调用
- 权限管理：agent 请求权限时弹出对话框，支持并发权限请求
- 模型选择：从 agent 获取可用模型列表，支持运行时切换
- 工作空间文件树：浏览、创建、删除、重命名、拖拽移动文件
- 数据持久化：本地仅保存 session 元数据，历史事件由 ACP server 负责重放
- Token 用量显示：实时展示 session 的 token 消耗

## 运行环境

- 运行时：Node.js
- 桌面端框架：Electron
- 开发构建：electron-vite（renderer 基于 Vite）
- ACP Server：`kiro-cli acp`（需预先安装）
- 数据目录：`~/.fello/sessions/`
