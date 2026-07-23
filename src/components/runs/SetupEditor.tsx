"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";
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
          <Eyebrow>Setup</Eyebrow>
          <div className="ui-caption">
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
          <SetupFieldInput
            key={f.key}
            label={f.label}
            unit={f.unit}
            stored={(value[f.key] ?? "").toString()}
            onCommit={(raw) => onChange({ ...value, [f.key]: coerceSetupValue(raw) })}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One setup field. Holds the raw typed string locally and only coerces on blur, so an in-progress
 * decimal ("3.") isn't collapsed to an integer mid-type. coerceSetupValue leaves non-numeric text
 * untouched, so text-valued fields (spring code, diff) keep working.
 */
function SetupFieldInput({
  label,
  unit,
  stored,
  onCommit
}: {
  label: string;
  unit?: string;
  stored: string;
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(stored);
  const [focused, setFocused] = useState(false);
  // Reflect external changes to the stored value, but never while the user is mid-edit.
  useEffect(() => {
    if (!focused) setDraft(stored);
  }, [stored, focused]);

  return (
    <label className="rounded-md border border-border bg-muted/70 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="ui-label-meta text-muted-foreground">{label}</div>
        {unit ? <div className="text-[10px] text-muted-foreground">{unit}</div> : null}
      </div>
      <input
        className="mt-1 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        inputMode="decimal"
        placeholder="—"
        value={draft}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false);
          onCommit(draft);
        }}
      />
    </label>
  );
}

