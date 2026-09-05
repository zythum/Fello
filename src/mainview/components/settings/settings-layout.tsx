import { useTranslation } from "react-i18next";
import { Outlet, NavLink, useLocation, Navigate } from "react-router-dom";
import {
  Bot,
  Globe,
  MessageCircle,
  SlidersHorizontal,
  Wrench,
  Clipboard,
  Brain,
  ImageIcon,
  Mic,
  Command,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "../../store";

export function SettingsLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const isMacApp = useAppStore((s) => s.isMacApp);
  const isFullScreen = useAppStore((s) => s.isFullScreen);
  const showMacTrafficLightSpace = isMacApp && !isFullScreen;

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
      id: "shortcuts",
      href: "/settings/shortcuts",
      icon: <Command className="size-4" />,
      label: t("settings.shortcuts.title", "Shortcuts"),
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
      id: "image-generation",
      href: "/settings/image-generation",
      icon: <ImageIcon className="size-4" />,
      label: t("settings.imageGeneration.title", "Image Generation"),
    },
    {
      id: "speech-to-text",
      href: "/settings/speech-to-text",
      icon: <Mic className="size-4" />,
      label: t("settings.speechToText.title", "Speech to Text"),
    },
    {
      id: "snippets",
      href: "/settings/snippets",
      icon: <Clipboard className="size-4" />,
      label: t("settings.snippets.title", "Snippets"),
    },
    {
      id: "memory",
      href: "/settings/memory",
      icon: <Brain className="size-4" />,
      label: t("settings.memory.title", "Memory"),
    },
    {
      id: "webui",
      href: "/settings/webui",
      icon: <Globe className="size-4" />,
      label: t("settings.webui.title", "WebUI"),
    },
    {
      id: "ilink",
      href: "/settings/ilink",
      icon: <MessageCircle className="size-4" />,
      label: t("settings.ilink.title", "WeChat iLink"),
    },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background relative">
      <div
        className={cn(
          "h-12 shrink-0 border-b border-border flex items-center pr-2 transition-[padding] duration-200",
          sidebarOpen ? "pl-6" : showMacTrafficLightSpace ? "pl-27" : "pl-12",
        )}
        style={{ WebkitAppRegion: "drag" }}
      >
        <h1 className="text-sm font-medium">{t("settings.title", "Settings")}</h1>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-48 shrink-0 border-r border-border bg-muted/10">
          <nav className="flex flex-col gap-1 p-4">
            {tabs.map((tab) => (
              <NavLink
                key={tab.id}
                to={tab.href}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors cursor-default",
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
        <main className="flex-1 flex flex-col bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
