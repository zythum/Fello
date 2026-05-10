import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link2, Link2Off, Loader2, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { useAppStore } from "@/store";
import { request, subscribe } from "@/backend";
import { electron } from "@/electron";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SettingsILink() {
  const { t } = useTranslation();
  const ilinkStatus = useAppStore((s) => s.ilinkStatus);
  const setIlinkStatus = useAppStore((s) => s.setIlinkStatus);
  const activeIlinkSessionId = useAppStore((s) => s.activeIlinkSessionId);
  const setActiveIlinkSessionId = useAppStore((s) => s.setActiveIlinkSessionId);
  const sessions = useAppStore((s) => s.sessions);

  const [loggingIn, setLoggingIn] = useState(false);
  const [loginHint, setLoginHint] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Subscribe to ilink-status-changed events
  useEffect(() => {
    const handler = (payload: { status: typeof ilinkStatus }) => {
      setIlinkStatus(payload.status);
    };
    subscribe.on("ilink-status-changed", handler);
    return () => {
      subscribe.off("ilink-status-changed", handler);
    };
  }, [setIlinkStatus]);

  // Subscribe to active session changes
  useEffect(() => {
    const handler = (payload: { sessionId: string | null }) => {
      setActiveIlinkSessionId(payload.sessionId);
    };
    subscribe.on("ilink-active-session-changed", handler);
    return () => {
      subscribe.off("ilink-active-session-changed", handler);
    };
  }, [setActiveIlinkSessionId]);

  // Fetch initial status
  useEffect(() => {
    request
      .getIlinkStatus()
      .then(setIlinkStatus)
      .catch(() => {});
    request
      .getActiveIlinkSession()
      .then(({ sessionId }) => {
        setActiveIlinkSessionId(sessionId);
      })
      .catch(() => {});
  }, [setIlinkStatus, setActiveIlinkSessionId]);

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      stopPoll();
    };
  }, [stopPoll]);

  const startPoll = useCallback(
    (qrcode: string) => {
      stopPoll();

      const pollOnce = async () => {
        try {
          const { status } = await request.pollIlinkQrcode({ qrcode });
          if (status === "confirmed") {
            stopPoll();
            setLoggingIn(false);
            setLoginHint("");
          } else if (status === "expired") {
            stopPoll();
            setLoggingIn(false);
            setLoginHint(t("settings.ilink.qrcodeExpired", "QR code expired, please try again"));
          } else if (status === "scaned") {
            setLoginHint(t("settings.ilink.scanned", "Scanned! Please confirm on your phone."));
            pollRef.current = setTimeout(pollOnce, 2000);
          } else {
            pollRef.current = setTimeout(pollOnce, 2000);
          }
        } catch (err) {
          console.warn("[iLink] Poll error:", err);
          pollRef.current = setTimeout(pollOnce, 2000);
        }
      };

      pollRef.current = setTimeout(pollOnce, 0);
    },
    [stopPoll, t],
  );

  const handleLogin = async () => {
    setLoggingIn(true);
    setLoginHint("");

    try {
      const { qrcode, qrcodeImgUrl } = await request.startIlinkLogin();
      // Open QR code page in system browser
      await electron.openInBrowser(qrcodeImgUrl);
      setLoginHint(
        t("settings.ilink.browserOpened", "QR code opened in browser. Scan with WeChat to login."),
      );
      startPoll(qrcode);
    } catch (err: any) {
      setLoggingIn(false);
      setLoginHint(err?.message || String(err));
    }
  };

  const handleLogout = async () => {
    try {
      await request.stopIlink();
      setIlinkStatus({ connected: false });
    } catch (err) {
      console.warn("[iLink] Logout error:", err);
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    try {
      await request.setActiveIlinkSession({ sessionId: sessionId || "" });
    } catch (err) {
      console.warn("[iLink] Set active session error:", err);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">{t("settings.ilink.title", "WeChat iLink")}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t(
            "settings.ilink.description",
            "Connect Fello to WeChat via iLink Bot API. Once connected, a ClawBot contact will appear in your WeChat, allowing you to chat with your AI agent from anywhere.",
          )}
        </p>
      </div>

      {/* Connection Status */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          {ilinkStatus.connected ? (
            <>
              <CheckCircle2 className="size-5 text-green-500" />
              <div>
                <p className="text-sm font-medium">{t("settings.ilink.connected", "Connected")}</p>
                {ilinkStatus.userId && (
                  <p className="text-xs text-muted-foreground">{ilinkStatus.userId}</p>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Link2Off className="size-3.5" />
                {t("settings.ilink.disconnect", "Disconnect")}
              </button>
            </>
          ) : (
            <>
              {loggingIn ? (
                <Loader2 className="size-5 text-blue-500 animate-spin" />
              ) : (
                <Link2 className="size-5 text-muted-foreground" />
              )}
              <div>
                <p className="text-sm font-medium">
                  {t("settings.ilink.notConnected", "Not Connected")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.ilink.notConnectedHint", "Scan QR code with WeChat to connect")}
                </p>
              </div>
              <button
                onClick={handleLogin}
                disabled={loggingIn}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <ExternalLink className="size-3.5" />
                {loggingIn
                  ? t("settings.ilink.loggingIn", "Waiting...")
                  : t("settings.ilink.login", "Login")}
              </button>
            </>
          )}
        </div>

        {/* Login hint / error */}
        {loginHint && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
              ilinkStatus.error
                ? "bg-destructive/10 text-destructive"
                : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            }`}
          >
            {ilinkStatus.error ? (
              <AlertCircle className="size-3.5 shrink-0" />
            ) : (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            )}
            {loginHint}
          </div>
        )}

        {ilinkStatus.error && !loginHint && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" />
            {ilinkStatus.error}
          </div>
        )}
      </div>

      {/* Active Session Selector */}
      {ilinkStatus.connected && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-3">
            {t("settings.ilink.activeSession", "Active Session for WeChat")}
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            {t(
              "settings.ilink.activeSessionHint",
              "Messages from WeChat will be routed to this session. Right-click a session in the sidebar to set it as active.",
            )}
          </p>
          <Select
            value={activeIlinkSessionId ?? ""}
            onValueChange={(v) => handleSelectSession(v as string)}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue
                placeholder={t("settings.ilink.selectSession", "-- Select a session --")}
              >
                {(value: string) => {
                  return sessions.find((session) => session.id === value)?.title;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t("settings.ilink.none", "-- None --")}</SelectItem>
              {sessions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.title || s.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <h3 className="text-sm font-medium mb-2">
          {t("settings.ilink.howItWorks", "How it works")}
        </h3>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>{t("settings.ilink.step1", 'Click "Login" to open the QR code in your browser')}</li>
          <li>{t("settings.ilink.step2", "Scan the QR code with WeChat")}</li>
          <li>{t("settings.ilink.step3", 'A "ClawBot" contact appears in your WeChat')}</li>
          <li>
            {t(
              "settings.ilink.step4",
              "Chat with ClawBot — messages are routed to the active session above",
            )}
          </li>
          <li>
            {t(
              "settings.ilink.step5",
              "Right-click any session in the sidebar to set it as active for WeChat",
            )}
          </li>
        </ol>
      </div>
    </div>
  );
}
