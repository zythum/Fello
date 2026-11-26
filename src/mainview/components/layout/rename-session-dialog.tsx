import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SessionInfo } from "../../../shared/schema";

/**
 * 重命名会话的专用弹层。
 *
 * 与通用 `prompt()` 弹窗唯一的区别是：规则说明（留空 = 回落到自动标题）要贴在输入框下方，
 * 而通用弹窗在输入框和按钮之间没有插槽，所以这里直接用 Dialog 拼装。
 *
 * 输入值由调用方受控：打开时填入用户标题，没有用户标题时为空串。
 */
export function RenameSessionDialog({
  session,
  value,
  onValueChange,
  onClose,
  onSubmit,
}: {
  /** 正在重命名的会话；`null` 表示弹层关闭。 */
  session: SessionInfo | null;
  /** 受控输入值。 */
  value: string;
  onValueChange: (value: string) => void;
  onClose: () => void;
  /** 提交当前输入；空串表示清除用户标题。 */
  onSubmit: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={session !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-105 gap-3">
        <DialogHeader>
          <DialogTitle>{t("sidebar.renameSession")}</DialogTitle>
          <DialogDescription>{t("sidebar.enterNewSessionName")}</DialogDescription>
        </DialogHeader>
        <div>
          <Input
            autoFocus
            className="h-8 text-xs! text-foreground/70"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            // placeholder 展示清空后会回落到的那份 Agent / 自动标题。
            placeholder={session?.title || t("sidebar.newSession", "New Session")}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          <p className="mt-1.5 text-[11px] leading-snug text-foreground/45">
            {t("sidebar.sessionNameResetHint", "Leave empty to fall back to the automatic title.")}
          </p>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onClose}>
            {t("sidebar.cancel")}
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={onSubmit}>
            {t("sidebar.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
