# File Workspace & Terminal

> 📁 **Fello's right-side panel** integrates the File Workspace and Terminal, letting you browse code, preview files, and run commands while chatting with AI — no need to switch windows.

## Panel Layout

The Fello interface is divided into four areas from left to right:

| **Sidebar** | **Chat** | **Detail** | **Panel** |
|-------------|----------|-----------|-----------|
| Project list and session navigation | AI chat interface | File preview / fullscreen Terminal / Diff view | Files file tree / Terminal list |
| *Collapsible* | *Always visible* | *Expanded on demand, closable* | *Fixed width, tab switching* |

> 🔗 **Linkage logic:** Click a file in the Files panel on the right → the file preview detail opens on the left; click a terminal in the Terminal panel on the right → the fullscreen terminal view opens on the left. Closing the detail view restores the plain chat interface.

> 💡 **Responsive layout:** You can adjust the width of the panels by dragging the divider bars. When the window is too narrow, opening the detail view automatically hides the chat area to save space.

---

## File Workspace (Files)

### File Tree Browsing

- Loaded hierarchically, with directories sorted first
- Click a file to preview it in the detail view
- Expand/collapse the directory structure

### File Operations

| Operation | Description |
|------|------|
| New file/folder | Create via the right-click menu or toolbar buttons |
| Rename | Right-click → Rename, or press F2 after selecting |
| Delete | Move to Trash or delete permanently |
| Drag to move | Drag files/folders to a target location within the file tree |
| Multi-select batch move | Cmd/Ctrl + click to select multiple, then drag |
| Drag from outside | Drag files into Fello from the system file manager |
| Reveal in Finder | Right-click → Reveal in Finder |

### File Preview

Click a file to preview it in the detail view on the left, supporting multiple formats:

| File Type | Preview Method |
|---------|---------|
| Code files | Syntax-highlighted rendering |
| Markdown | Rich text rendering |
| Images | Image rendering preview |
| PDF | PDF reader |
| DOCX / XLSX | Document preview |

### Diff View

When an Agent modifies a file, Fello automatically provides a Git-style side-by-side Diff view:

- The left side shows the content before the change, the right side shows it after
- Changed lines are highlighted in red/green for easy scanning
- You can decide whether to accept the changes after reviewing

### External Modification Detection

Fello monitors the file system in real time to detect external changes to open files. When a file is modified by an external program:

- A blue notice bar floats in the top-right corner
- Click the refresh button to load the latest content

---

## Terminal

### Creating and Managing Terminals

1. Switch to the **Terminal** tab in the right-side panel
2. Click the **+** button to create a new terminal
3. Click a terminal in the list to switch between terminals
4. Click the **×** to close unwanted terminals

### Terminal Features

| Feature | Description |
|------|------|
| Multiple terminals | Create multiple terminal instances per project |
| Full-featured terminal | Built on xterm.js + node-pty, supports full terminal interaction |
| Auto Resize | Terminal size automatically adapts to the window |
| Log persistence | Terminal output is saved automatically; history is available when the session resumes |
| Agent terminal tasks | Agents can launch standalone terminal tasks and capture output |

> 💡 **Agent and Terminal integration:** When an Agent runs a command, you can watch its output in real time in the Terminal panel. Terminal tasks created by Agents also appear in the terminal list for easy tracking and review.

---

## 📖 Related Docs

| Doc | Related info |
|------|---------|
| ← [Quick Start](./quick-start.md) | Coming from here: getting started with the File Workspace |
| → [Permissions & Security](./permissions.md) | Permission control when the Agent operates on files and terminals |
| → [WebUI Remote Access](./webui.md) | Use the file tree and terminal in your browser too |
