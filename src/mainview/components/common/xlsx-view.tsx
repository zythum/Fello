import { useEffect, useRef, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { useTranslation } from "react-i18next";

export interface XlsxViewProps {
  data: ArrayBuffer;
  filename?: string;
}

/**
 * 将 SheetJS 的工作表渲染为 HTML 表格
 */
function sheetToHtml(ws: XLSX.WorkSheet, _sheetName: string): string {
  const ref = ws["!ref"];
  if (!ref) return "<p class='text-sm text-muted-foreground p-4'>Empty sheet</p>";

  const range = XLSX.utils.decode_range(ref);
  const merges = ws["!merges"] || [];

  // 判断某单元格是否在合并区域中（且不是左上角）
  function isMergedCell(r: number, c: number): boolean {
    return merges.some((m) => {
      if (m.s.r === r && m.s.c === c) return false; // 左上角不隐藏
      return r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c;
    });
  }

  // 获取合并区域的 rowspan/colspan
  function getMergeSpan(r: number, c: number): { rowspan?: number; colspan?: number } | null {
    const merge = merges.find((m) => m.s.r === r && m.s.c === c);
    if (!merge) return null;
    return {
      rowspan: merge.e.r - merge.s.r + 1,
      colspan: merge.e.c - merge.s.c + 1,
    };
  }

  let html = '<table class="xlsx-table" style="border-collapse: collapse; width: 100%;">';

  // 如果有列宽信息，设置 colgroup
  const cols = ws["!cols"];
  if (cols) {
    html += "<colgroup>";
    for (let c = range.s.c; c <= range.e.c; c++) {
      const w = cols[c]?.wpx || cols[c]?.wch ? cols[c]!.wch! * 8 : 80;
      html += `<col style="width: ${Math.max(w, 40)}px" />`;
    }
    html += "</colgroup>";
  }

  // 添加表头（首行作为表头）
  html += "<thead>";
  html += "<tr>";
  for (let c = range.s.c; c <= range.e.c; c++) {
    if (isMergedCell(range.s.r, c)) continue;
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = ws[addr];
    const span = getMergeSpan(range.s.r, c);
    const spanAttr = span
      ? `${span.colspan ? ` colspan="${span.colspan}"` : ""}${span.rowspan ? ` rowspan="${span.rowspan}"` : ""}`
      : "";
    const value = cell && cell.v != null ? String(cell.v) : "";
    html += `<th${spanAttr} class="xlsx-header">${escapeHtml(value)}</th>`;
  }
  html += "</tr>";
  html += "</thead>";

  // 数据行
  html += "<tbody>";
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    if (ws["!rows"]?.[r]?.hidden) continue;
    html += "<tr>";
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (isMergedCell(r, c)) continue;
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      const span = getMergeSpan(r, c);
      const spanAttr = span
        ? `${span.colspan ? ` colspan="${span.colspan}"` : ""}${span.rowspan ? ` rowspan="${span.rowspan}"` : ""}`
        : "";
      const value = cell && cell.v != null ? String(cell.v) : "";
      // 数值右对齐
      const isNum = typeof cell?.v === "number";
      html += `<td${spanAttr} class="${isNum ? "xlsx-num" : "xlsx-text"}">${escapeHtml(value)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  html += "</table>";

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function XlsxView({ data }: XlsxViewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const htmlCache = useRef<string[]>([]);

  const switchSheet = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container || !htmlCache.current[index]) return;
    container.innerHTML = htmlCache.current[index];
    setActiveSheet(index);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      htmlCache.current = [];

      try {
        // 用 SheetJS 解析
        const workbook = XLSX.read(data, { type: "array" });
        if (cancelled) return;

        const names = workbook.SheetNames;
        setSheetNames(names);

        const htmls = names.map((name) => {
          const ws = workbook.Sheets[name];
          return sheetToHtml(ws, name);
        });
        htmlCache.current = htmls;

        if (htmls.length > 0) {
          setActiveSheet(0);
          if (containerRef.current) {
            containerRef.current.innerHTML = htmls[0];
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error("XLSX render error:", err);
          setError(err.message || "Failed to load spreadsheet");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [data]);

  // 加载完成后切换到对应 sheet 的缓存 html
  useEffect(() => {
    if (!loading && htmlCache.current[activeSheet]) {
      switchSheet(activeSheet);
    }
  }, [loading]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {t("fileDetail.loadError", "Failed to load spreadsheet")}: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      {sheetNames.length > 1 && (
        <div className="flex items-center gap-0 px-2 h-10 shrink-0 border-b border-border bg-background/80 backdrop-blur-sm overflow-x-auto">
          {sheetNames.map((name, i) => (
            <button
              key={i}
              type="button"
              onClick={() => switchSheet(i)}
              className={`
                px-3 py-1.5 text-xs whitespace-nowrap rounded-t transition-colors
                ${
                  i === activeSheet
                    ? "bg-background text-foreground border-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }
              `}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto w-full">
        {loading ? (
          <div className="text-sm text-muted-foreground text-center mt-10">
            {t("fileDetail.loading")}
          </div>
        ) : (
          <div
            ref={containerRef}
            className="xlsx-preview"
            style={{ fontSize: "13px", padding: "8px" }}
          />
        )}
      </div>
    </div>
  );
}
