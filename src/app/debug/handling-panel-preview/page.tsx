"use client";

/**
 * Dev preview for the Log-run feedback panel's handling detail.
 *
 * The real panel sits behind a signed-in account, a car, and a run in progress —
 * `/runs/new` → Feedback → Handling detail — which is a lot of clicks to look at a
 * 26px lane or a 10px severity step. This renders the REAL
 * `HandlingAssessmentFields` against local state at the width it actually gets
 * inside `PagedCard`, so what you're judging is the shipped control.
 *
 * The live UI state is printed underneath: that's `HandlingAssessmentUiState`
 * exactly as `NewRunForm` would hand it to the sanitizer, so you can see what a
 * gesture stores as well as what it looks like.
 */

import { notFound } from "next/navigation";
import { useState } from "react";
import { HandlingAssessmentFields } from "@/components/runs/HandlingAssessmentFields";
import {
  emptyHandlingAssessmentUiState,
  type HandlingAssessmentUiState,
} from "@/lib/runHandlingAssessment";

/** Widths the panel actually meets: a phone in portrait, and the desktop card. */
const WIDTHS = [
  { id: "phone", label: "Phone — 358px", px: 358 },
  { id: "wide", label: "Desktop card — 520px", px: 520 },
];

export default function HandlingPanelPreviewPage() {
  // Dev-only synthetic preview — never exposed in production.
  if (process.env.NODE_ENV === "production") notFound();
  return <Preview />;
}

function Preview() {
  const [ui, setUi] = useState<HandlingAssessmentUiState>(() => ({
    ...emptyHandlingAssessmentUiState(),
    balanceEntry: -2,
    balanceExit: 1,
    onPower: -2,
    tractionRoll: 1,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Handling detail — preview</h1>
        <p className="text-sm text-muted-foreground">
          The real control, seeded with a flagged entry and exit plus two notables. Corner balance is
          one lane per phase; notables are severity-only since the corner-speed row came out.
        </p>
      </header>

      <div className="flex flex-wrap items-start gap-8">
        {WIDTHS.map((w) => (
          <div key={w.id} className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{w.label}</p>
            <div data-testid={`handling-panel-${w.id}`} style={{ width: w.px }}>
              <HandlingAssessmentFields value={ui} onChange={setUi} />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Stored UI state</p>
        <pre className="overflow-x-auto rounded-lg border border-border bg-secondary p-3 text-[11px] leading-relaxed">
          {JSON.stringify(ui, null, 2)}
        </pre>
      </div>
    </div>
  );
}
