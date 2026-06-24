"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const ITEM_HEIGHT_PX = 35;
const VISIBLE_ITEMS = 3;
const LIST_MAX_HEIGHT_PX = ITEM_HEIGHT_PX * VISIBLE_ITEMS;

export type TireSetSelectOption = {
  id: string;
  label: string;
};

type Props = {
  value: string;
  onChange: (id: string) => void;
  options: TireSetSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
};

export function TireSetSelect({
  value,
  onChange,
  options,
  placeholder = "Select tire set…",
  disabled,
  "aria-label": ariaLabel = "Tire set",
  className,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [canScrollMore, setCanScrollMore] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = "tire-set-select-list";

  const selectedOption = value ? options.find((o) => o.id === value) : null;
  const selectedLabel = selectedOption?.label ?? "";
  const hasScrollableList = options.length > VISIBLE_ITEMS;

  const updateScrollHint = useCallback(() => {
    const el = listRef.current;
    if (!el || !hasScrollableList) {
      setCanScrollMore(false);
      return;
    }
    setCanScrollMore(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  }, [hasScrollableList]);

  useEffect(() => {
    if (!isOpen) return;
    setHighlightIndex(() => {
      if (!value) return 0;
      const idx = options.findIndex((o) => o.id === value);
      return idx >= 0 ? idx : 0;
    });
  }, [isOpen, value, options]);

  useEffect(() => {
    if (!isOpen || highlightIndex < 0) return;
    const el = listRef.current?.children[highlightIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
    updateScrollHint();
  }, [highlightIndex, isOpen, updateScrollHint]);

  useEffect(() => {
    if (!isOpen) return;
    updateScrollHint();
  }, [isOpen, options.length, updateScrollHint]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function select(id: string) {
    onChange(id);
    setIsOpen(false);
  }

  function openList() {
    if (disabled || options.length === 0) return;
    setIsOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled || options.length === 0) return;

    if (!isOpen) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === " " || e.key === "ArrowUp") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i < options.length - 1 ? i + 1 : i));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i > 0 ? i - 1 : 0));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const item = options[highlightIndex];
      if (item) select(item.id);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        className={cn(
          "form-control flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
          !selectedLabel && "text-muted-foreground",
          disabled && "cursor-not-allowed opacity-60"
        )}
        onClick={() => (isOpen ? setIsOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listId}
        disabled={disabled}
      >
        <span className="min-w-0 truncate">{selectedLabel || placeholder}</span>
        <svg
          aria-hidden
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isOpen && options.length > 0 ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-secondary shadow-md text-sm">
          <div className="relative">
            <ul
              id={listId}
              ref={listRef}
              role="listbox"
              aria-label={ariaLabel}
              className="overflow-y-auto py-1"
              style={{ maxHeight: LIST_MAX_HEIGHT_PX }}
              onScroll={updateScrollHint}
            >
              {options.map((option, i) => (
                <li
                  key={option.id}
                  role="option"
                  aria-selected={value === option.id}
                  className={cn(
                    "cursor-pointer truncate px-3 py-2",
                    i === highlightIndex ? "bg-accent/20 text-foreground" : "text-foreground hover:bg-muted"
                  )}
                  style={{ minHeight: ITEM_HEIGHT_PX }}
                  onMouseEnter={() => setHighlightIndex(i)}
                  onClick={() => select(option.id)}
                >
                  {option.label}
                </li>
              ))}
            </ul>
            {canScrollMore ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-secondary via-secondary/80 to-transparent"
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
