import { useCallback, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** 一个候选项：`value` 会写入输入框，`label` 用于展示，`detail` 是右侧的次要说明。 */
export interface AutocompleteOption {
  value: string;
  /** 列表主文本，缺省等于 `value`。 */
  label?: string;
  /** 主文本右侧的次要说明，例如所属 Agent id、命令等。 */
  detail?: string;
}

export interface AutocompleteInputProps extends Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "children" | "onSelect"
> {
  value: string;
  onChange: (value: string) => void;
  /** 候选列表；为空时仍可自由输入。 */
  options: AutocompleteOption[];
  /** 通过下拉选中某一项后的额外回调（例如同时填充 API Key）。 */
  onPick?: (option: AutocompleteOption) => void;
  /** 每次展开面板时触发，用于异步刷新候选。 */
  onOpen?: () => void;
  /**
   * 是否允许展开候选面板，默认 `true`。
   * 异步来源尚未就绪（例如还没有选择 Agent）时可置 `false`，保持纯文本输入。
   */
  canOpen?: boolean;
  /** 没有任何候选时的提示。 */
  emptyHint?: string;
  /** 有候选但输入过滤后无匹配时的提示；缺省复用 `emptyHint`。 */
  noMatchHint?: string;
  loading?: boolean;
  loadingLabel?: string;
  maxVisible?: number;
}

/**
 * 输入框增强：普通文本框 + 候选下拉。
 *
 * 与 Select 的差别是**不强制选择**——候选只作为提示，输入框保留自由输入语义；
 * 数据来源由调用方提供（同步数组或异步 `onOpen` 刷新）。
 */
export function AutocompleteInput({
  value,
  onChange,
  options,
  onPick,
  onOpen,
  canOpen = true,
  emptyHint,
  noMatchHint,
  loading = false,
  loadingLabel,
  maxVisible = 100,
  className,
  disabled,
  ref,
  ...inputProps
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [anchorWidth, setAnchorWidth] = useState<number | null>(null);
  /** 过滤词；null 表示打开时先展示完整列表，不按输入框既有值过滤。 */
  const [query, setQuery] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setInputRef = useCallback(
    (element: HTMLInputElement | null) => {
      inputRef.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );

  const needle = (query ?? "").trim().toLowerCase();
  const filtered = (
    needle
      ? options.filter(
          (option) =>
            option.value.toLowerCase().includes(needle) ||
            (option.label ?? "").toLowerCase().includes(needle) ||
            (option.detail ?? "").toLowerCase().includes(needle),
        )
      : options
  ).slice(0, maxVisible);

  const openList = useCallback(() => {
    if (!canOpen) return;
    setAnchorWidth(containerRef.current?.offsetWidth ?? null);
    setActiveIndex(-1);
    setQuery(null);
    setOpen(true);
    onOpen?.();
  }, [canOpen, onOpen]);

  const closeList = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    setQuery(null);
  }, []);

  const pick = useCallback(
    (option: AutocompleteOption) => {
      onChange(option.value);
      onPick?.(option);
      closeList();
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [closeList, onChange, onPick],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // 输入法组合态下的 Enter / 方向键属于候选词操作，不参与列表导航。
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      closeList();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!canOpen || (!open && filtered.length === 0)) return;
      event.preventDefault();
      if (!open) openList();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        if (current < 0) return delta > 0 ? 0 : filtered.length - 1;
        return (current + delta + filtered.length) % filtered.length;
      });
      return;
    }

    if (event.key === "Enter" && open && activeIndex >= 0) {
      const target = filtered[activeIndex];
      if (!target) return;
      event.preventDefault();
      pick(target);
    }
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <Input
        {...inputProps}
        ref={setInputRef}
        value={value}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className={cn("pr-7", className)}
        autoCorrect="off"
        autoComplete="off"
        onChange={(event) => {
          const next = event.target.value;
          setActiveIndex(-1);
          setQuery(next);
          onChange(next);
          // 组合态（拼音尚未上屏）不弹面板，避免用拼音字母去过滤候选。
          const composing = (event.nativeEvent as InputEvent).isComposing;
          if (!open && canOpen && !composing) {
            setAnchorWidth(containerRef.current?.offsetWidth ?? null);
            setOpen(true);
            onOpen?.();
          }
        }}
        onClick={() => {
          // 点击输入框时打开完整列表（不按已填内容过滤），便于直接换一个值。
          if (!open) openList();
        }}
        onKeyDown={handleKeyDown}
      />
      {loading && (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
          <LoaderCircle className="size-3 animate-spin text-muted-foreground/60" />
        </span>
      )}
      <Popover
        open={open}
        onOpenChange={(next, details) => {
          if (!next) {
            if (details.reason === "outside-press") {
              const target = details.event?.target;
              if (target instanceof Node && containerRef.current?.contains(target)) return;
            }
            closeList();
            return;
          }
          openList();
        }}
      >
        {/*
          仅作为 Popover 的定位锚点：铺满整个输入框容器，保证候选层与输入框边缘对齐。
          不需要可点击（pointer-events-none），展开由 Input 的 onClick / ArrowDown 驱动。
        */}
        <PopoverTrigger
          nativeButton={false}
          tabIndex={-1}
          aria-hidden
          render={<span className="pointer-events-none absolute inset-0" />}
        />
        <PopoverContent
          align="start"
          sideOffset={4}
          initialFocus={() => inputRef.current}
          finalFocus={false}
          role="listbox"
          style={anchorWidth ? { width: anchorWidth } : undefined}
          className="max-h-64 w-auto min-w-40 gap-0 overflow-y-auto p-1"
        >
          {loading && options.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" />
              <span>{loadingLabel}</span>
            </div>
          ) : options.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground/70">{emptyHint}</p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground/70">
              {noMatchHint ?? emptyHint}
            </p>
          ) : (
            filtered.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs outline-none",
                  index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {option.label ?? option.value}
                </span>
                {option.detail && (
                  <span className="shrink-0 truncate text-[10px] text-muted-foreground/60">
                    {option.detail}
                  </span>
                )}
                {option.value === value && <Check className="size-3 shrink-0" />}
              </button>
            ))
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
