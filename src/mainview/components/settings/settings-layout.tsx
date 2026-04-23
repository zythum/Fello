import { useTranslation } from "react-i18next";
import { Outlet, NavLink, useLocation, Navigate } from "react-router-dom";
import { Bot, Globe, SlidersHorizontal, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export function SettingsLayout() {
  const { t } = useTranslation();
  const location = useLocation();

  if (location.pathname === "/settings" || location.pathname === "/settings/") {
    return <Navigate to="/settings/general" replace />;
  }

  const tabs = [
    {
      id: "general",
      href: "/settings/general",
      icon: <SlidersHorizontal className="size-4" />,
      label: t("settings.general.title", "General"),
    },
    {
      id: "agents",
      href: "/settings/agents",
      icon: <Bot className="size-4" />,
      label: t("settings.agents.title", "Agents"),
    },
    {
      id: "mcp",
      href: "/settings/mcp",
      icon: <Wrench className="size-4" />,
      label: t("settings.mcp.title", "MCP Servers"),
    },
    {
      id: "webui",
      href: "/settings/webui",
      icon: <Globe className="size-4" />,
      label: t("settings.webui.title", "WebUI"),
    },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background relative">
      <div
        className="h-12 shrink-0 border-b border-border/60 flex items-center px-6"
        style={{ WebkitAppRegion: "drag" }}
      >
        <h1 className="text-sm font-medium">{t("settings.title", "Settings")}</h1>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-48 shrink-0 border-r border-border/60 bg-muted/10">
          <nav className="flex flex-col gap-1 p-4">
            {tabs.map((tab) => (
              <NavLink
                key={tab.id}
                to={tab.href}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )
                }
              >
                {tab.icon}
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="flex-1 overflow-y-auto bg-background py-4 px-6">
          <div className="mx-auto max-w-2xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
