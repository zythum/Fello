import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/layout/sidebar";
import { useAppStore } from "./store";

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
import { SkillsLayout } from "./components/skills/skills-layout";
import { SkillsInstalled } from "./components/skills/installed/skills-installed";
import { SkillsSh } from "./components/skills/skills-sh/skills-skills-sh";

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
          <Route path="ilink" element={<SettingsILink />} />
          <Route path="snippets" element={<SettingsSnippets />} />
        </Route>
        <Route path="/skills" element={<SkillsLayout />}>
          <Route path="installed" element={<SkillsInstalled />} />
          <Route path="skills-sh" element={<SkillsSh />} />
        </Route>
      </Routes>
    </div>
  );
}
