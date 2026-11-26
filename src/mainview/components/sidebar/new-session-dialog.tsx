import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import type { Feature } from "../../../shared/schema";
import { ALL_FEATURES } from "../../../shared/constants";
import { newSession } from "../../lib/session-lifecycle";
import { useAppStore } from "../../store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SessionConfigFields } from "@/components/common/session-config";
import { useMessage } from "../providers/message";
import { getErrorMessage } from "./sidebar-utils";

export type NewSessionDialogHandle = {
  open: (projectId: string) => void;
};

type NewSessionDialogProps = {
  /** 创建成功后由侧边栏刷新列表、展开项目并跳转。 */
  onCreated: (projectId: string, sessionId: string) => void | Promise<void>;
  /** 没有任何可用 Agent 时（无法创建会话）跳转到 Agent 设置页。 */
  onNeedAgent: () => void;
};

/**
 * 新建会话弹层。
 *
 * 会话创建所需的表单状态完全由弹层自己持有，侧边栏通过 ref.open(projectId) 唤起，
 * 避免把十几个表单状态塞回 Sidebar。
 */
export const NewSessionDialog = forwardRef<NewSessionDialogHandle, NewSessionDialogProps>(
  function NewSessionDialog({ onCreated, onNeedAgent }, ref) {
    const { t } = useTranslation();
    const { toast } = useMessage();
    const configuredAgents = useAppStore((s) => s.configuredAgents);
    const configuredMcpServers = useAppStore((s) => s.configuredMcpServers);
    const defaultFeatures = useAppStore((s) => s.features);
    const creating = useAppStore((s) => s.isCreatingSession);

    const enabledAgents = useMemo(
      () => configuredAgents.filter((agent) => !agent.disabled),
      [configuredAgents],
    );

    const [open, setOpen] = useState(false);
    const [projectId, setProjectId] = useState<string | null>(null);
    const [agentId, setAgentId] = useState("");
    const [mcpIds, setMcpIds] = useState<Set<string>>(new Set());
    const [features, setFeatures] = useState<Feature[]>(ALL_FEATURES);
    const [permissionMode, setPermissionMode] = useState<"ask" | "allow-all">("allow-all");

    useImperativeHandle(
      ref,
      () => ({
        open(nextProjectId: string) {
          if (enabledAgents.length === 0) {
            onNeedAgent();
            return;
          }
          setProjectId(nextProjectId);
          setAgentId(enabledAgents[0]?.id ?? "");
          setMcpIds(new Set(configuredMcpServers.filter((s) => !s.disabled).map((s) => s.id)));
          setFeatures(defaultFeatures);
          setPermissionMode("allow-all");
          setOpen(true);
        },
      }),
      [configuredMcpServers, defaultFeatures, enabledAgents, onNeedAgent],
    );

    const handleCreate = async () => {
      if (!projectId || !agentId) return;
      useAppStore.getState().setIsCreatingSession(true);
      try {
        const sessionId = await newSession({
          projectId,
          agentId,
          mcpServers: Array.from(mcpIds),
          features,
          permissionMode,
        });
        await onCreated(projectId, sessionId);
        setOpen(false);
      } catch (err) {
        console.error("Failed to create new session:", err);
        toast.error(
          getErrorMessage(err, t("sidebar.newSessionFailed", "Failed to create a new session.")),
        );
      } finally {
        useAppStore.getState().setIsCreatingSession(false);
      }
    };

    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg!">
          <DialogHeader>
            <DialogTitle>
              {t("sidebar.newSessionDialog.title", { defaultValue: "Create session" })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-row gap-2">
              <div className="flex-2 flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">
                  {t("sidebar.newSessionDialog.agent", { defaultValue: "Agent" })}
                </div>
                {enabledAgents.length > 1 && enabledAgents.length <= 3 ? (
                  <Tabs value={agentId} onValueChange={(v) => setAgentId(v as string)}>
                    <TabsList className="w-full h-7! border rounded-md">
                      {enabledAgents.map((agent) => (
                        <TabsTrigger
                          key={agent.id}
                          value={agent.id}
                          className="text-xs h-5 uppercase rounded-sm"
                        >
                          {agent.id}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                ) : (
                  <Select
                    value={agentId}
                    onValueChange={(v) => {
                      if (typeof v === "string") setAgentId(v);
                    }}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue
                        placeholder={t("sidebar.newSessionDialog.selectAgent", {
                          defaultValue: "Select an agent",
                        })}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {enabledAgents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex-1 flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">
                  {t("sidebar.newSessionDialog.permission", { defaultValue: "Permission" })}
                </div>
                {(() => {
                  const permissionItems = [
                    {
                      value: "ask",
                      label: t("sidebar.newSessionDialog.permissionAsk", { defaultValue: "Ask" }),
                    },
                    {
                      value: "allow-all",
                      label: t("sidebar.newSessionDialog.permissionAllowAll", {
                        defaultValue: "Allow all",
                      }),
                    },
                  ];
                  return (
                    <Select
                      items={permissionItems}
                      value={permissionMode}
                      onValueChange={(v) => {
                        if (v === "ask" || v === "allow-all") setPermissionMode(v);
                      }}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {permissionItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                })()}
              </div>
            </div>

            {/* features / MCP servers（与会话头部、加载失败页共用同一实现） */}
            <SessionConfigFields
              variant="card"
              features={features}
              onFeaturesChange={setFeatures}
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
              disabled={creating}
              autoFocus
              onClick={() => void handleCreate()}
            >
              {creating && <LoaderCircle className="size-3 animate-spin" />}
              {t("sidebar.newSessionDialog.create", { defaultValue: "Create" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
