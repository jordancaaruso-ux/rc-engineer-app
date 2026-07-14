"use client";

import { useCallback, useEffect, useState } from "react";
import { Eyebrow } from "@/components/ui/panel";

export type AdditiveTypeOption = {
  id: string;
  displayName: string;
  modelCode: string;
  /** ISO string when founder-verified; null/absent = unverified (user-created, flagged). */
  verifiedAt?: string | null;
};

const CREATE_VALUE = "__create_additive_type__";

/**
 * Additive type picker — a native `<select>` (fully native 2026-07-14 for the
 * iOS feel). Options load up-front; "Recently used" / "All types" become
 * `<optgroup>`s, "None" clears when `allowClear`, and "+ Add new additive…"
 * reveals an inline create panel below.
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
  const [showCreate, setShowCreate] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const res = await fetch("/api/additive-types?limit=200", { cache: "no-store" });
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
    fetch("/api/additive-types?limit=200", { cache: "no-store" })
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

  const recentIds = new Set(recentOptions.map((o) => o.id));
  const rest = options.filter((o) => !recentIds.has(o.id));
  const known = new Set([...recentOptions, ...options].map((o) => o.id));
  const extra = selectedOption && !known.has(selectedOption.id) ? [selectedOption] : [];

  function handleChange(next: string) {
    if (next === CREATE_VALUE) {
      setShowCreate(true);
      setError(null);
      return;
    }
    if (!next) {
      onChange("");
      setSelectedOption(null);
      return;
    }
    const opt = [...recentOptions, ...options, ...extra].find((o) => o.id === next) ?? null;
    onChange(next);
    setSelectedOption(opt);
    setShowCreate(false);
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
      setShowCreate(false);
      setNewDisplayName("");
    } catch {
      setError("Failed to create additive type.");
    } finally {
      setCreating(false);
    }
  }

  const renderOption = (o: AdditiveTypeOption) => (
    <option key={o.id} value={o.id}>
      {o.displayName}
    </option>
  );

  return (
    <div className={className}>
      <select
        className="w-full form-control px-3 py-2 text-sm disabled:opacity-60"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        {allowClear ? (
          <option value="">None</option>
        ) : (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
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
          <option value={CREATE_VALUE}>+ Add new additive…</option>
        ) : null}
      </select>

      {showCreate && allowInlineCreate ? (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-card p-3">
          <Eyebrow>New additive</Eyebrow>
          <input
            type="text"
            className="w-full form-control px-3 py-2 text-sm"
            placeholder="e.g. PDR Extreme"
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
            aria-label="New additive name"
          />
          {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-surface px-2 py-1 text-xs disabled:opacity-60"
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
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
