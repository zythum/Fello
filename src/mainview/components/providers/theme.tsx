import { useEffect } from "react";
import { useAppStore } from "../../store";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

function ThemeSync() {
  const themeMode = useAppStore((state) => state.theme.themeMode);
  const { setTheme } = useTheme();

  useEffect(() => {
    setTheme(themeMode);
  }, [themeMode, setTheme]);

  return null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeSync />
      {children}
    </NextThemesProvider>
  );
}
