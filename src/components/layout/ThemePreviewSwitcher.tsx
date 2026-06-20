"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BG_PREVIEW_OPTIONS,
  BG_PREVIEW_STORAGE_KEY,
  type BgPreviewId,
  applyBgPreviewToDocument,
  readStoredBgPreviewId,
} from "@/lib/appThemePreview";

type ThemePreviewSwitcherProps = {
  /** `floating` = fixed bottom-left; `sidebar` = inline block under nav (e.g. below Settings). */
  placement?: "floating" | "sidebar";
};

/** Dev background preview — same storage as Settings → Background preview. */
export function ThemePreviewSwitcher({ placement = "floating" }: ThemePreviewSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<BgPreviewId>("espresso");
  const mounted = useRef(false);
  const isSidebar = placement === "sidebar";

  useLayoutEffect(() => {
    const id = readStoredBgPreviewId();
    setActive(id);
    applyBgPreviewToDocument(id);
    mounted.current = true;
  }, []);

  useEffect(() => {
    if (!mounted.current) return;
    applyBgPreviewToDocument(active);
    try {
      window.localStorage.setItem(BG_PREVIEW_STORAGE_KEY, active);
    } catch {
      /* ignore */
    }
  }, [active]);

  function select(id: BgPreviewId) {
    setActive(id);
    setOpen(false);
  }

  return (
    <div
      className={cn(
        "z-[200] flex flex-col gap-1",
        isSidebar
          ? "relative w-full items-stretch pt-1"
          : cn(
              "fixed items-start",
              "left-[max(1rem,env(safe-area-inset-left))]",
              "bottom-[max(1rem,env(safe-area-inset-bottom))]"
            )
      )}
    >
      {open ? (
        <div
          className={cn(
            "rounded-lg border border-border bg-card/95 p-2 shadow-lg backdrop-blur-md",
            isSidebar ? "order-2 w-full" : "mb-1 w-[min(18rem,calc(100vw-2rem))]"
          )}
          role="dialog"
          aria-label="Background preview"
        >
          <div className="px-2 py-1 text-[10px] ui-title text-muted-foreground">
            Background preview (local only)
          </div>
          <ul className="mt-1 space-y-0.5">
            {BG_PREVIEW_OPTIONS.map((opt) => {
              const selected = active === opt.id;
              return (
                <li key={opt.id}>
                  <button
                    type="button"
                    onClick={() => select(opt.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition",
                      selected
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-transparent bg-muted/40 text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground"
                    )}
                  >
                    <span
                      className="h-5 w-5 shrink-0 rounded border border-border"
                      style={{ backgroundColor: opt.hex }}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-foreground/95">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "border border-border text-muted-foreground shadow-md backdrop-blur-md transition",
          "hover:border-primary/40 hover:bg-muted/80 hover:text-foreground",
          open && "border-primary/50 text-foreground",
          isSidebar
            ? "order-1 flex w-full items-center justify-between gap-2 rounded-lg bg-card/90 px-3 py-1.5 text-left text-sm"
            : "flex h-11 w-11 items-center justify-center rounded-full bg-card/90"
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? "Close background preview" : "Open background preview"}
        title="Background preview"
      >
        {isSidebar ? (
          <>
            <span className="flex items-center gap-2 min-w-0">
              <Palette className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate ui-title text-sm text-foreground/90">Background</span>
            </span>
            <span className="shrink-0 text-[10px] ui-title text-muted-foreground">
              {open ? "Close" : "Preview"}
            </span>
          </>
        ) : (
          <Palette className="h-5 w-5" aria-hidden />
        )}
      </button>
    </div>
  );
}
