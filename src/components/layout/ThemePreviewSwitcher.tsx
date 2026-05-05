"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  THEME_PREVIEW_OPTIONS,
  THEME_PREVIEW_STORAGE_KEY,
  type ThemePreviewId,
  applyThemePreviewToDocument,
  readStoredThemePreviewId,
} from "@/lib/appThemePreview";

type ThemePreviewSwitcherProps = {
  /** `floating` = fixed bottom-left; `sidebar` = inline block under nav (e.g. below Settings). */
  placement?: "floating" | "sidebar";
};

/**
 * Theme lab: swaps CSS variables on `<html>` for the default look or near-black / Runna preview palettes.
 */
export function ThemePreviewSwitcher({ placement = "floating" }: ThemePreviewSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ThemePreviewId>("default");
  const mounted = useRef(false);
  const isSidebar = placement === "sidebar";

  useLayoutEffect(() => {
    const id = readStoredThemePreviewId();
    setActive(id);
    applyThemePreviewToDocument(id);
    mounted.current = true;
  }, []);

  useEffect(() => {
    if (!mounted.current) return;
    applyThemePreviewToDocument(active);
    try {
      window.localStorage.setItem(THEME_PREVIEW_STORAGE_KEY, active);
    } catch {
      /* ignore */
    }
  }, [active]);

  function select(id: ThemePreviewId) {
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
          aria-label="Theme preview"
        >
          <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Theme preview (local only)
          </div>
          <ul className="mt-1 space-y-0.5">
            {THEME_PREVIEW_OPTIONS.map((opt) => {
              const selected = active === opt.id;
              return (
                <li key={opt.id}>
                  <button
                    type="button"
                    onClick={() => select(opt.id)}
                    className={cn(
                      "flex w-full flex-col items-start rounded-md border px-2.5 py-2 text-left text-xs transition",
                      selected
                        ? "border-accent/50 bg-accent/10 text-foreground"
                        : "border-transparent bg-muted/40 text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground"
                    )}
                  >
                    <span className="font-semibold text-foreground/95">{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground">{opt.hint}</span>
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
          "hover:border-accent/40 hover:bg-muted/80 hover:text-foreground",
          open && "border-accent/50 text-foreground",
          isSidebar
            ? "order-1 flex w-full items-center justify-between gap-2 rounded-lg bg-card/90 px-3 py-1.5 text-left text-sm"
            : "flex h-11 w-11 items-center justify-center rounded-full bg-card/90"
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? "Close theme preview" : "Open theme preview"}
        title="Theme preview"
      >
        {isSidebar ? (
          <>
            <span className="flex items-center gap-2 min-w-0">
              <Palette className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate font-bold italic uppercase tracking-tight text-foreground/90">
                Theme
              </span>
            </span>
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
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
