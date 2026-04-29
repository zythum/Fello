import { useParams, Navigate } from "react-router-dom";
import { Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/layout/sidebar";
import { useAppStore } from "./store";

// Layouts
import { SettingsLayout } from "./components/settings/settings-layout";

// Pages
import { Welcome } from "./components/welcome/welcome";
import { SessionView } from "./components/session/session-view";
import { SettingsGeneral } from "./components/settings/settings-general";
import { SettingsAgents } from "./components/settings/settings-agents";
import { SettingsMcp } from "./components/settings/settings-mcp";
import { SettingsWebUI } from "./components/settings/settings-webui";
import { SkillsLayout } from "./components/skills/skills-layout";
import { SkillsInstalled } from "./components/skills/skills-installed";
import { SkillsSkillsSh } from "./components/skills/skills-skill-sh";

function SessionWrapper() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const sessionInfo = useAppStore((s) => s.sessions.find((x) => x.id === sessionId));

  if (!sessionId || !sessionInfo) {
    return <Navigate to="/" replace />;
  }

  return <SessionView session={sessionInfo} />;
}

export function AppRouter() {
  return (
    <div className="flex h-screen bg-background text-foreground">
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
        </Route>
        <Route path="/skills" element={<SkillsLayout />}>
          <Route path="installed" element={<SkillsInstalled />} />
          <Route path="store" element={<SkillsSkillsSh />} />
        </Route>
      </Routes>
    </div>
  );
}
