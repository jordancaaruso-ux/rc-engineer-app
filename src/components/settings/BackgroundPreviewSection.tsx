"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { cn } from "@/lib/utils";
import {
  BG_PREVIEW_OPTIONS,
  BG_PREVIEW_STORAGE_KEY,
  type BgPreviewId,
  applyBgPreviewToDocument,
  readStoredBgPreviewId,
} from "@/lib/appThemePreview";

export function BackgroundPreviewSection() {
  const [active, setActive] = useState<BgPreviewId>("espresso");
  const mounted = useRef(false);

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

  return (
    <CardPanel className="mt-8">
      <h2 className="text-sm font-semibold text-foreground">Background preview</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Dev tool — saved on this device only. Swaps the flat page background for quick comparison;
        cards, borders, and action yellow stay unchanged.
      </p>
      <div className="mt-4 flex flex-wrap gap-3" role="radiogroup" aria-label="Background preview">
        {BG_PREVIEW_OPTIONS.map((opt) => {
          const selected = active === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setActive(opt.id)}
              className={cn(
                "flex min-w-[5.5rem] flex-col items-center gap-1.5 rounded-lg border px-2 py-2 text-center transition",
                selected
                  ? "border-primary/60 bg-muted/50"
                  : "border-border bg-transparent hover:border-border hover:bg-muted/30"
              )}
            >
              <span
                className={cn(
                  "h-9 w-9 rounded-md border shadow-sm",
                  selected ? "border-primary/70 ring-2 ring-primary/40" : "border-border"
                )}
                style={{ backgroundColor: opt.hex }}
                aria-hidden
              />
              <span className="text-[11px] font-medium text-foreground">{opt.label}</span>
              <span className="text-[10px] leading-tight text-muted-foreground">{opt.hint}</span>
            </button>
          );
        })}
      </div>
    </CardPanel>
  );
}
