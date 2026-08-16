"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import type { SetupEditorSave } from "@/components/setup/useSetupEditorSave";

/**
 * The save controls for a setup editor. Identical for the grid and the sheet, so they live once.
 *
 * ============================== WHY IT FLOATS ==============================
 *
 * Nothing autosaves any more (founder call, 2026-08-16), so this is the only way values reach the
 * database — and the grid editor is a genuinely tall page (measured: 1914px of document against an
 * 844px viewport on a 390px phone). In the flow of the page the button sat at y=1762 on load: off
 * screen, on a page whose whole job is now to be saved deliberately.
 *
 * ============================== WHY NOT `position: sticky` ==============================
 *
 * It cannot work here, and the reason is already written down in `AppShell`. `.app-shell` is
 * `overflow-x: hidden`, and the spec computes `overflow-y` from `visible` to `auto` to match — so
 * the shell is a scrollport that never actually scrolls, because the document does. A sticky
 * element inside it resolves its offsets against that stationary box and simply scrolls away.
 * `TopRail` was moved out of the shell for exactly this; measured here, a `sticky bottom` bar sat
 * inert at the end of the page and only came into view at the very bottom of the scroll.
 *
 * So it is `position: fixed`, portalled to `<body>` — out of `.app-shell`, which is also what keeps
 * fixed positioning from being clipped on iOS (see `AppShell`, and `ActionToast`, which is placed
 * the same way for the same reasons).
 *
 * ============================== THE SPACER ==============================
 *
 * A fixed bar covers the last rows of whatever it floats over, so an equal-height spacer is left
 * behind in the flow. It is MEASURED rather than guessed: the bar is one line tall in some modes
 * and three in others (two buttons, a status, and a sentence explaining the mode), and a hard-coded
 * padding would be wrong in most of them.
 *
 * ============================== THE UNSAVED MARKER ==============================
 *
 * The other half of losing autosave. It is the only thing standing between an edit and an in-app
 * Back — a client-side navigation the browser never announces, so the `beforeunload` prompt armed
 * in the hook cannot catch it.
 *
 * It is a STATE CHANGE, not a label. With nothing changed the bar is grey and says nothing at all:
 * no count, no "Saved" left over from last time, and the primary door steps down to an outline,
 * because writing zero changes over a setup does nothing. The first real edit turns the whole panel
 * amber and fills the primary yellow — a change across the full width of the screen, which the eye
 * catches from the box it is typing in. Eleven pixels of text in the corner did not (founder,
 * 2026-08-16).
 *
 * The fork keeps its fill even at zero (`loudWhenClean`): copying a setup exactly as it stands is
 * the whole point of that door.
 */

/** Above `IdeasEdgeTab` (z-40) so the bar covers it cleanly; below the dock (z-50), which wins. */
const BAR_Z = "z-[45]";

export function SetupEditorSaveBar({ save }: { save: SetupEditorSave }) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);

  useEffect(() => setMounted(true), []);

  // Layout effect + observer: the note and the status line change the height as the driver works,
  // and the spacer has to follow or the last field slides under the bar mid-edit.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const measure = () => setPanelHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  const button = (
    action: NonNullable<SetupEditorSave["secondary"]>,
    variant: "primary" | "secondary"
  ) => {
    /*
     * The primary door is only filled when pressing it would do something: there is a change to
     * write, a save already running, or the door is the fork, which means something at zero. The
     * second door is never filled — two yellow buttons name no default.
     */
    const loud =
      variant === "primary" && (save.dirty || save.busy || action.loudWhenClean === true);
    return (
      <button
        type="button"
        onClick={() => void action.run()}
        disabled={save.busy}
        // Which door is LOUD is the whole of this feature, and it is a paint decision no accessible
        // name can express — so it is stated in the DOM for the suite that pins it.
        data-setup-save={variant}
        data-loud={loud ? "" : undefined}
        className={cn(
          "tap-active rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
          loud
            ? "bg-primary text-primary-foreground hover:opacity-90"
            : "border border-border bg-card hover:bg-muted"
        )}
      >
        {save.busy ? action.busyLabel : action.label}
      </button>
    );
  };

  const bar = (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 flex justify-center px-4",
        // `--mobile-tab-bar-height` is the dock's own published height, and `<main>` already pads
        // itself by it — so clearing the dock is that constant plus the safe area, nothing measured.
        "pb-[calc(var(--mobile-tab-bar-height)_+_env(safe-area-inset-bottom)_+_0.5rem)] md:pb-4",
        BAR_Z
      )}
    >
      <div
        ref={panelRef}
        /*
         * `setup-save-panel` is a plain selector in `globals.css`, not utilities: the amber state
         * has to stay OPAQUE (it floats over the sheet), so the wash is a flat gradient layered on
         * the solid background rather than a translucent fill, and it carries the one-shot wake
         * animation with it. Neither is expressible as a Tailwind class here.
         */
        className={cn(
          "setup-save-panel pointer-events-auto w-full max-w-4xl space-y-1 rounded-xl border border-border bg-background px-3 py-2 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.7)]",
          save.dirty && "setup-save-panel--dirty"
        )}
        data-dirty={save.dirty ? "" : undefined}
      >
        <div className="flex min-h-8 flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {button(save.primary, "primary")}
            {save.secondary ? button(save.secondary, "secondary") : null}
          </div>
          {/* `ml-auto` and not `justify-between`: when this group wraps at 390px it must stay on
              the right edge, or Rename lands alone at the left margin as a stray link. */}
          <div className="ml-auto flex items-center gap-2">
            {/*
              The coloured states spell their own type out instead of wearing `.ui-caption`. That
              class is `@apply text-[11px] leading-snug text-muted-foreground` — a plain selector
              carrying a colour, which beats the `text-warning`/`text-destructive` utility beside
              it. Measured: the unsaved marker painted muted grey, and the error text had been
              silently grey since this bar was written.
            */}
            {save.status === "error" ? (
              <span className="text-[11px] leading-snug text-destructive">{save.error}</span>
            ) : save.busy ? (
              <span className="ui-caption">Saving…</span>
            ) : save.dirty ? (
              /*
               * Warning, not muted: this is the one state where walking away costs the driver
               * something. Yellow is reserved for actions, so the colour cannot come from `primary`.
               *
               * The COUNT, not "Unsaved changes": it says how much is riding on the press, and it is
               * the half of the sentence that can shrink — undo an edit and it falls, put every
               * number back and the line disappears with the amber. A fixed phrase can only sit
               * there until a save, which is what made the old one easy to stop seeing.
               */
              <span className="text-[13px] font-semibold leading-snug text-warning tabular-nums">
                {save.changedCount === 1 ? "1 change" : `${save.changedCount} changes`}
              </span>
            ) : save.status === "saved" ? (
              <span className="ui-caption">Saved</span>
            ) : null}
            {save.rename ? (
              <button
                type="button"
                onClick={() => void save.rename?.()}
                disabled={save.busy}
                className="tap-active rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              >
                Rename
              </button>
            ) : null}
          </div>
        </div>
        {save.note ? <p className="ui-caption px-0.5">{save.note}</p> : null}
      </div>
    </div>
  );

  return (
    <>
      {/* Holds the bar's place in the flow so the last row of the editor is never underneath it. */}
      <div aria-hidden style={{ height: panelHeight }} />
      {mounted ? createPortal(bar, document.body) : null}
    </>
  );
}
