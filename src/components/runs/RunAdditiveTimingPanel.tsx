"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";
import {
  AdditiveTypeCombobox,
  type AdditiveTypeOption,
} from "@/components/additives/AdditiveTypeCombobox";

type Props = {
  additiveTypeId: string;
  onAdditiveTypeIdChange: (id: string) => void;
  warmerTimingMinutes: string;
  onWarmerTimingMinutesChange: (value: string) => void;
  prefillFieldClass?: string;
  requireAdditive?: boolean;
  highlightMissing?: boolean;
};

function chipClass(selected: boolean) {
  return cn(
    "rounded-md border px-2.5 py-1.5 text-xs font-medium transition text-left max-w-full truncate",
    selected
      ? "border-accent bg-accent/15 text-foreground"
      : "border-border bg-secondary text-foreground hover:bg-muted"
  );
}

export function RunAdditiveTimingPanel({
  additiveTypeId,
  onAdditiveTypeIdChange,
  warmerTimingMinutes,
  onWarmerTimingMinutesChange,
  prefillFieldClass,
  requireAdditive = false,
  highlightMissing = false,
}: Props) {
  const [recentTypes, setRecentTypes] = useState<AdditiveTypeOption[]>([]);

  const loadRecentTypes = useCallback(async () => {
    try {
      const res = await fetch("/api/additive-types/recent", { cache: "no-store" });
      const data = (await res.json()) as { additiveTypes?: AdditiveTypeOption[] };
      setRecentTypes(data.additiveTypes ?? []);
    } catch {
      setRecentTypes([]);
    }
  }, []);

  useEffect(() => {
    void loadRecentTypes();
  }, [loadRecentTypes]);

  return (
    <div
      className={cn(
        "space-y-3 text-sm",
        prefillFieldClass,
        highlightMissing && "rounded-md ring-2 ring-destructive/40"
      )}
    >
      <Eyebrow dot="muted">Tire prep</Eyebrow>

      <div className="space-y-2">
          {recentTypes.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-faint">
                Recently used
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Recently used additives">
                {!requireAdditive ? (
                  <button
                    type="button"
                    className={chipClass(!additiveTypeId)}
                    onClick={() => onAdditiveTypeIdChange("")}
                  >
                    None
                  </button>
                ) : null}
                {recentTypes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={chipClass(additiveTypeId === t.id)}
                    onClick={() => onAdditiveTypeIdChange(t.id)}
                  >
                    {t.displayName}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-1">
            <div className="type-data-label">
              Additive{requireAdditive ? " *" : ""}
            </div>
            <AdditiveTypeCombobox
              value={additiveTypeId}
              onChange={onAdditiveTypeIdChange}
              placeholder={requireAdditive ? "Select required additive" : "None or search additive"}
              aria-label="Additive type"
              allowInlineCreate={!requireAdditive}
              allowClear={!requireAdditive}
            />
          </div>
        </div>

      <div className="space-y-1">
        <label className="type-data-label block">Warmer timing</label>
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          className="w-full max-w-xs form-control px-3 py-2 text-sm"
          placeholder="Optional"
          value={warmerTimingMinutes}
          onChange={(e) => onWarmerTimingMinutesChange(e.target.value)}
          aria-label="Warmer timing in minutes"
        />
      </div>
    </div>
  );
}
