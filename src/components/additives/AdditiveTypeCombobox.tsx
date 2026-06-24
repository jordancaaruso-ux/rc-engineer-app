"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";

export type AdditiveTypeOption = {
  id: string;
  displayName: string;
  modelCode: string;
};

export function AdditiveTypeCombobox({
  value,
  onChange,
  placeholder = "Search additive",
  "aria-label": ariaLabel = "Additive type",
  disabled,
  className,
  allowInlineCreate = true,
  allowClear = true,
}: {
  value: string;
  onChange: (additiveTypeId: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
  allowInlineCreate?: boolean;
  allowClear?: boolean;
}) {
  const [options, setOptions] = useState<AdditiveTypeOption[]>([]);
  const [recentOptions, setRecentOptions] = useState<AdditiveTypeOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<AdditiveTypeOption | null>(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const loadOptions = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const url = q.trim()
        ? `/api/additive-types?q=${encodeURIComponent(q.trim())}&limit=40`
        : "/api/additive-types?limit=40";
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json()) as { additiveTypes?: AdditiveTypeOption[] };
      setOptions(data.additiveTypes ?? []);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/additive-types/recent", { cache: "no-store" });
      const data = (await res.json()) as { additiveTypes?: AdditiveTypeOption[] };
      setRecentOptions(data.additiveTypes ?? []);
    } catch {
      setRecentOptions([]);
    }
  }, []);

  useEffect(() => {
    if (!value) {
      setSelectedOption(null);
      return;
    }
    const fromList = [...recentOptions, ...options].find((o) => o.id === value);
    if (fromList) {
      setSelectedOption(fromList);
      return;
    }
    let alive = true;
    void fetch(`/api/additive-types?limit=200`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { additiveTypes?: AdditiveTypeOption[] }) => {
        if (!alive) return;
        const hit = (data.additiveTypes ?? []).find((o) => o.id === value) ?? null;
        setSelectedOption(hit);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [value, options, recentOptions]);

  useEffect(() => {
    if (isOpen) {
      void loadRecent();
      void loadOptions(query);
    }
  }, [isOpen, query, loadOptions, loadRecent]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
        setShowCreate(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = options.length > 0 ? options : recentOptions;
    if (!q) return base;
    return base.filter(
      (o) =>
        o.displayName.toLowerCase().includes(q) || o.modelCode.toLowerCase().includes(q)
    );
  }, [options, recentOptions, query]);

  const displayValue = selectedOption?.displayName ?? "";

  async function createType() {
    const name = newDisplayName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/additive-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      const data = (await res.json()) as { additiveType?: AdditiveTypeOption; error?: string };
      if (!res.ok || !data.additiveType) {
        setError(data.error ?? "Failed to create additive type.");
        return;
      }
      onChange(data.additiveType.id);
      setSelectedOption(data.additiveType);
      setQuery("");
      setShowCreate(false);
      setNewDisplayName("");
      setIsOpen(false);
    } catch {
      setError("Failed to create additive type.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <input
        type="text"
        className="w-full form-control px-3 py-2 text-sm"
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-autocomplete="list"
        disabled={disabled}
        value={isOpen ? query : displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          setHighlightIndex(0);
        }}
        onFocus={() => {
          setIsOpen(true);
          setQuery(displayValue);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setIsOpen(false);
            setShowCreate(false);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightIndex((i) => Math.min(i + 1, filtered.length));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightIndex((i) => Math.max(i - 1, 0));
          }
          if (e.key === "Enter" && isOpen && filtered[highlightIndex]) {
            e.preventDefault();
            onChange(filtered[highlightIndex].id);
            setSelectedOption(filtered[highlightIndex]);
            setIsOpen(false);
            setQuery("");
          }
        }}
      />

      {isOpen ? (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-background shadow-lg text-sm"
        >
          <li>
            {allowClear ? (
              <button
                type="button"
                role="option"
                className={cn(
                  "w-full px-3 py-2 text-left hover:bg-muted",
                  !value && "bg-accent/10"
                )}
                onClick={() => {
                  onChange("");
                  setSelectedOption(null);
                  setIsOpen(false);
                  setQuery("");
                }}
              >
                None
              </button>
            ) : null}
          </li>
          {loading ? (
            <li className="px-3 py-2 text-muted-foreground text-xs">Loading…</li>
          ) : null}
          {filtered.map((o, i) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === o.id}
                className={cn(
                  "w-full px-3 py-2 text-left hover:bg-muted",
                  i === highlightIndex && "bg-muted/80",
                  value === o.id && "bg-accent/10"
                )}
                onClick={() => {
                  onChange(o.id);
                  setSelectedOption(o);
                  setIsOpen(false);
                  setQuery("");
                }}
              >
                {o.displayName}
              </button>
            </li>
          ))}
          {allowInlineCreate && query.trim() && !filtered.some((o) => o.displayName.toLowerCase() === query.trim().toLowerCase()) ? (
            <li className="border-t border-border">
              {!showCreate ? (
                <button
                  type="button"
                  className={cn("w-full px-3 py-2 text-left text-xs", buttonLinkClassName)}
                  onClick={() => {
                    setShowCreate(true);
                    setNewDisplayName(query.trim());
                  }}
                >
                  Add &quot;{query.trim()}&quot; as new additive
                </button>
              ) : (
                <div className="p-2 space-y-2">
                  <input
                    type="text"
                    className="w-full form-control px-2 py-1.5 text-xs"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    aria-label="New additive name"
                  />
                  {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
                  <button
                    type="button"
                    className="btn-surface px-2 py-1 text-xs"
                    disabled={creating || !newDisplayName.trim()}
                    onClick={() => void createType()}
                  >
                    {creating ? "Adding…" : "Add additive"}
                  </button>
                </div>
              )}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
