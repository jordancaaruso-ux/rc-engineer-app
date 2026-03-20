"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ACTIVE_SETUP_CHANGED_EVENT,
  getActiveSetupData,
  setActiveSetupData,
} from "@/lib/activeSetupContext";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";

function hasAnyValue(v: SetupSnapshotData): boolean {
  return Object.keys(v).some((k) => {
    const x = v[k];
    return x != null && String(x).trim() !== "";
  });
}

export function SetupPageClient() {
  const [tick, setTick] = useState(0);
  const [setupData, setSetupData] = useState<SetupSnapshotData>({});
  const [savedToast, setSavedToast] = useState<string | null>(null);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(ACTIVE_SETUP_CHANGED_EVENT, bump);
    return () => window.removeEventListener(ACTIVE_SETUP_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    void tick;
    const active = getActiveSetupData();
    setSetupData(normalizeSetupData(active ?? {}));
  }, [tick]);

  // Persist changes back to active setup (source of truth for "current setup" compare)
  useEffect(() => {
    const t = window.setTimeout(() => {
      setActiveSetupData(setupData);
      setSavedToast("Saved to current setup");
    }, 300);
    return () => window.clearTimeout(t);
  }, [setupData]);

  useEffect(() => {
    if (!savedToast) return;
    const t = window.setTimeout(() => setSavedToast(null), 1200);
    return () => window.clearTimeout(t);
  }, [savedToast]);

  const empty = useMemo(() => !hasAnyValue(setupData), [setupData]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Setup</h1>
          <p className="page-subtitle">
            App-native setup editor · structured setup data is the source of truth
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              "rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs hover:bg-secondary/40 transition",
              empty && "opacity-60"
            )}
            onClick={() => setSetupData({})}
            title="Clear current setup"
          >
            Clear
          </button>
        </div>
      </header>

      <section className="page-body space-y-3">
        {savedToast ? (
          <div className="text-xs text-muted-foreground">{savedToast}</div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Changes sync instantly with “Current setup” in Analysis compare.
          </div>
        )}

        <SetupSheetView
          value={setupData}
          onChange={setSetupData}
          template={A800RR_SETUP_SHEET_V1}
        />
      </section>
    </>
  );
}

