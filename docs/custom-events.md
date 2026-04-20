# 前端自定义事件通信 (Custom Events)

在 Fello 的前端（Renderer）架构中，除了使用 Zustand 管理全局和会话状态、使用 IPC 与主进程通信之外，为了在不相干的组件树（例如侧边栏文件树、聊天输入框、聊天内容区、文件预览抽屉）之间进行轻量级的解耦通信，我们引入了原生的 DOM `CustomEvent` 机制。

所有自定义事件统一以 `fello-` 为前缀，并在 `document` 对象上进行分发和监听。

以下是目前系统中定义和使用的自定义事件清单：

## 1. `fello-preview-file`

- **用途**：请求在侧边（或覆盖层）的文件预览面板（`FilePreviewSheet`）中打开并预览指定的代码或图片文件。
- **Payload (`detail`)**：
  ```ts
  {
    projectId: string;
    relativePath: string;
  }
  ```
- **分发方 (Dispatchers)**：
  - `file-panel.tsx`：双击文件树节点，或者在 Git 变更列表（Summary）中点击文件时触发。
  - `tool-bubble.tsx`：在 Tool Call 气泡的 `summary` 区域中，点击 `locations` 标签按钮时触发。
- **监听方 (Listeners)**：
  - `session-view.tsx`：统一捕获事件，更新内部状态 `previewFile` 并打开 `FilePreviewSheet` 组件。

## 2. `fello-add-to-chat`

- **用途**：将用户选中的文件、文件夹或者代码行片段作为提及（Mentions）快速追加到聊天输入框（`chat-input`）中。
- **Payload (`detail`)**：
  ```ts
  Array<{
    id: string;       // 文件的相对路径，如果包含行号可能是 "path/to/file.ts:L12-L25"
    name: string;     // 显示的短名称（如 "file.ts"）
    isFolder: boolean;
  }>
  ```
- **分发方 (Dispatchers)**：
  - `file-panel.tsx`：文件树右键菜单点击 "Add to Chat" 时触发（支持多选）。
  - `file-preview.tsx`：在文件代码预览区域选中具体文本/代码行后，右键菜单点击 "Add to Chat" 时触发。
- **监听方 (Listeners)**：
  - `chat-input.tsx`：收到事件后，将其转换为 react-mentions 支持的格式 `@[name](id)`，追加到输入框末尾并自动聚焦。

## 3. `fello-scroll-to-bottom`

- **用途**：强制聊天内容区（`chat-area`）向下滚动到底部。
- **Payload (`detail`)**：无（`null` / `undefined`）。
- **分发方 (Dispatchers)**：
  - `chat-input.tsx`：用户按下回车提交新消息后，为了确保发送的新消息（Optimistic Update）能立即出现在视野中，忽略当前的滚动防抖拦截，直接强制滚动到底部。
- **监听方 (Listeners)**：
  - `chat-area.tsx`：捕获事件后，直接调用底部的 `scrollIntoView({ behavior: "smooth" })` 方法。

## 规范与建议

1. **命名规范**：新增的全局 DOM 自定义事件必须以 `fello-` 作为前缀。
2. **适用场景**：仅在组件层级相隔极远（例如兄弟树）、且不涉及核心业务数据流修改的纯 UI 交互行为（如：聚焦、滚动、打开浮层、追加文本）时使用。核心的业务状态（如：消息收发、Token 消耗、工具状态）必须严格走 Zustand Store (`useAppStore`)，严禁通过事件总线进行数据同步。
3. **清理机制**：在 `useEffect` 中注册 `document.addEventListener` 时，务必在清理函数中调用 `document.removeEventListener`，防止内存泄漏或事件重复触发。
