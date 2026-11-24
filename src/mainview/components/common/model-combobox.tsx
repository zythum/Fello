import { useCallback, useRef, useState } from "react";
import type { ModelInfo } from "../../../shared/schema";
import { request } from "../../backend";
import { AutocompleteInput, type AutocompleteOption } from "./autocomplete-input";

export interface ModelComboboxProps {
  /** 当前选中的 Agent；变更后候选列表随之切换。 */
  agentId: string | null;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 没有任何候选时的提示；模型 id 仍可自由输入。 */
  emptyHint?: string;
  /** 有候选但输入过滤后无匹配时的提示；缺省复用 `emptyHint`。 */
  noMatchHint?: string;
  loadingLabel?: string;
  id?: string;
  /** 传给内部 Input 的样式（保持与原有表单字段一致）。 */
  className?: string;
  disabled?: boolean;
}

type Catalog = { agentId: string; models: ModelInfo[] };

/**
 * 模型输入框：普通文本框 + 该 Agent 的模型候选（`AutocompleteInput` 的模型领域封装）。
 *
 * 不要求从候选中选一个：可输入任意模型 id，留空表示使用 Agent 默认模型。
 * 候选来源见 `src/backend/agent/model-catalog.ts`。
 */
export function ModelCombobox({
  agentId,
  value,
  onChange,
  placeholder,
  emptyHint,
  noMatchHint,
  loadingLabel,
  id,
  className,
  disabled,
}: ModelComboboxProps) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadingAgentId, setLoadingAgentId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // Agent 切换后旧候选立即失效：按 agentId 判定，不需要额外的重置 effect。
  const models = catalog && catalog.agentId === agentId ? catalog.models : [];
  const loading = loadingAgentId !== null && loadingAgentId === agentId;

  const load = useCallback((targetAgentId: string) => {
    const seq = ++requestSeq.current;
    setLoadingAgentId(targetAgentId);
    request
      .listAgentModels({ agentId: targetAgentId })
      .then((next) => {
        if (requestSeq.current !== seq) return;
        setCatalog({ agentId: targetAgentId, models: next ?? [] });
      })
      .catch(() => {
        if (requestSeq.current !== seq) return;
        setCatalog({ agentId: targetAgentId, models: [] });
      })
      .finally(() => {
        if (requestSeq.current === seq) setLoadingAgentId(null);
      });
  }, []);

  const options: AutocompleteOption[] = models.map((model) => ({ value: model.modelId }));

  return (
    <AutocompleteInput
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      onOpen={() => {
        if (agentId) load(agentId);
      }}
      // 没有选择 Agent 时保持纯文本输入，不弹空面板。
      canOpen={agentId !== null}
      placeholder={placeholder}
      emptyHint={emptyHint}
      noMatchHint={noMatchHint}
      loading={loading}
      loadingLabel={loadingLabel}
      className={className}
      disabled={disabled}
    />
  );
}
