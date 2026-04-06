import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
  useRef,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { useTranslation } from "react-i18next";

type MessageContextValue = {
  inputValue?: string;
};

type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";

export type ButtonConfig = {
  text: React.ReactNode;
  variant?: ButtonVariant;
  value: string | ((context: MessageContextValue) => Promise<string>);
};

export type DialogOptions = {
  title?: React.ReactNode;
  content?: React.ReactNode;
  icon?: React.ReactNode;
  buttons?: ButtonConfig[];
};

export type PromptOptions = DialogOptions & {
  defaultValue?: string;
  placeholder?: string;
  validate?: (val: string) => string | boolean | undefined | Promise<string | boolean | undefined>;
};

type DialogType = "alert" | "confirm" | "prompt";

type ActiveDialogState = PromptOptions & {
  type: DialogType;
  resolve: (value: string | null) => void;
};

type MessageApi = {
  alert: (options: DialogOptions) => Promise<string | null>;
  confirm: (options: DialogOptions) => Promise<string | null>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  toast: typeof sonnerToast;
};

const MessageContext = createContext<MessageApi | null>(null);

export const useMessage = () => {
  const ctx = useContext(MessageContext);
  if (!ctx) throw new Error("useMessage must be used within a MessageProvider");
  return ctx;
};

const DialogButton = ({
  btn,
  context,
  onResolve,
  validate,
}: {
  btn: ButtonConfig;
  context: MessageContextValue;
  onResolve: (val: string) => void;
  validate?: (val: string) => string | boolean | undefined | Promise<string | boolean | undefined>;
}) => {
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, []);

  const handleClick = async () => {
    const isCancel = btn.value === "cancel";

    // Manage delayed loading state
    const startLoading = () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
      loadingTimeoutRef.current = setTimeout(() => {
        setLoading(true);
      }, 200);
    };
    const stopLoading = () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      setLoading(false);
    };

    if (validate && !isCancel) {
      startLoading();
      try {
        const err = await validate(context.inputValue || "");
        if (err && typeof err === "string") {
          sonnerToast.error(err);
          stopLoading();
          return;
        } else if (err === false) {
          stopLoading();
          return;
        }
      } catch (e: any) {
        sonnerToast.error(e.message || t("message.validationFailed", "Validation failed"));
        stopLoading();
        return;
      }
      // Do not stopLoading here if we are continuing to the next phase
    }

    if (typeof btn.value === "function") {
      if (!loading && (!validate || isCancel)) {
        startLoading();
      }
      try {
        const result = await btn.value(context);
        onResolve(result);
      } catch (e: any) {
        console.error(e);
        if (e && e.message) {
          sonnerToast.error(e.message);
        }
      } finally {
        stopLoading();
      }
    } else {
      stopLoading();
      onResolve(btn.value);
    }
  };

  return (
    <Button
      size="xs"
      variant={btn.variant || "default"}
      onClick={handleClick}
      disabled={loading}
      className="h-8 text-xs"
    >
      {loading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
      {btn.text}
    </Button>
  );
};

export const MessageProvider = ({ children }: { children: ReactNode }) => {
  const [dialogQueue, setDialogQueue] = useState<ActiveDialogState[]>([]);
  const [activeDialog, setActiveDialog] = useState<ActiveDialogState | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (dialogQueue.length > 0 && !activeDialog) {
      const nextDialog = dialogQueue[0];
      setActiveDialog(nextDialog);
      setDialogQueue((prev) => prev.slice(1));

      if (nextDialog.type === "prompt") {
        setInputValue(nextDialog.defaultValue || "");
      } else {
        setInputValue("");
      }

      setIsOpen(true);
    }
  }, [dialogQueue, activeDialog]);

  const handleClose = useCallback(
    (open: boolean) => {
      if (!open && activeDialog) {
        activeDialog.resolve(null);
        setIsOpen(false);
        if (closeTimeoutRef.current) {
          clearTimeout(closeTimeoutRef.current);
        }
        closeTimeoutRef.current = setTimeout(() => {
          setActiveDialog(null);
        }, 150);
      }
    },
    [activeDialog],
  );

  const alert = useCallback(
    (options: DialogOptions) => {
      return new Promise<string | null>((resolve) => {
        setDialogQueue((prev) => [
          ...prev,
          {
            type: "alert",
            ...options,
            buttons: options.buttons || [
              { text: t("message.ok", "OK"), value: "ok", variant: "default" },
            ],
            resolve,
          },
        ]);
      });
    },
    [t],
  );

  const confirm = useCallback(
    (options: DialogOptions) => {
      return new Promise<string | null>((resolve) => {
        setDialogQueue((prev) => [
          ...prev,
          {
            type: "confirm",
            ...options,
            buttons: options.buttons || [
              { text: t("message.cancel", "Cancel"), value: "cancel", variant: "outline" },
              { text: t("message.confirm", "Confirm"), value: "confirm", variant: "default" },
            ],
            resolve,
          },
        ]);
      });
    },
    [t],
  );

  const prompt = useCallback(
    (options: PromptOptions) => {
      return new Promise<string | null>((resolve) => {
        setDialogQueue((prev) => [
          ...prev,
          {
            type: "prompt",
            ...options,
            buttons: options.buttons || [
              { text: t("message.cancel", "Cancel"), value: "cancel", variant: "outline" },
              {
                text: t("message.confirm", "Confirm"),
                value: (ctx) => Promise.resolve(ctx.inputValue || ""),
                variant: "default",
              },
            ],
            resolve,
          },
        ]);
      });
    },
    [t],
  );

  const handleResolve = (val: string | null) => {
    if (activeDialog) {
      activeDialog.resolve(val);
      setIsOpen(false);
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
      closeTimeoutRef.current = setTimeout(() => {
        setActiveDialog(null);
      }, 150);
    }
  };

  return (
    <MessageContext.Provider value={{ alert, confirm, prompt, toast: sonnerToast }}>
      {children}
      <Toaster />

      <Dialog open={isOpen} onOpenChange={handleClose} disablePointerDismissal>
        <DialogContent showCloseButton={false} className="sm:max-w-105 p-3 gap-0.5">
          {activeDialog?.title && (
            <DialogHeader className="mb-2 gap-1">
              <DialogTitle className="flex items-center gap-1 text-md">
                {activeDialog.icon && <span className="shrink-0 size-4">{activeDialog.icon}</span>}
                {activeDialog.title}
              </DialogTitle>
              {activeDialog?.content && (
                <DialogDescription>
                  <div className="text-sm text-foreground/50 pt-1">{activeDialog.content}</div>
                </DialogDescription>
              )}
            </DialogHeader>
          )}

          <div className={activeDialog?.title ? "" : "mb-2"}>
            {!activeDialog?.title && (
              <>
                <DialogTitle className="sr-only">
                  {t("message.dialogTitle", "Message Dialog")}
                </DialogTitle>
                {activeDialog?.icon && <div className="mb-3 size-4">{activeDialog.icon}</div>}
                {activeDialog?.content && (
                  <div className="text-xs! text-foreground/80 mb-3">{activeDialog.content}</div>
                )}
              </>
            )}

            {activeDialog?.type === "prompt" && (
              <div className="mt-0 mb-2">
                <Input
                  autoFocus
                  className="h-8 text-xs! text-foreground/95 focus-visible:ring-0.5"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={activeDialog.placeholder}
                  onKeyDown={() => {
                    // Enter key submission is intentionally omitted to rely on button validation flow
                  }}
                />
              </div>
            )}
          </div>

          {activeDialog?.buttons && activeDialog.buttons.length > 0 && (
            <DialogFooter className="-m-3 mt-2 p-3 sm:justify-end gap-2 sm:space-x-0">
              {activeDialog.buttons.map((btn, idx) => (
                <DialogButton
                  key={idx}
                  btn={btn}
                  context={{ inputValue }}
                  onResolve={handleResolve}
                  validate={activeDialog.validate}
                />
              ))}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </MessageContext.Provider>
  );
};
