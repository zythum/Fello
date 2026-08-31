import { lazy, Suspense, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/layout/sidebar";
import { useAppStore } from "./store";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 首屏必需的「壳 + 落地页」保持同步导入；其余页面（设置/技能/自动化/会话等）
// 全部按需懒加载，拆成独立 chunk，缩小首屏 bundle，缓解打包后首次冷启动的白屏
// （首次需从 asar 冷读 + V8 整段编译，二次启动 OS 缓存已热则很快）。
import { Welcome } from "./components/welcome/welcome";

// 支持具名导出的 lazy 包装
function lazyNamed<T extends Record<string, React.ComponentType<any>>>(
  loader: () => Promise<T>,
  name: keyof T,
) {
  return lazy(() => loader().then((mod) => ({ default: mod[name] })));
}

const Session = lazyNamed(() => import("./components/session/session"), "Session");
const SettingsLayout = lazyNamed(
  () => import("./components/settings/settings-layout"),
  "SettingsLayout",
);
const SettingsGeneral = lazyNamed(
  () => import("./components/settings/general/settings-general"),
  "SettingsGeneral",
);
const SettingsAgents = lazyNamed(
  () => import("./components/settings/agents/settings-agents"),
  "SettingsAgents",
);
const SettingsMcp = lazyNamed(
  () => import("./components/settings/mcp/settings-mcp"),
  "SettingsMcp",
);
const SettingsWebUI = lazyNamed(
  () => import("./components/settings/webui/settings-webui"),
  "SettingsWebUI",
);
const SettingsILink = lazyNamed(
  () => import("./components/settings/ilink/settings-ilink"),
  "SettingsILink",
);
const SettingsSnippets = lazyNamed(
  () => import("./components/settings/snippets/settings-snippets"),
  "SettingsSnippets",
);
const SettingsMemory = lazyNamed(
  () => import("./components/settings/memory/settings-memory"),
  "SettingsMemory",
);
const SettingsImageGeneration = lazyNamed(
  () => import("./components/settings/image-generation/settings-image-generation"),
  "SettingsImageGeneration",
);
const SettingsSpeechToText = lazyNamed(
  () => import("./components/settings/speech-to-text/settings-speech-to-text"),
  "SettingsSpeechToText",
);
const SkillsLayout = lazyNamed(() => import("./components/skills/skills-layout"), "SkillsLayout");
const SkillsInstalled = lazyNamed(
  () => import("./components/skills/installed/skills-installed"),
  "SkillsInstalled",
);
const SkillsSh = lazyNamed(
  () => import("./components/skills/skills-sh/skills-skills-sh"),
  "SkillsSh",
);
const Automation = lazyNamed(() => import("./components/automation/automation"), "Automation");
const Schedule = lazyNamed(() => import("./components/automation/schedule/schedule"), "Schedule");
const Task = lazyNamed(() => import("./components/automation/task/task"), "Task");

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
      <Suspense fallback={<div className="flex-1 bg-background" />}>
        <Routes>
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
            <Route path="image-generation" element={<SettingsImageGeneration />} />
            <Route path="speech-to-text" element={<SettingsSpeechToText />} />
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
      </Suspense>
      <div
        className={cn(
          "flex h-12 w-12 absolute z-10 top-0 items-center justify-center transition-[left] duration-200",
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
