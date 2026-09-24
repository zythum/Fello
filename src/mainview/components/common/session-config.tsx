import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppStore } from "../../store";
import { ALL_FEATURES, FEATURE_I18N_KEYS } from "../../../shared/constants";
import type { Feature, SessionInfo } from "../../../shared/schema";

type PermissionMode = SessionInfo["permissionMode"];
type SessionConfigVariant = "popover" | "card";

/**
 * 会话级配置（权限 / features / MCP servers）的受控编辑区。
 *
 * 同一份配置有三处需要编辑，收敛在这里作为唯一实现：
 * 1. 会话头部弹出层（`variant="popover"`）——改完点「重启会话」生效；
 * 2. 会话加载失败页（`variant="card"`）——就地修正配置后重新加载；
 * 3. 新建会话弹窗（`variant="card"`）——作为创建时的初始配置。
 *
 * 组件本身不关心「何时生效」：全部受控，由调用方决定提交时机。
 * 权限项同理——头部是即时 `updateSession`，失败页 / 新建弹窗则随重新加载或创建一起提交。
 */
export interface SessionConfigFieldsProps {
  /** 会话启用的 MCP server id 列表 */
  mcpServers: string[];
  onMcpServersChange: (next: string[]) => void;
  /** 会话启用的 feature 列表 */
  features: Feature[];
  onFeaturesChange: (next: Feature[]) => void;
  /** 权限模式；与 `onPermissionModeChange` 同时提供才渲染权限分区 */
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (next: PermissionMode) => void;
  /**
   * 视觉变体：
   * - `popover`：会话头部弹出层风格（紧凑行 + 分区之间的分隔线，无 MCP 时整段隐藏）
   * - `card`：表单 / 失败页风格（带边框卡片行，无 MCP 时显示空状态说明）
   */
  variant?: SessionConfigVariant;
  className?: string;
}

export function SessionConfigFields({
  mcpServers,
  onMcpServersChange,
  features,
  onFeaturesChange,
  permissionMode,
  onPermissionModeChange,
  variant = "popover",
  className,
}: SessionConfigFieldsProps) {
  const { t } = useTranslation();
  const configuredMcpServers = useAppStore((state) => state.configuredMcpServers);
  const isCard = variant === "card";

  const toggleFeature = (feature: Feature, checked: boolean) => {
    onFeaturesChange(checked ? [...features, feature] : features.filter((item) => item !== feature));
  };

  const toggleMcpServer = (mcpServerId: string, checked: boolean) => {
    onMcpServersChange(
      checked ? [...mcpServers, mcpServerId] : mcpServers.filter((id) => id !== mcpServerId),
    );
  };

  const sectionTitleClassName = isCard
    ? "text-xs text-muted-foreground"
    : "px-2 py-1 text-xs font-semibold text-foreground/80";

  // popover 变体沿用头部弹出层原行为：没有配置 MCP 时整段隐藏，避免多出一个空标题；
  // card 变体（失败页 / 新建弹窗）则显示空状态，让用户知道为什么没有可选项。
  const showMcpSection = isCard || configuredMcpServers.length > 0;

  return (
    <div className={cn(isCard ? "flex flex-col gap-4" : undefined, className)}>
      {permissionMode !== undefined && onPermissionModeChange !== undefined && (
        <div className={cn(isCard && "flex flex-col gap-2")}>
          <div className={sectionTitleClassName}>{t("sessionConfig.permission", "Permission")}</div>
          <Tabs
            value={permissionMode}
            onValueChange={(value) => {
              if (value === "ask" || value === "allow-all") onPermissionModeChange(value);
            }}
            className={cn("w-full", !isCard && "px-2 my-2")}
          >
            <TabsList className="w-full">
              <TabsTrigger value="ask" className="text-xs">
                {t("sessionConfig.permissionAsk", "Ask")}
              </TabsTrigger>
              <TabsTrigger value="allow-all" className="text-xs">
                {t("sessionConfig.permissionAllowAll", "Allow all")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {!isCard && <div className="border-t border-border/50 my-1" />}
        </div>
      )}

      <div className={cn(isCard && "flex flex-col gap-2")}>
        <div className={sectionTitleClassName}>{t("sessionConfig.features", "Features")}</div>
        <div className={toggleGridClassName(ALL_FEATURES.length, variant)}>
          {ALL_FEATURES.map((feature) => (
            <ToggleRow
              key={feature}
              variant={variant}
              label={t(FEATURE_I18N_KEYS[feature], { defaultValue: feature })}
              checked={features.includes(feature)}
              onToggle={(checked) => toggleFeature(feature, checked)}
            />
          ))}
        </div>
        {!isCard && <div className="border-t border-border/50 my-1" />}
      </div>

      {showMcpSection && (
        <div className={cn(isCard && "flex flex-col gap-2")}>
          <div className={cn(sectionTitleClassName, !isCard && "mt-1")}>
            {t("sessionConfig.mcpServers", "MCP Servers")}
          </div>
          <div className={toggleGridClassName(configuredMcpServers.length, variant)}>
            {configuredMcpServers.map((mcpServer) => (
              <ToggleRow
                key={mcpServer.id}
                variant={variant}
                label={mcpServer.id}
                title={mcpServer.id}
                checked={mcpServers.includes(mcpServer.id)}
                onToggle={(checked) => toggleMcpServer(mcpServer.id, checked)}
              />
            ))}
          </div>
          {configuredMcpServers.length === 0 && (
            <div className="text-xs text-muted-foreground">
              {t("sessionConfig.noMcpServers", "No MCP servers configured")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 选项列的排布：条目足够多时并排两列，否则单列 */
function toggleGridClassName(count: number, variant: SessionConfigVariant): string | undefined {
  if (variant === "card") {
    return count >= 2 ? "grid grid-cols-2 gap-1" : "flex flex-col gap-1";
  }
  return count >= 2 ? "grid grid-cols-2 gap-0.5" : undefined;
}

/** 单个开关行：整行可点击，Switch 自身点击不重复触发父级 */
function ToggleRow({
  variant,
  label,
  title,
  checked,
  onToggle,
}: {
  variant: SessionConfigVariant;
  label: string;
  title?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between cursor-default transition-colors",
        variant === "card"
          ? "h-7 rounded border bg-secondary/50 px-2 text-xs hover:bg-accent"
          : "rounded px-2 py-1.5 text-xs hover:bg-accent/50",
      )}
      onClick={() => onToggle(!checked)}
    >
      <span
        className={cn(
          "truncate",
          variant === "popover" && "mr-2",
          checked ? "text-muted-foreground" : "text-muted-foreground/50",
        )}
        title={title}
      >
        {label}
      </span>
      <div onClick={(event) => event.stopPropagation()}>
        <Switch size="sm" checked={checked} onCheckedChange={onToggle} />
      </div>
    </div>
  );
}
