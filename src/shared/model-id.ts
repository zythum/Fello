/**
 * 把 `{field}` 占位符替换为 /models 返回项里的字段值（`modelIdTemplate` 用）。
 *
 * 例如模板 `"{owned_by}/{id}"` + `{ id: "gpt-4o", owned_by: "openai" }`
 * 得到 `"openai/gpt-4o"`。缺失字段保持原样，保证结果可预测。
 */
export function applyModelIdTemplate(template: string, modelItem: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (match, fieldName) => {
    const value = modelItem[fieldName];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}
