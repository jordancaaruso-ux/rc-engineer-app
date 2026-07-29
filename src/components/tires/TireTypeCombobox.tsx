"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eyebrow } from "@/components/ui/panel";

export type TireTypeOption = {
  id: string;
  displayName: string;
  modelCode: string;
  /** ISO string when founder-verified; null/absent = unverified (user-created, flagged). */
  verifiedAt?: string | null;
};

const CREATE_VALUE = "__create_tire_type__";

/**
 * Tire type picker — a native `<select>` (fully native 2026-07-14 for the iOS
 * feel). Options load up-front so the OS menu is populated; "Recently used" and
 * "All types" become `<optgroup>`s, and an inline "+ Add new tire type…" option
 * reveals a small create panel below (replaces the old create-from-query row).
 */
export function TireTypeCombobox({
  value,
  onChange,
  onSelectedTypeChange,
  placeholder = "Select tire type…",
  "aria-label": ariaLabel = "Tire type",
  disabled,
  className,
  allowInlineCreate = true,
  carId,
}: {
  value: string;
  onChange: (tireTypeId: string) => void;
  /** Fires when selection resolves to a full option (including after create). */
  onSelectedTypeChange?: (option: TireTypeOption | null) => void;
  placeholder?: string;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
  /** When false, hide inline create (e.g. Garage manages types separately). */
  allowInlineCreate?: boolean;
  /**
   * Car the run is for. "Recently used" then leads with what you run on cars of
   * the same discipline — the compound on your other touring car is a far better
   * guess for a new touring car than the last thing you bolted on a buggy.
   */
  carId?: string | null;
}) {
  const [options, setOptions] = useState<TireTypeOption[]>([]);
  const [recentOptions, setRecentOptions] = useState<TireTypeOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<TireTypeOption | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TireTypeOption[]>([]);

  // Notify the parent of the resolved option through a stable funnel:
  //  - a ref keeps the latest callback without putting it in effect deps
  //    (an inline parent callback would otherwise re-fire the resolve effect
  //     every render → onCommit → re-render → infinite loop / "max update depth"),
  //  - dedupe by id so re-resolving the same selection can't re-commit in a cycle.
  const onSelectedTypeChangeRef = useRef(onSelectedTypeChange);
  onSelectedTypeChangeRef.current = onSelectedTypeChange;
  const lastReportedIdRef = useRef<string | null>(null);
  const reportSelected = useCallback((opt: TireTypeOption | null) => {
    const id = opt?.id ?? null;
    if (lastReportedIdRef.current === id) return;
    lastReportedIdRef.current = id;
    onSelectedTypeChangeRef.current?.(opt);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const res = await fetch("/api/tire-types?limit=200", { cache: "no-store" });
      const data = (await res.json()) as { tireTypes?: TireTypeOption[] };
      setOptions(data.tireTypes ?? []);
    } catch {
      setOptions([]);
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch(
        carId ? `/api/tire-types/recent?carId=${encodeURIComponent(carId)}` : "/api/tire-types/recent",
        { cache: "no-store" }
      );
      const data = (await res.json()) as { tireTypes?: TireTypeOption[] };
      setRecentOptions(data.tireTypes ?? []);
    } catch {
      setRecentOptions([]);
    }
  }, [carId]);

  useEffect(() => {
    void loadAll();
    void loadRecent();
  }, [loadAll, loadRecent]);

  // Resolve the selected option (label + onSelectedTypeChange) — targeted fetch
  // when the current value isn't in the loaded lists.
  useEffect(() => {
    if (!value) {
      setSelectedOption(null);
      reportSelected(null);
      return;
    }
    const fromList = [...recentOptions, ...options].find((o) => o.id === value);
    if (fromList) {
      setSelectedOption(fromList);
      reportSelected(fromList);
      return;
    }
    let cancelled = false;
    fetch("/api/tire-types?limit=200", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tireTypes?: TireTypeOption[] }) => {
        if (cancelled) return;
        const hit = (d.tireTypes ?? []).find((o) => o.id === value) ?? null;
        setSelectedOption(hit);
        reportSelected(hit);
      })
      .catch(() => {
        if (!cancelled) reportSelected(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, options, recentOptions, reportSelected]);

  // Convergence steering: while typing a new type, surface existing near-matches so the driver
  // adopts one instead of forking a duplicate. Advisory only — creating still works.
  useEffect(() => {
    if (!showCreate) {
      setSuggestions([]);
      return;
    }
    const q = newDisplayName.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tire-types?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const data = (await res.json()) as { tireTypes?: TireTypeOption[] };
        if (!cancelled) setSuggestions((data.tireTypes ?? []).slice(0, 3));
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [showCreate, newDisplayName]);

  const recentIds = new Set(recentOptions.map((o) => o.id));
  const rest = options.filter((o) => !recentIds.has(o.id));
  const known = new Set([...recentOptions, ...options].map((o) => o.id));
  const extra = selectedOption && !known.has(selectedOption.id) ? [selectedOption] : [];

  function pick(id: string) {
    const opt =
      [...recentOptions, ...options, ...extra].find((o) => o.id === id) ?? null;
    onChange(id);
    setSelectedOption(opt);
    reportSelected(opt);
    setShowCreate(false);
    setError(null);
  }

  function adopt(option: TireTypeOption) {
    setOptions((prev) => (prev.some((o) => o.id === option.id) ? prev : [option, ...prev]));
    pick(option.id);
    setNewDisplayName("");
    setSuggestions([]);
  }

  function handleChange(next: string) {
    if (next === CREATE_VALUE) {
      setShowCreate(true);
      setError(null);
      return;
    }
    if (!next) {
      onChange("");
      setSelectedOption(null);
      reportSelected(null);
      return;
    }
    pick(next);
  }

  async function createTireType() {
    const displayName = newDisplayName.trim();
    if (!displayName) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/tire-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = (await res.json()) as {
        tireType?: TireTypeOption;
        existing?: TireTypeOption;
        error?: string;
      };
      if (res.status === 409 && data.existing) {
        setOptions((prev) =>
          prev.some((o) => o.id === data.existing!.id) ? prev : [data.existing!, ...prev]
        );
        pick(data.existing.id);
        setNewDisplayName("");
        return;
      }
      if (!res.ok || !data.tireType) {
        setError(data.error ?? "Failed to create tire type");
        return;
      }
      setOptions((prev) => [data.tireType!, ...prev.filter((o) => o.id !== data.tireType!.id)]);
      pick(data.tireType.id);
      setNewDisplayName("");
    } catch {
      setError("Failed to create tire type");
    } finally {
      setCreating(false);
    }
  }

  const renderOption = (o: TireTypeOption) => (
    <option key={o.id} value={o.id}>
      {o.displayName}
    </option>
  );

  return (
    <div className={className}>
      <select
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none disabled:opacity-60"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {recentOptions.length > 0 ? (
          <optgroup label="Recently used">{recentOptions.map(renderOption)}</optgroup>
        ) : null}
        {rest.length > 0 ? (
          recentOptions.length > 0 ? (
            <optgroup label="All types">{rest.map(renderOption)}</optgroup>
          ) : (
            rest.map(renderOption)
          )
        ) : null}
        {extra.map(renderOption)}
        {allowInlineCreate ? (
          <option value={CREATE_VALUE}>+ Add new tire type…</option>
        ) : null}
      </select>

      {showCreate && allowInlineCreate ? (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-card p-3">
          <Eyebrow>New tire type</Eyebrow>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
            placeholder="e.g. Sweep D32"
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
            aria-label="Tire type name"
          />
          {suggestions.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Did you mean an existing type?</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => adopt(s)}
                    className="rounded-md border border-primary/40 px-2 py-1 text-[11px] text-primary hover:bg-muted/50"
                  >
                    {s.displayName}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void createTireType()}
              disabled={creating || !newDisplayName.trim()}
              className="btn-surface px-2 py-1 text-xs disabled:opacity-60"
            >
              {creating ? "Adding…" : "Add tire type"}
            </button>
            <button
              type="button"
              className="px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setShowCreate(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
