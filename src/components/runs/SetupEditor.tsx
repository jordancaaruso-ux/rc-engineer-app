"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  coerceSetupValue,
  DEFAULT_SETUP_FIELDS,
  type SetupSnapshotData
} from "@/lib/runSetup";

type Props = {
  value: SetupSnapshotData;
  onChange: (next: SetupSnapshotData) => void;
  compact?: boolean;
  /** Hide top bar when embedded in another panel. */
  embed?: boolean;
};

export function SetupEditor({ value, onChange, compact, embed }: Props) {
  const fields = useMemo(() => DEFAULT_SETUP_FIELDS, []);

  return (
    <div className="space-y-3">
      {!embed ? (
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono text-muted-foreground">Setup</div>
          <div className="text-[11px] text-muted-foreground">
            Minimal fields (stored as snapshot)
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "grid gap-3",
          compact ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-3"
        )}
      >
        {fields.map((f) => (
          <label
            key={f.key}
            className="rounded-md border border-border bg-secondary/20 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-mono text-muted-foreground">
                {f.label}
              </div>
              {f.unit ? (
                <div className="text-[10px] text-muted-foreground">{f.unit}</div>
              ) : null}
            </div>
            <input
              className="mt-1 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              inputMode="decimal"
              placeholder="—"
              value={(value[f.key] ?? "").toString()}
              onChange={(e) => {
                const next = { ...value, [f.key]: coerceSetupValue(e.target.value) };
                onChange(next);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

