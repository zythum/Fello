/**
 * textarea 光标处插入的公共原语（不含按键策略，Enter 等按键策略由输入框组件决定）。
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

/**
 * 在光标处插入 `#` / `@` 并触发展开建议弹层（chat-input 与 chat-ask-user-dialog 共用）。
 *
 * react-mentions 只在 selectionchange → onSelect 时刷新建议（真实输入会触发），而
 * execCommand 只触发 input 不触发 selectionchange，因此需要手动补发一次。
 * 空格规则：光标前已有内容且非空白时补 1 个前导空格（trigger 匹配要求行首或空白）。
 */
export function insertMentionTrigger(
  textarea: HTMLTextAreaElement | null | undefined,
  char: "#" | "@",
): void {
  if (!textarea) return;
  textarea.focus();
  const before = textarea.value.slice(0, textarea.selectionStart);
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  document.execCommand("insertText", false, `${needsLeadingSpace ? " " : ""}${char}`);
  textarea.ownerDocument.dispatchEvent(new Event("selectionchange"));
}
