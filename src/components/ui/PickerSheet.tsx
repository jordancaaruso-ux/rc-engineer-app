"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterExit } from "@/components/ui/Collapse";
import {
  countOptions,
  filterOptionSections,
  PICKER_SEARCH_THRESHOLD,
  type OptionSection,
  type SearchableOption,
} from "@/lib/search/optionSearch";

/**
 * The app's long-list picker: a trigger that opens a searchable bottom sheet.
 *
 * Every picker was a native `<select>` (2026-07-14, for the iOS feel) and this
 * is a deliberate walk-back of that for *long* lists only, not of the decision
 * behind it. On iPhone a native `<select>` is a five-row wheel: thirty-odd tire
 * compounds, or every track you've ever run, means spinning blind past your own
 * entry to find it, with no way to type. That is the complaint this fixes.
 * Short lists keep the native menu, which is still the better control there —
 * see `SearchableSelect`, which picks between the two on list length.
 *
 * What this is *not* is the floating search-combobox the native rewrite killed:
 * a portalled popover pinned to its trigger with JS, which lagged the
 * compositor and rubber-banded on iOS touch scroll. Nothing here is pinned to
 * anything. The sheet owns the bottom of the viewport at a fixed height, the
 * page underneath is scroll-locked, and the only scroller is the list itself
 * with `overscroll-contain` so a flick can't chain out to the page. Same
 * construction as the Ideas and Upload sheets, which do hold up on iOS.
 */

/**
 * The strip of screen the user can actually see, tracked live.
 *
 * iOS resizes and pans the *visual* viewport when the keyboard opens, but a
 * `fixed` sheet is laid out against the *layout* viewport — which doesn't move.
 * Left alone, tapping the search field slides the bottom half of the sheet,
 * i.e. the list you are searching, behind the keyboard. Sizing the overlay to
 * the visual viewport instead keeps the whole sheet in what's left of the
 * screen, so results stay visible while you type.
 *
 * Returns `null` where `visualViewport` isn't available — the sheet then falls
 * back to plain `inset-0`, which is correct everywhere without a soft keyboard.
 */
function useVisualViewportBox(active: boolean): { top: number; height: number } | null {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    if (!active) {
      setBox(null);
      return;
    }
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const update = () => setBox({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return box;
}

/** The closed state: a full-width field that looks like the `<select>` it replaced. */
export function PickerTrigger({
  onClick,
  disabled,
  open,
  "aria-label": ariaLabel,
  className,
  mono = false,
  placeholder = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  open: boolean;
  "aria-label"?: string;
  /** Surface classes — call sites match whatever card they sit in. */
  className?: string;
  mono?: boolean;
  /** Render the label as a placeholder (nothing chosen yet). */
  placeholder?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={cn(
        "tap-active flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none transition-colors disabled:opacity-60",
        !disabled && "hover:bg-muted/40",
        className
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          mono && "tabular-nums",
          placeholder ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {children}
      </span>
      <ChevronDown className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
    </button>
  );
}

export function PickerSheet<T extends SearchableOption>({
  open,
  onClose,
  title,
  value,
  onSelect,
  sections,
  searchPlaceholder = "Search…",
  clearRow = null,
  footer = null,
  panel = null,
  panelTitle,
  emptyAction,
  searchAction,
  mono = false,
  searchable,
  multiple = null,
}: {
  open: boolean;
  onClose: () => void;
  /** Sheet heading — usually the field's own label. */
  title: string;
  value: string;
  onSelect: (value: string) => void;
  /**
   * Multi-select mode: rows tick from `values` instead of `value`, tapping a row calls
   * `onSelect` with no expectation of closing, and a Done button ends the visit. The
   * clear row (if any) means "none of these". Built for the sessions filter rail,
   * where Cars / Tracks / Tires are sets, not a single choice.
   */
  multiple?: { values: string[]; doneLabel?: string } | null;
  /** Unfiltered and pre-grouped; the sheet does the searching. */
  sections: OptionSection<T>[];
  searchPlaceholder?: string;
  /** A row above the list that clears the field ("None", "No layout"). */
  clearRow?: { label: string } | null;
  /**
   * Sticky footer action, e.g. "+ Add new tire type…". Given the live query so
   * a create row can hand what was typed straight to its form.
   */
  footer?: ReactNode | ((query: string) => ReactNode);
  /** When set, replaces search + list entirely (an inline create form). */
  panel?: ReactNode;
  panelTitle?: string;
  /** Offered under "Nothing matches …" — usually create-with-this-name. */
  emptyAction?: (query: string) => ReactNode;
  /**
   * A "+" at the right-hand end of the search row, carrying whatever has been typed. Replaces
   * the sticky footer on the pickers that can create: one action, at the end of the bar you are
   * already using, instead of a row competing for the last line of the sheet.
   *
   * Providing it forces the search row on regardless of list length. Without that, the picker
   * that needs creating most — the one with four tracks in it — is exactly the one that hides
   * the bar the + lives in, which is how the 2026-08-13 dead end got measured in the first place.
   *
   * `label` is the button's accessible name; the glyph alone says nothing to a screen reader.
   */
  searchAction?: { label: string; onAction: (query: string) => void };
  mono?: boolean;
  /** Force the search field on or off. Unset = decided by list length. */
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  // Keeps the sheet mounted through its slide-down close so the exit animates.
  const sheet = useEnterExit(open, 300);
  const viewportBox = useVisualViewportBox(sheet.mounted);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Every open starts from a clean search — a stale query from last time reads
  // as an empty catalog.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const visible = useMemo(() => filterOptionSections(query, sections), [query, sections]);
  const resultCount = countOptions(visible);
  const trimmedQuery = query.trim();
  const showingPanel = panel != null;

  // A catalog picker still earns the sheet at four rows — bigger targets, a real
  // create affordance, a "None" that isn't a wheel entry. What it doesn't earn is
  // a search field, or 85% of the screen to show four things in.
  const totalOptions = useMemo(() => countOptions(sections), [sections]);
  const showSearch = searchable ?? (searchAction != null || totalOptions > PICKER_SEARCH_THRESHOLD);

  /**
   * Focus the search only where focusing is free.
   *
   * On a phone, focus means the keyboard, and the keyboard would cover the list
   * — including "Recently used", which is the answer most of the time and needs
   * no typing at all. On a mouse-and-keyboard machine there is no such cost and
   * a picker you can't immediately type into feels broken, so the query gates on
   * the input being a fine pointer rather than on a screen-width breakpoint.
   */
  useEffect(() => {
    if (!sheet.mounted || showingPanel || !showSearch) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    searchRef.current?.focus();
  }, [sheet.mounted, showingPanel, showSearch]);

  /**
   * Open onto the entry that's already chosen, not onto the letter A.
   *
   * Alphabetical order puts most of a long list above whatever you picked last
   * time, so an unscrolled list is a list that looks like nothing is selected —
   * the tick is real but three screens down. Centring it answers "what am I on?"
   * before the user has to do anything, which is the other half of the scrolling
   * complaint.
   *
   * Positions are read off the scroller rather than `scrollIntoView` because the
   * sheet is mid-slide when this runs: the panel still carries a transform, and
   * `scrollIntoView` resolves that into the wrong offset (or scrolls the page
   * behind it). `offsetTop` against a positioned scroller is transform-proof.
   */
  useEffect(() => {
    if (!sheet.mounted || showingPanel) return;
    const list = listRef.current;
    const row = selectedRowRef.current;
    if (!list) return;
    if (trimmedQuery || !row) {
      // A fresh search always reads from the top match down.
      list.scrollTop = 0;
      return;
    }
    list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2);
  }, [sheet.mounted, showingPanel, trimmedQuery, value, visible]);

  // Escape closes; the page underneath is frozen so a flick that escapes the
  // list can't scroll the form out from behind the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!sheet.mounted || typeof document === "undefined") return null;

  const isSelected = (v: string) =>
    multiple ? (v === "" ? multiple.values.length === 0 : multiple.values.includes(v)) : v === value;
  // In multi mode every row wears a box, so the list reads as tick-any rather than pick-one.
  const tickFor = (selected: boolean) =>
    multiple ? (
      <span
        className={cn(
          "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
          selected ? "border-foreground bg-foreground text-background" : "border-foreground/35"
        )}
        aria-hidden
      >
        {selected ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
    ) : selected ? (
      <Check className="size-4 shrink-0 text-primary-ink" strokeWidth={2.5} aria-hidden />
    ) : null;

  const rowClass = (selected: boolean, disabled: boolean) =>
    cn(
      "tap-active flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left text-sm transition-colors",
      mono && "tabular-nums text-[13px]",
      disabled && "pointer-events-none opacity-40",
      selected ? "bg-primary/10 font-semibold text-foreground" : "text-foreground hover:bg-muted/60"
    );

  // Portaled to <body>: these pickers sit inside cards, and any transformed or
  // backdrop-blurred ancestor would quietly turn `fixed` into `absolute` and
  // strand the sheet mid-page. Client-only by construction — `open` starts
  // false, so nothing mounts during SSR.
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[70] flex items-end justify-center bg-black/50 transition-opacity duration-300 ease-out motion-reduce:transition-none sm:items-center",
        sheet.entered ? "opacity-100" : "opacity-0"
      )}
      style={viewportBox ? { top: viewportBox.top, height: viewportBox.height, bottom: "auto" } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className={cn(
          // `max-h-full` is what lets the keyboard shrink it: the overlay is sized
          // to the visible strip, so the sheet clamps to that instead of keeping
          // 85% of a screen it can no longer see.
          "flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-card/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-transform duration-300 ease-out motion-reduce:transition-none sm:rounded-2xl sm:pb-2",
          // A searchable list takes a fixed tall frame so it doesn't resize under
          // the finger as results narrow; a short one hugs its rows instead of
          // opening a mostly-empty sheet.
          showSearch ? "h-[min(85dvh,40rem)]" : "max-h-[min(85dvh,40rem)]",
          sheet.entered ? "translate-y-0" : "translate-y-full sm:translate-y-4"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-3 sm:hidden">
          <div className="mx-auto h-1 w-9 rounded-full bg-white/15" aria-hidden />
        </div>
        <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-2.5">
          <h2 className="min-w-0 truncate text-[15px] font-bold tracking-tight text-foreground">
            {showingPanel ? (panelTitle ?? title) : title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-active -mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {showingPanel ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 pt-1">
            {panel}
          </div>
        ) : (
          <>
            {showSearch ? (
            <div className="px-4 pb-2 pt-1">
              <div className="search-row-composite flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 transition-colors focus-within:border-ring/45">
                <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // Escape clears first and closes second — the same two-stage
                    // escape every search field on iOS has.
                    if (e.key !== "Escape") return;
                    e.preventDefault();
                    if (query) setQuery("");
                    else onClose();
                  }}
                  type="text"
                  inputMode="search"
                  enterKeyHint="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="tap-active -mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  >
                    <X className="size-4" strokeWidth={2} aria-hidden />
                  </button>
                ) : null}
                {/* Last thing in the row, after the clear ×, and filled rather than ghosted: two
                    icon buttons in one box directly under the sheet's own close × would otherwise
                    read as a pair of dismissals. Yellow is the app's action colour, so the one
                    that isn't a dismissal is the one that's painted. */}
                {searchAction ? (
                  <button
                    type="button"
                    onClick={() => searchAction.onAction(query.trim())}
                    aria-label={searchAction.label}
                    title={searchAction.label}
                    className="tap-active -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md primary-face bg-primary text-primary-foreground transition hover:brightness-105"
                  >
                    <Plus className="size-4" strokeWidth={2.75} aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
            ) : null}

            <div className="sr-only" role="status" aria-live="polite">
              {trimmedQuery
                ? `${resultCount} result${resultCount === 1 ? "" : "s"} for ${trimmedQuery}`
                : ""}
            </div>

            {/* The only scroller in the sheet. `overscroll-contain` stops a flick
                past either end from chaining out to the page — the iOS behaviour
                that made the old floating combobox feel loose. `relative` makes
                this the offsetParent of every row, which is what lets the
                centring effect above measure it. */}
            <div
              ref={listRef}
              className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
              role="listbox"
              aria-label={title}
            >
              {/* The clear row sits above the results and out of the search — it
                  isn't an option, it's the way back to none. */}
              {clearRow && !trimmedQuery ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected("")}
                  ref={isSelected("") ? selectedRowRef : undefined}
                  onClick={() => onSelect("")}
                  className={cn(rowClass(isSelected(""), false), "text-muted-foreground")}
                >
                  <span className="min-w-0 flex-1 truncate">{clearRow.label}</span>
                  {tickFor(isSelected(""))}
                </button>
              ) : null}

              {resultCount === 0 ? (
                <div className="px-3 py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    {trimmedQuery ? `Nothing matches “${trimmedQuery}”.` : "Nothing to pick yet."}
                  </p>
                  {emptyAction ? <div className="mt-3">{emptyAction(trimmedQuery)}</div> : null}
                </div>
              ) : (
                visible.map((section) => (
                  <div key={section.key} role="group" aria-label={section.label ?? title}>
                    {section.label ? (
                      <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {section.label}
                      </div>
                    ) : null}
                    {section.options.map((o) => {
                      const selected = isSelected(o.value);
                      return (
                        <button
                          key={o.value}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={o.disabled}
                          ref={selected ? selectedRowRef : undefined}
                          onClick={() => onSelect(o.value)}
                          className={rowClass(selected, Boolean(o.disabled))}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{o.label}</span>
                            {o.detail ? (
                              <span className="block truncate text-[11.5px] font-normal text-muted-foreground">
                                {o.detail}
                              </span>
                            ) : null}
                          </span>
                          {tickFor(selected)}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {footer && resultCount > 0 ? (
              <div className="border-t border-white/10 px-2 pt-1.5">
                {typeof footer === "function" ? footer(trimmedQuery) : footer}
              </div>
            ) : null}

            {multiple ? (
              <div className="border-t border-white/10 px-3 pb-1 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="tap-active w-full rounded-md primary-face bg-primary px-3 py-2.5 text-[13px] font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  {multiple.doneLabel ?? "Done"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
