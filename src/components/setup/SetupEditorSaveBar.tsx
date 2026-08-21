"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { SetupNameSheet } from "@/components/setup/SetupNameSheet";
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
 *
 * ============================== THE ONE DOOR THAT ASKS SOMETHING ==============================
 *
 * An action carrying a `namePrompt` (the fork, and only the fork) opens `SetupNameSheet` instead of
 * running on press — see the hook for why that reversed on 2026-08-17. Which button is prompting is
 * held as "primary" / "secondary" rather than as the action OBJECT: the hook rebuilds those objects
 * every render, and an object captured in state would close over the `getData` of the render the
 * sheet opened on. The sheet is modal so nothing can be typed behind it today, but a stale reader of
 * the editor's values is the exact bug that made "Save as a new setup" flush its edits into both
 * rows the last time, and it is not worth leaving armed.
 */

/** Above `IdeasEdgeTab` (z-40) so the bar covers it cleanly; below the dock (z-50), which wins. */
const BAR_Z = "z-[45]";

export function SetupEditorSaveBar({
  save,
  hosted = false,
}: {
  save: SetupEditorSave;
  /**
   * Render in the flow of a scrolling container instead of fixed to the viewport — for the
   * run page's setup pop-up (2026-08-21).
   *
   * ============================== WHY THIS DOES NOT CONTRADICT THE HEADER ==============================
   *
   * The "why not sticky" argument above is about `.app-shell` specifically: it is
   * `overflow-x: hidden`, which computes `overflow-y` to `auto`, making it a scrollport that
   * never actually scrolls because the DOCUMENT does. Sticky offsets resolve against that
   * stationary box and the bar scrolls away.
   *
   * `.setup-sheet-modal-panel` is not that. It is `max-h-[90vh] overflow-auto` and genuinely
   * scrolls its own content, so `sticky bottom-0` resolves against a box that really moves and
   * the bar holds the bottom of the pop-up exactly as intended.
   *
   * Fixed positioning is the thing that CANNOT work here: `BAR_Z` is `z-[45]` and the pop-up's
   * overlay is `z-50`, so a portalled bar renders behind the scrim — present, dimmed, and
   * unclickable. Raising the z instead would put a viewport-wide bar across a centred dialog
   * on desktop, which is not the same control.
   *
   * The measured spacer goes with it: nothing floats, so nothing is covered.
   */
  hosted?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  /** Which button is waiting on a name, resolved back to a live action at press time. */
  const [promptFor, setPromptFor] = useState<"primary" | "secondary" | null>(null);

  useEffect(() => setMounted(true), []);

  const promptAction =
    promptFor === "primary" ? save.primary : promptFor === "secondary" ? save.secondary : null;

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
        onClick={() => {
          if (action.namePrompt) setPromptFor(variant);
          else void action.run();
        }}
        disabled={save.busy}
        // Which door is LOUD is the whole of this feature, and it is a paint decision no accessible
        // name can express — so it is stated in the DOM for the suite that pins it.
        data-setup-save={variant}
        data-loud={loud ? "" : undefined}
        className={cn(
          "tap-active rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
          loud
            ? "primary-face bg-primary text-primary-foreground hover:opacity-90"
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
        "flex justify-center",
        hosted
          ? // Sticky inside the pop-up's own scrollport. `bottom-0` with no dock padding: the
            // dock is behind the scrim and cannot be reached from in here anyway.
            "sticky bottom-0 z-10 pointer-events-auto px-0 pb-1 pt-1"
          : cn(
              "pointer-events-none fixed inset-x-0 bottom-0 px-4",
              // `--mobile-tab-bar-height` is the dock's own published height, and `<main>` already
              // pads itself by it — so clearing the dock is that constant plus the safe area,
              // nothing measured.
              "pb-[calc(var(--mobile-tab-bar-height)_+_env(safe-area-inset-bottom)_+_0.5rem)] md:pb-4",
              BAR_Z
            )
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
      {/* Holds the bar's place in the flow so the last row of the editor is never underneath it.
          Hosted, the bar IS in the flow, so there is nothing to hold a place for. */}
      {hosted ? null : <div aria-hidden style={{ height: panelHeight }} />}
      {hosted ? bar : mounted ? createPortal(bar, document.body) : null}
      {promptAction?.namePrompt ? (
        <SetupNameSheet
          open
          title={promptAction.namePrompt.title}
          detail={promptAction.namePrompt.detail}
          suggestedName={promptAction.namePrompt.suggestedName}
          confirmLabel={promptAction.namePrompt.confirmLabel}
          busy={save.busy}
          // The bar's own error line is behind the scrim, so a failed save has to say so in here.
          error={save.status === "error" ? save.error : null}
          onCancel={() => {
            if (!save.busy) setPromptFor(null);
          }}
          onConfirm={(name) => {
            // Closed only on success — a failure keeps the sheet up with the typed name in it.
            void promptAction.run(name).then((ok) => {
              if (ok) setPromptFor(null);
            });
          }}
        />
      ) : null}
    </>
  );
}
