import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/layout/sidebar";
import { useAppStore } from "./store";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Layouts
import { SettingsLayout } from "./components/settings/settings-layout";

// Pages
import { Welcome } from "./components/welcome/welcome";
import { Session } from "./components/session/session";
import { SettingsGeneral } from "./components/settings/general/settings-general";
import { SettingsAgents } from "./components/settings/agents/settings-agents";
import { SettingsMcp } from "./components/settings/mcp/settings-mcp";
import { SettingsWebUI } from "./components/settings/webui/settings-webui";
import { SettingsILink } from "./components/settings/ilink/settings-ilink";
import { SettingsSnippets } from "./components/settings/snippets/settings-snippets";
import { SettingsMemory } from "./components/settings/memory/settings-memory";
import { SkillsLayout } from "./components/skills/skills-layout";
import { SkillsInstalled } from "./components/skills/installed/skills-installed";
import { SkillsSh } from "./components/skills/skills-sh/skills-skills-sh";
import { Automation } from "./components/automation/automation";
import { Schedule } from "./components/automation/schedule/schedule";
import { Task } from "./components/automation/task/task";

function SessionWrapper() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const sessionInfo = useAppStore((s) => s.sessions.find((x) => x.id === sessionId));
  const navigate = useNavigate();

  useEffect(() => {
    if (!sessionId || !sessionInfo) {
      navigate("/", { replace: true });
    }
  }, [sessionId, sessionInfo, navigate]);

  if (!sessionId || !sessionInfo) {
    return null;
  }

  return <Session session={sessionInfo} />;
}

export function AppRouter() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const isMacApp = useAppStore((s) => s.isMacApp);
  const isFullScreen = useAppStore((s) => s.isFullScreen);
  const showMacTrafficLightSpace = isMacApp && !isFullScreen;

  return (
    <div className="flex h-full bg-background text-foreground">
      <Sidebar />
      <Routes>
        {" "}
        <Route path="/" element={<Welcome />} />
        <Route path="/session-view/:sessionId" element={<SessionWrapper />} />
        <Route path="/settings" element={<SettingsLayout />}>
          <Route path="general" element={<SettingsGeneral />} />
          <Route path="agents" element={<SettingsAgents />} />
          <Route path="mcp" element={<SettingsMcp />} />
          <Route path="webui" element={<SettingsWebUI />} />
          <Route path="ilink" element={<SettingsILink />} />
          <Route path="snippets" element={<SettingsSnippets />} />
          <Route path="memory" element={<SettingsMemory />} />
        </Route>
        <Route path="/skills" element={<SkillsLayout />}>
          <Route path="installed" element={<SkillsInstalled />} />
          <Route path="skills-sh" element={<SkillsSh />} />
        </Route>
        <Route path="/automation" element={<Automation />} />
        <Route path="/automation/schedule/:scheduleId" element={<Schedule />}>
          <Route path="task/:taskId" element={<Task />} />
        </Route>
      </Routes>
      <div
        className={cn(
          "flex h-12 w-12 fixed z-10 top-0 items-center justify-center",
          sidebarOpen ? "left-49" : showMacTrafficLightSpace ? "left-16" : "left-0",
        )}
        style={{ WebkitAppRegion: "no-drag" }}
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 hover:bg-sidebar-accent hover:text-sidebar-foreground/70",
            sidebarOpen ? "text-sidebar-foreground/60" : "text-sidebar-foreground/70",
          )}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="size-4" />
          ) : (
            <PanelLeftOpen className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
