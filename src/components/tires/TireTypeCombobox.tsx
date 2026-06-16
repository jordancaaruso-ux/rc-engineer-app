"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { suggestModelCodeFromDisplayName } from "@/lib/tires/matchTireType";

export type TireTypeOption = {
  id: string;
  displayName: string;
  modelCode: string;
};

export function TireTypeCombobox({
  value,
  onChange,
  onSelectedTypeChange,
  placeholder = "Search tire type or create new",
  "aria-label": ariaLabel = "Tire type",
  disabled,
  className,
}: {
  value: string;
  onChange: (tireTypeId: string) => void;
  /** Fires when selection resolves to a full option (including after create). */
  onSelectedTypeChange?: (option: TireTypeOption | null) => void;
  placeholder?: string;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [options, setOptions] = useState<TireTypeOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<TireTypeOption | null>(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newModelCode, setNewModelCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const loadOptions = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const url = q.trim()
        ? `/api/tire-types?q=${encodeURIComponent(q.trim())}&limit=40`
        : "/api/tire-types?limit=40";
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json()) as { tireTypes?: TireTypeOption[] };
      setOptions(data.tireTypes ?? []);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!value) {
      setSelectedOption(null);
      return;
    }
    const fromList = options.find((o) => o.id === value);
    if (fromList) {
      setSelectedOption(fromList);
      onSelectedTypeChange?.(fromList);
      return;
    }
    let cancelled = false;
    fetch(`/api/tire-types?limit=200`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tireTypes?: TireTypeOption[] }) => {
        if (cancelled) return;
        const hit = (d.tireTypes ?? []).find((o) => o.id === value) ?? null;
        setSelectedOption(hit);
        onSelectedTypeChange?.(hit);
      })
      .catch(() => {
        if (!cancelled) onSelectedTypeChange?.(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, options, onSelectedTypeChange]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => {
      void loadOptions(query);
    }, query.trim() ? 150 : 0);
    return () => window.clearTimeout(t);
  }, [isOpen, query, loadOptions]);

  useEffect(() => {
    if (!isOpen) return;
    setHighlightIndex(0);
  }, [isOpen, query, options.length]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowCreate(false);
        setError(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedLabel = selectedOption
    ? `${selectedOption.displayName} (${selectedOption.modelCode})`
    : "";

  const displayValue = isOpen ? query : selectedLabel;
  const showCreateRow =
    query.trim().length > 0 &&
    !options.some(
      (o) =>
        o.displayName.toLowerCase() === query.trim().toLowerCase() ||
        o.modelCode.toLowerCase() === query.trim().toLowerCase()
    );

  function select(id: string, option?: TireTypeOption) {
    onChange(id);
    if (option) {
      setSelectedOption(option);
      onSelectedTypeChange?.(option);
    }
    setQuery("");
    setIsOpen(false);
    setShowCreate(false);
    setError(null);
  }

  async function createTireType(e: React.FormEvent) {
    e.preventDefault();
    const displayName = newDisplayName.trim();
    const modelCode = newModelCode.trim();
    if (!displayName || !modelCode) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/tire-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, modelCode }),
      });
      const data = (await res.json()) as {
        tireType?: TireTypeOption;
        existing?: TireTypeOption;
        error?: string;
      };
      if (res.status === 409 && data.existing) {
        select(data.existing.id, data.existing);
        return;
      }
      if (!res.ok || !data.tireType) {
        setError(data.error ?? "Failed to create tire type");
        return;
      }
      setOptions((prev) => [data.tireType!, ...prev.filter((o) => o.id !== data.tireType!.id)]);
      select(data.tireType.id, data.tireType);
    } catch {
      setError("Failed to create tire type");
    } finally {
      setCreating(false);
    }
  }

  function openCreatePanel() {
    const name = query.trim() || newDisplayName.trim();
    setNewDisplayName(name);
    setNewModelCode(name ? suggestModelCodeFromDisplayName(name) : "");
    setShowCreate(true);
    setError(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (showCreate) return;
    if (!isOpen) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      setQuery("");
      return;
    }
    const totalRows = options.length + (showCreateRow ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i < totalRows - 1 ? i + 1 : i));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i > 0 ? i - 1 : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex < options.length) {
        const item = options[highlightIndex];
        if (item) select(item.id, item);
      } else if (showCreateRow) {
        openCreatePanel();
      }
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <input
        type="text"
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
        placeholder={placeholder}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          setShowCreate(false);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-autocomplete="list"
        disabled={disabled}
      />
      {isOpen && !showCreate && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-border bg-secondary shadow-md py-1 text-sm"
        >
          {loading && options.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">Loading…</li>
          ) : null}
          {options.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={value === o.id}
              className={cn(
                "px-3 py-2 cursor-pointer",
                i === highlightIndex ? "bg-accent/20 text-foreground" : "text-foreground hover:bg-muted"
              )}
              onMouseEnter={() => setHighlightIndex(i)}
              onClick={() => select(o.id, o)}
            >
              <div className="font-medium">{o.displayName}</div>
              <div className="text-[11px] text-muted-foreground">{o.modelCode}</div>
            </li>
          ))}
          {showCreateRow ? (
            <li
              role="option"
              className={cn(
                "px-3 py-2 cursor-pointer border-t border-border text-accent",
                highlightIndex === options.length ? "bg-accent/20" : "hover:bg-muted"
              )}
              onMouseEnter={() => setHighlightIndex(options.length)}
              onClick={openCreatePanel}
            >
              Create new tire type…
            </li>
          ) : null}
          {!loading && options.length === 0 && !showCreateRow ? (
            <li className="px-3 py-2 text-muted-foreground">No matching tire types</li>
          ) : null}
        </ul>
      )}
      {isOpen && showCreate && (
        <form
          onSubmit={createTireType}
          className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card shadow-md p-3 space-y-2 text-sm"
        >
          <div className="ui-title text-xs text-muted-foreground">New tire type</div>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
            placeholder="Display name (e.g. Sweep 32)"
            value={newDisplayName}
            onChange={(e) => {
              setNewDisplayName(e.target.value);
              if (!newModelCode || newModelCode === suggestModelCodeFromDisplayName(newDisplayName)) {
                setNewModelCode(suggestModelCodeFromDisplayName(e.target.value));
              }
            }}
            aria-label="Tire display name"
            required
          />
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none font-mono text-xs"
            placeholder="Model code (unique)"
            value={newModelCode}
            onChange={(e) => setNewModelCode(e.target.value.toUpperCase())}
            aria-label="Tire model code"
            required
          />
          {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating || !newDisplayName.trim() || !newModelCode.trim()}
              className={cn(
                buttonLinkClassName("primary"),
                "text-xs px-3 py-1.5",
                (creating || !newDisplayName.trim() || !newModelCode.trim()) && "opacity-60 pointer-events-none"
              )}
            >
              {creating ? "Creating…" : "Add tire type"}
            </button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground px-2"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
