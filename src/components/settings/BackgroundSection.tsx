"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";
import {
  BG_PREVIEW_DEFAULT_ID,
  BG_PREVIEW_OPTIONS,
  type BgPreviewId,
  applyBgPreviewToDocument,
  readStoredBgPreviewId,
  storeBgPreviewId,
} from "@/lib/appThemePreview";

/**
 * Background picker — swaps what paints behind every page, live, on tap.
 *
 * Pure CSS: the choice is one `data-bg-preview` attribute on <html> (see the
 * background-mode block in globals.css), stored in localStorage and re-applied
 * before paint by the bootstrap in layout.tsx. Per-device, never synced, no DB
 * write — so this is safe to flick through mid-session on the phone.
 *
 * The card is unstyled by design: it sits on the background you're judging.
 */
export function BackgroundSection() {
  // Start on the default so SSR and first client paint agree; the real value is
  // read after mount. The background itself is already correct pre-paint (the
  // bootstrap set the attribute), so only the tick mark settles in.
  const [active, setActive] = useState<BgPreviewId>(BG_PREVIEW_DEFAULT_ID);

  useEffect(() => {
    setActive(readStoredBgPreviewId());
  }, []);

  function select(id: BgPreviewId) {
    setActive(id);
    applyBgPreviewToDocument(id);
    storeBgPreviewId(id);
  }

  return (
    <CardPanel className="mt-10">
      <h2 className="text-sm font-semibold text-foreground">Background</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Changes instantly across the app so you can judge it on a real page. Saved on
        this device only — it doesn’t sync or change anyone else’s view.
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-2">
        {BG_PREVIEW_OPTIONS.map((opt) => {
          const selected = active === opt.id;
          return (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => select(opt.id)}
                aria-pressed={selected}
                className={cn(
                  "tap-active flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition",
                  selected
                    ? "border-primary/50 bg-primary/10"
                    : "border-border bg-muted/30 hover:border-border hover:bg-muted/60"
                )}
              >
                <span
                  className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border"
                  style={{ backgroundColor: opt.hex }}
                  aria-hidden
                >
                  {opt.swatchImage ? (
                    <span
                      className="absolute inset-0"
                      style={{ background: opt.swatchImage }}
                    />
                  ) : null}
                  {selected ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Check className="h-4 w-4 text-primary" />
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "ui-title block truncate text-xs",
                      selected ? "text-foreground" : "text-foreground/90"
                    )}
                  >
                    {opt.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">
                    {opt.hint}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </CardPanel>
  );
}
