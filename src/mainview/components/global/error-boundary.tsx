import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import i18n from "@/i18n";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidMount() {
    // Clear reload counter on successful mount
    setTimeout(() => {
      sessionStorage.removeItem("vite-chunk-reload");
    }, 1000);
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);

    // Auto-reload on Vite dynamic import errors
    const isDynamicImportError =
      error.message.includes("Failed to fetch dynamically imported module") ||
      error.message.includes("Importing a module script failed");

    if (isDynamicImportError) {
      const reloadCount = parseInt(sessionStorage.getItem("vite-chunk-reload") || "0", 10);
      if (reloadCount < 2) {
        sessionStorage.setItem("vite-chunk-reload", (reloadCount + 1).toString());
        window.location.reload();
      }
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-foreground p-4">
          <h1 className="text-2xl font-bold mb-2">{i18n.t("errorBoundary.title")}</h1>
          <pre className="text-xs whitespace-pre-line mb-6 w-[80%]">
            {this.state.error?.message || i18n.t("errorBoundary.defaultMessage")}
          </pre>
          <Button onClick={this.handleReset}>{i18n.t("errorBoundary.reload")}</Button>
        </div>
      );
    }

    return this.props.children;
  }
}
