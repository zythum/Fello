import { useEffect } from "react";
import { useAppStore } from "../store";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = useAppStore((state) => state.theme.theme_mode);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    if (themeMode === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);

      // Listen for system theme changes
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        if (useAppStore.getState().theme.theme_mode === "system") {
          root.classList.remove("light", "dark");
          root.classList.add(e.matches ? "dark" : "light");
        }
      };
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }

    root.classList.add(themeMode);
  }, [themeMode]);

  return <>{children}</>;
}