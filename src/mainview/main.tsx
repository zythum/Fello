import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useAppStore } from "./store";
import "@xterm/xterm/css/xterm.css";
import "./index.css";
import "./i18n";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (typeof window === "object") {
  Object.assign(window, { appStore: useAppStore });
}
