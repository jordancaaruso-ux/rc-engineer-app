"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Extra text matched by the search box (not shown). */
  keywords?: string;
};

export type SearchableSelectGroup = {
  label: string;
  options: SearchableSelectOption[];
};

/**
 * Keeps a portal-rendered menu pinned under its anchor. Fixed positioning +
 * capture-phase scroll listener so the menu escapes any `overflow`/`backdrop-blur`
 * stacking context of ancestor cards (the reason a plain absolute menu renders
 * *behind* the glass Setup card).
 */
export function useAnchoredMenuPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>
): { top: number; left: number; width: number } | null {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef]);
  return pos;
}

/** Shared menu shell so every dropdown reads as one system (matches AdditiveTypeCombobox). */
export const SEARCHABLE_MENU_CLASS =
  "max-h-64 overflow-auto rounded-md border border-border bg-background shadow-lg text-sm";

function flattenGroups(
  options?: SearchableSelectOption[],
  groups?: SearchableSelectGroup[]
): SearchableSelectOption[] {
  if (groups?.length) return groups.flatMap((g) => g.options);
  return options ?? [];
}

/**
 * Combobox in the AdditiveTypeCombobox style: the visible line *is* the search
 * input (type to filter — no second search bar inside the menu). Menu renders in
 * a portal so glass-card stacking contexts can't cover it. `searchable={false}`
 * swaps the input for a plain click-to-pick trigger (short enum lists).
 * One font size throughout: text-sm on both the line and menu rows.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  groups,
  placeholder = "Select…",
  "aria-label": ariaLabel,
  disabled,
  className,
  searchable = true,
  clearable = false,
  clearLabel = "—",
  triggerMono = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options?: SearchableSelectOption[];
  groups?: SearchableSelectGroup[];
  placeholder?: string;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
  searchable?: boolean;
  clearable?: boolean;
  clearLabel?: string;
  /** Render the selected label + options in mono (for setup/document lists). */
  triggerMono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const pos = useAnchoredMenuPosition(open, anchorRef);

  const allOptions = useMemo(() => flattenGroups(options, groups), [options, groups]);
  const selected = useMemo(
    () => allOptions.find((o) => o.value === value) ?? null,
    [allOptions, value]
  );

  // Only filter while the user is actually typing a query (searchable mode).
  const q = searchable && open ? query.trim().toLowerCase() : "";
  const matches = (o: SearchableSelectOption) =>
    !q ||
    o.label.toLowerCase().includes(q) ||
    (o.keywords ? o.keywords.toLowerCase().includes(q) : false);

  const filteredGroups = useMemo<SearchableSelectGroup[]>(() => {
    if (groups?.length) {
      return groups
        .map((g) => ({ label: g.label, options: g.options.filter(matches) }))
        .filter((g) => g.options.length > 0);
    }
    return [{ label: "", options: (options ?? []).filter(matches) }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, options, q]);

  const flatFiltered = useMemo(
    () => filteredGroups.flatMap((g) => g.options),
    [filteredGroups]
  );

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function commit(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  function openMenu() {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setHighlight(0);
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return openMenu();
      setHighlight((i) => Math.min(i + 1, flatFiltered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const opt = flatFiltered[highlight];
      if (opt && !opt.disabled) commit(opt.value);
    }
  }

  const chevron = (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={cn(
        "pointer-events-none h-4 w-4 shrink-0 text-muted-foreground transition",
        open && "rotate-180"
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <>
      <div ref={anchorRef} className={cn("relative w-full", className)}>
        {searchable ? (
          <>
            <input
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-label={ariaLabel}
              disabled={disabled}
              placeholder={selected ? selected.label : placeholder}
              value={open ? query : selected?.label ?? ""}
              className={cn(
                "form-control w-full px-3 py-2 pr-8 text-sm disabled:opacity-60",
                triggerMono && "font-mono",
                !open && !selected && "text-muted-foreground"
              )}
              onFocus={() => {
                if (!open) openMenu();
              }}
              onClick={() => {
                if (!open) openMenu();
              }}
              onChange={(e) => {
                if (!open) setOpen(true);
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={onTriggerKeyDown}
            />
            <span className="absolute inset-y-0 right-2.5 flex items-center">{chevron}</span>
          </>
        ) : (
          <button
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={ariaLabel}
            onClick={() => (open ? setOpen(false) : openMenu())}
            onKeyDown={(e) => {
              if (disabled) return;
              if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                openMenu();
              } else {
                onTriggerKeyDown(e);
              }
            }}
            className={cn(
              "form-control flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm disabled:opacity-60"
            )}
          >
            <span
              className={cn(
                "min-w-0 truncate",
                !selected && "text-muted-foreground",
                triggerMono && selected && "font-mono"
              )}
            >
              {selected ? selected.label : placeholder}
            </span>
            {chevron}
          </button>
        )}
      </div>

      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 60 }}
            >
              <div className={SEARCHABLE_MENU_CLASS}>
                <ul role="listbox" id={listboxId}>
                  {clearable ? (
                    <li>
                      <button
                        type="button"
                        role="option"
                        aria-selected={!value}
                        className={cn(
                          "w-full px-3 py-2 text-left text-sm hover:bg-muted",
                          !value && "bg-accent/10"
                        )}
                        onClick={() => commit("")}
                      >
                        {clearLabel}
                      </button>
                    </li>
                  ) : null}
                  {flatFiltered.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">No matches.</li>
                  ) : null}
                  {filteredGroups.map((g) => (
                    <li key={g.label || "_"}>
                      {g.label ? (
                        <div className="px-3 pt-2 pb-1 type-data-label text-muted-foreground">
                          {g.label}
                        </div>
                      ) : null}
                      <ul>
                        {g.options.map((o) => {
                          const idx = flatFiltered.indexOf(o);
                          return (
                            <li key={o.value}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={value === o.value}
                                disabled={o.disabled}
                                className={cn(
                                  "w-full px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-40",
                                  triggerMono && "font-mono",
                                  idx === highlight && "bg-muted/80",
                                  value === o.value && "bg-accent/10"
                                )}
                                onMouseEnter={() => setHighlight(idx)}
                                onClick={() => !o.disabled && commit(o.value)}
                              >
                                {o.label}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
