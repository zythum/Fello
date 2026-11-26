import { useTranslation } from "react-i18next";
import { ClockCheck, Home, Library } from "lucide-react";

type SidebarNavProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
};

/** 侧边栏顶部的固定导航入口（欢迎 / Skills / 自动化）。 */
export function SidebarNav({ currentPath, onNavigate }: SidebarNavProps) {
  const { t } = useTranslation();

  return (
    <div className="px-2 pt-2 pb-1">
      <div
        onClick={() => onNavigate("/")}
        className={`group flex h-8 cursor-default items-center gap-2 rounded-md px-1.5 text-xs font-normal transition-colors ${
          currentPath === "/"
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/95"
        }`}
      >
        <Home className="size-3.5" />
        <span className="flex-1 truncate leading-normal select-none uppercase">
          {t("sidebar.welcome")}
        </span>
      </div>
      <div
        onClick={() => onNavigate("/skills/installed")}
        className={`mt-0.5 group flex h-8 cursor-default items-center gap-2 rounded-md px-1.5 text-xs font-normal transition-colors ${
          currentPath.startsWith("/skills")
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/95"
        }`}
      >
        <Library className="size-3.5" />
        <span className="flex-1 truncate leading-normal select-none uppercase">
          {t("sidebar.skills")}
        </span>
      </div>
      <div
        onClick={() => onNavigate("/automation")}
        className={`mt-0.5 group flex h-8 cursor-default items-center gap-2 rounded-md px-1.5 text-xs font-normal transition-colors ${
          currentPath.startsWith("/automation")
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/95"
        }`}
      >
        <ClockCheck className="size-3.5" />
        <span className="flex-1 truncate leading-normal select-none uppercase">
          {t("sidebar.automation", "Automation")}
        </span>
      </div>
    </div>
  );
}
