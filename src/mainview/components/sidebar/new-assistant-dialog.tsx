import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import { request } from "../../backend";
import { useAppStore } from "../../store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SessionConfigFields } from "@/components/common/session-config";
import { useMessage } from "../providers/message";
import { getErrorMessage } from "./sidebar-utils";

export type NewAssistantDialogHandle = {
  open: () => void;
};

type NewAssistantDialogProps = {
  /** 创建成功后由侧边栏跳转到助理页面。 */
  onCreated: (assistantId: string) => void;
  /** 没有任何可用于助理的 API Agent 时跳转到 Agent 设置页。 */
  onNeedAgent: () => void;
};

/** 新建个人助理弹层；表单状态与创建流程都由弹层自己持有。 */
export const NewAssistantDialog = forwardRef<NewAssistantDialogHandle, NewAssistantDialogProps>(
  function NewAssistantDialog({ onCreated, onNeedAgent }, ref) {
    const { t } = useTranslation();
    const { toast } = useMessage();
    const configuredAgents = useAppStore((s) => s.configuredAgents);
    const configuredMcpServers = useAppStore((s) => s.configuredMcpServers);
    const assistants = useAppStore((s) => s.assistants);
    const setAssistants = useAppStore((s) => s.setAssistants);

    const assistantSourceAgents = useMemo(
      () =>
        configuredAgents.filter(
          (agent) =>
            !agent.disabled && agent.type === "api" && agent.provider === "openai-compatible",
        ),
      [configuredAgents],
    );

    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    /**
     * 打开弹窗时冻结的默认名称序号：创建成功后列表会先多出一项（广播早于 IPC 返回），
     * 若实时取 assistants.length，保存瞬间 placeholder 会跳到下一个数字再关闭弹窗。
     */
    const [namePlaceholderIndex, setNamePlaceholderIndex] = useState(1);
    const [agentId, setAgentId] = useState("");
    const [mcpIds, setMcpIds] = useState<Set<string>>(new Set());
    const [creating, setCreating] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        open() {
          if (assistantSourceAgents.length === 0) {
            onNeedAgent();
            return;
          }
          setName("");
          setNamePlaceholderIndex(assistants.length + 1);
          setAgentId(assistantSourceAgents[0]?.id ?? "");
          setMcpIds(
            new Set(
              configuredMcpServers.filter((server) => !server.disabled).map((server) => server.id),
            ),
          );
          setOpen(true);
        },
      }),
      [assistantSourceAgents, assistants.length, configuredMcpServers, onNeedAgent],
    );

    const handleCreate = async () => {
      if (!agentId || creating) return;
      setCreating(true);
      try {
        const assistant = await request.createAssistant({
          name: name.trim() || undefined,
          sourceAgentId: agentId,
          mcpServers: Array.from(mcpIds),
        });
        const next = await request.listAssistants();
        setAssistants(next ?? []);
        setOpen(false);
        onCreated(assistant.id);
      } catch (err) {
        toast.error(
          getErrorMessage(
            err,
            t("sidebar.createAssistantFailed", "Failed to create the assistant."),
          ),
        );
      } finally {
        setCreating(false);
      }
    };

    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg!">
          <DialogHeader>
            <DialogTitle>{t("sidebar.newAssistantDialog.title", "Create assistant")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="text-xs text-muted-foreground">
                {t("sidebar.newAssistantDialog.name", "Name")}
              </div>
              <Input
                autoFocus
                className="h-8 text-xs!"
                value={name}
                placeholder={t("sidebar.newAssistantDialog.namePlaceholder", {
                  defaultValue: "Personal Assistant {{n}}",
                  n: namePlaceholderIndex,
                })}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    void handleCreate();
                  }
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-xs text-muted-foreground">
                {t("sidebar.newAssistantDialog.agent", "Agent")}
              </div>
              <Select
                value={agentId}
                onValueChange={(value) => {
                  if (typeof value === "string") setAgentId(value);
                }}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue
                    placeholder={t("sidebar.newAssistantDialog.selectAgent", "Select an agent")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {assistantSourceAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SessionConfigFields
              variant="card"
              showFeatures={false}
              features={[]}
              onFeaturesChange={() => {}}
              mcpServers={Array.from(mcpIds)}
              onMcpServersChange={(next) => setMcpIds(new Set(next))}
            />
          </div>
          <DialogFooter>
            <Button
              size="sm"
              className="h-8 text-xs"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t("sidebar.cancel")}
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs focus:border-ring focus:ring-1 focus:ring-ring/50"
              variant="default"
              disabled={creating || !agentId}
              onClick={() => void handleCreate()}
            >
              {creating && <LoaderCircle className="size-3 animate-spin" />}
              {t("sidebar.newAssistantDialog.create", "Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
