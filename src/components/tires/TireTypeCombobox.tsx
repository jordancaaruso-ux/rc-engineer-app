"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eyebrow } from "@/components/ui/panel";
import { PickerSheet, PickerTrigger } from "@/components/ui/PickerSheet";
import type { OptionSection } from "@/lib/search/optionSearch";

export type TireTypeOption = {
  id: string;
  displayName: string;
  modelCode: string;
  /** ISO string when founder-verified; null/absent = unverified (user-created, flagged). */
  verifiedAt?: string | null;
};

/**
 * The whole catalog comes down in one request so filtering is local and lands on
 * the keystroke — no debounce, no spinner, no round trip per character. The
 * catalog is ~30 rows and every row is a real product, so the ceiling is
 * headroom rather than a page size; if it is ever genuinely approached the
 * picker needs server-backed search instead of raising this again.
 */
const CATALOG_LIMIT = 500;

/**
 * Tire type picker — a `PickerSheet`, because the compound list is long enough
 * that a native `<select>` wheel means scrolling blind past your own tire.
 *
 * The tire-specific parts that stay here: "Recently used" ranked by the car's
 * discipline, the model code being searchable even though it's never shown, and
 * the inline create panel with its near-match steering.
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
  const [open, setOpen] = useState(false);
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
      const res = await fetch(`/api/tire-types?limit=${CATALOG_LIMIT}`, { cache: "no-store" });
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
    fetch(`/api/tire-types?limit=${CATALOG_LIMIT}`, { cache: "no-store" })
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

  // A selection made elsewhere (event spec tire, copy-forward, restored draft)
  // may name a type the lists don't hold; carry it so the sheet can show it
  // ticked rather than silently dropping the row the trigger is naming.
  const extra = useMemo(() => {
    if (!selectedOption) return [] as TireTypeOption[];
    const known = new Set([...recentOptions, ...options].map((o) => o.id));
    return known.has(selectedOption.id) ? ([] as TireTypeOption[]) : [selectedOption];
  }, [selectedOption, recentOptions, options]);

  const sections = useMemo<OptionSection[]>(() => {
    // `keywords` carries the model code: never shown, always searched, so "D32"
    // finds a compound whose visible name never says D32.
    const toRow = (o: TireTypeOption) => ({
      value: o.id,
      label: o.displayName,
      keywords: o.modelCode,
    });
    return [
      { key: "recent", label: "Recently used", options: recentOptions.map(toRow) },
      { key: "all", label: "All types", options: [...options, ...extra].map(toRow) },
    ];
  }, [recentOptions, options, extra]);

  const closeSheet = useCallback(() => {
    setOpen(false);
    setShowCreate(false);
    setError(null);
  }, []);

  function pick(id: string) {
    const opt = [...recentOptions, ...options, ...extra].find((o) => o.id === id) ?? null;
    onChange(id);
    setSelectedOption(opt);
    reportSelected(opt);
    closeSheet();
  }

  function adopt(option: TireTypeOption) {
    setOptions((prev) => (prev.some((o) => o.id === option.id) ? prev : [option, ...prev]));
    pick(option.id);
    setNewDisplayName("");
    setSuggestions([]);
  }

  /** Hand the create panel whatever was typed in the search — they've named it once. */
  function beginCreate(query: string) {
    setNewDisplayName(query);
    setSuggestions([]);
    setError(null);
    setShowCreate(true);
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

  // A value that hasn't resolved to a name yet is still a real selection, so the
  // trigger must not read as empty — that would invite picking it all over again.
  const triggerLabel = selectedOption?.displayName ?? (value ? "Loading…" : placeholder);

  const createPanel = (
    <div className="space-y-2">
      <Eyebrow>Name</Eyebrow>
      <input
        className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none"
        placeholder="e.g. Sweep D32"
        value={newDisplayName}
        onChange={(e) => setNewDisplayName(e.target.value)}
        aria-label="Tire type name"
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
      {suggestions.length > 0 ? (
        <div className="space-y-1.5 pt-1">
          <p className="text-[11px] text-muted-foreground">Did you mean an existing type?</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => adopt(s)}
                className="tap-active rounded-md border border-primary-ink/40 px-2.5 py-1.5 text-[12px] text-primary-ink hover:bg-muted/50"
              >
                {s.displayName}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => void createTireType()}
          disabled={creating || !newDisplayName.trim()}
          className="btn-surface px-3 py-2 text-xs disabled:opacity-60"
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
          Back
        </button>
      </div>
    </div>
  );

  return (
    <div className={className}>
      <PickerTrigger
        onClick={() => setOpen(true)}
        disabled={disabled}
        open={open}
        aria-label={ariaLabel}
        placeholder={!selectedOption}
        className="rounded-md border border-border bg-card"
      >
        {triggerLabel}
      </PickerTrigger>

      <PickerSheet
        open={open}
        onClose={closeSheet}
        title={ariaLabel}
        value={value}
        onSelect={pick}
        sections={sections}
        searchPlaceholder="Search tire types…"
        panel={showCreate && allowInlineCreate ? createPanel : null}
        panelTitle="New tire type"
        emptyAction={
          allowInlineCreate
            ? (q) => (
                <button
                  type="button"
                  onClick={() => beginCreate(q)}
                  className="tap-active rounded-md border border-primary-ink/40 px-3 py-2 text-[13px] font-semibold text-primary-ink hover:bg-muted/50"
                >
                  {q ? `Add “${q}”` : "Add a tire type"}
                </button>
              )
            : undefined
        }
        searchAction={
          // Moved here from a sticky footer. The panel still opens with whatever was typed
          // filled in — a half-typed "con" is a filter, not a name, so nothing is created from
          // it without a second look at a catalog everybody shares.
          allowInlineCreate
            ? { label: "Add new tire type", onAction: (q) => beginCreate(q) }
            : undefined
        }
      />
    </div>
  );
}
