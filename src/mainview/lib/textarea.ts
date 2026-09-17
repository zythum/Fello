/**
 * textarea 光标处插入的公共实现。
 *
 * 背景（Chromium / Blink）：`EditingBehavior` 的按键映射表只为「无修饰键」和
 * 「Shift」的 Enter 生成插入换行的编辑命令，没有 Ctrl/Cmd + Return 项，
 * 因此 Ctrl/Cmd+Enter 在 textarea 里不会插入任何字符（macOS 上 Cmd 组合键还会被
 * 当作系统键）。想在输入框里支持 Ctrl/Cmd+Enter 换行就必须手动插入。
 */

/**
 * 在 textarea 光标处插入一个换行。
 *
 * 用 `execCommand("insertText")` 而非直接改 `value`：前者会同步更新选区并触发 input
 * 事件，React / react-mentions 这类受控组件才能拿到这次变更，同时保留原生撤销栈。
 * 直接赋值不会通知受控组件，下一次渲染就会被旧 state 覆盖回去。
 */
export function insertNewlineAtCaret(textarea: HTMLTextAreaElement | null | undefined): void {
  if (!textarea) return;
  // execCommand("insertText") 需要目标处于聚焦状态，否则静默失败
  textarea.focus();
  document.execCommand("insertText", false, "\n");
}
