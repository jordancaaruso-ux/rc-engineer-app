"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eyebrow } from "@/components/ui/panel";
import { PickerSheet, PickerTrigger } from "@/components/ui/PickerSheet";
import type { OptionSection } from "@/lib/search/optionSearch";

export type AdditiveTypeOption = {
  id: string;
  displayName: string;
  modelCode: string;
  /** ISO string when founder-verified; null/absent = unverified (user-created, flagged). */
  verifiedAt?: string | null;
};

/** See `TireTypeCombobox` — the catalog is small enough to filter locally. */
const CATALOG_LIMIT = 500;

/**
 * Additive type picker — a `PickerSheet`, for the same reason tires are: the
 * traction-compound shelf is long, and picking off a five-row iOS wheel means
 * scrolling past your own bottle to find it.
 *
 * "None" is a real answer here (most runs are dry), so it keeps its own row at
 * the top of the list rather than being a create-or-nothing choice.
 */
export function AdditiveTypeCombobox({
  value,
  onChange,
  placeholder = "Select additive…",
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
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const res = await fetch(`/api/additive-types?limit=${CATALOG_LIMIT}`, { cache: "no-store" });
      const data = (await res.json()) as { additiveTypes?: AdditiveTypeOption[] };
      setOptions(data.additiveTypes ?? []);
    } catch {
      setOptions([]);
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
    void loadAll();
    void loadRecent();
  }, [loadAll, loadRecent]);

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
    let cancelled = false;
    fetch(`/api/additive-types?limit=${CATALOG_LIMIT}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { additiveTypes?: AdditiveTypeOption[] }) => {
        if (cancelled) return;
        setSelectedOption((data.additiveTypes ?? []).find((o) => o.id === value) ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value, options, recentOptions]);

  const extra = useMemo(() => {
    if (!selectedOption) return [] as AdditiveTypeOption[];
    const known = new Set([...recentOptions, ...options].map((o) => o.id));
    return known.has(selectedOption.id) ? ([] as AdditiveTypeOption[]) : [selectedOption];
  }, [selectedOption, recentOptions, options]);

  const sections = useMemo<OptionSection[]>(() => {
    const toRow = (o: AdditiveTypeOption) => ({
      value: o.id,
      label: o.displayName,
      keywords: o.modelCode,
    });
    return [
      { key: "recent", label: "Recently used", options: recentOptions.map(toRow) },
      { key: "all", label: "All additives", options: [...options, ...extra].map(toRow) },
    ];
  }, [recentOptions, options, extra]);

  const closeSheet = useCallback(() => {
    setOpen(false);
    setShowCreate(false);
    setError(null);
  }, []);

  /** `""` arrives from the "None" row — a real answer, not an empty state. */
  function pick(id: string) {
    const opt = id ? ([...recentOptions, ...options, ...extra].find((o) => o.id === id) ?? null) : null;
    onChange(id);
    setSelectedOption(opt);
    closeSheet();
  }

  function beginCreate(query: string) {
    setNewDisplayName(query);
    setError(null);
    setShowCreate(true);
  }

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
      setOptions((prev) => [data.additiveType!, ...prev.filter((o) => o.id !== data.additiveType!.id)]);
      onChange(data.additiveType.id);
      setSelectedOption(data.additiveType);
      setNewDisplayName("");
      closeSheet();
    } catch {
      setError("Failed to create additive type.");
    } finally {
      setCreating(false);
    }
  }

  const triggerLabel = selectedOption?.displayName ?? (value ? "Loading…" : allowClear ? "None" : placeholder);

  const createPanel = (
    <div className="space-y-2">
      <Eyebrow>Name</Eyebrow>
      <input
        type="text"
        className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none"
        placeholder="e.g. PDR Extreme"
        value={newDisplayName}
        onChange={(e) => setNewDisplayName(e.target.value)}
        aria-label="New additive name"
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="btn-surface px-3 py-2 text-xs disabled:opacity-60"
          disabled={creating || !newDisplayName.trim()}
          onClick={() => void createType()}
        >
          {creating ? "Adding…" : "Add additive"}
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
        className="form-control"
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
        searchPlaceholder="Search additives…"
        clearRow={allowClear ? { label: "None" } : null}
        panel={showCreate && allowInlineCreate ? createPanel : null}
        panelTitle="New additive"
        emptyAction={
          allowInlineCreate
            ? (q) => (
                <button
                  type="button"
                  onClick={() => beginCreate(q)}
                  className="tap-active rounded-md border border-primary/40 px-3 py-2 text-[13px] font-semibold text-primary hover:bg-muted/50"
                >
                  {q ? `Add “${q}”` : "Add an additive"}
                </button>
              )
            : undefined
        }
        footer={
          allowInlineCreate
            ? (q) => (
                <button
                  type="button"
                  onClick={() => beginCreate(q)}
                  className="tap-active w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-primary hover:bg-muted/60"
                >
                  + Add new additive…
                </button>
              )
            : null
        }
      />
    </div>
  );
}
