import { Outlet, NavLink, useLocation, Navigate } from "react-router-dom";
import { Library, PackageSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function SkillsLayout() {
  const { t } = useTranslation();
  const location = useLocation();

  if (location.pathname === "/skills" || location.pathname === "/skills/") {
    return <Navigate to="/skills/installed" replace />;
  }

  const tabs = [
    {
      id: "installed",
      href: "/skills/installed",
      icon: <Library className="size-4" />,
      label: t("skills.installed"),
    },
    {
      id: "store",
      href: "/skills/store",
      icon: <PackageSearch className="size-4" />,
      label: `${t("skills.store")} skills.sh`,
    },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background relative">
      <div
        className="h-12 shrink-0 border-b border-border flex items-center px-6"
        style={{ WebkitAppRegion: "drag" }}
      >
        <h1 className="text-sm font-medium">{t("skills.title")}</h1>
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
        <main className="flex-1 flex flex-col bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
