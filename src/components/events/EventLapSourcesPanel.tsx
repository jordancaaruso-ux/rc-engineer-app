"use client";

import { useState } from "react";

type LapDetectionDebug = {
  eventInSyncScope?: boolean;
  scopeReason?: string;
  scopeStrategy?: string;
  scopedEventIds?: string[];
  liveRcDriverName?: string | null;
  importedSessionCounts?: { practice: number; race: number; total: number };
  practice?: {
    url: string;
    urlRecognized: boolean;
    fetchOk: boolean;
    fetchError: string | null;
    extractedRowCount: number;
    rowsPassingWatermark: number;
    practiceLastSeenSessionCompletedAtIso: string | null;
    sampleRows: Array<{
      driverName: string;
      sessionCompletedAtIso: string | null;
      passesWatermark: boolean;
      sessionUrl: string;
    }>;
    sampleRowsTruncated: boolean;
  } | null;
  race?: {
    url: string;
    raceClassConfigured: string;
    urlRecognized: boolean;
    fetchOk: boolean;
    fetchError: string | null;
    extractedRowCount: number;
    classMatchedRowCount: number;
    afterWatermarkRowCount: number;
    eventClassNormalized: string | null;
    resultsLastSeenSessionCompletedAtIso: string | null;
    rows: Array<{
      raceClass: string | null;
      raceClassNormalized: string | null;
      classMatchesEvent: boolean;
      sessionCompletedAtIso: string | null;
      passesWatermark: boolean;
      sessionTime: string | null;
      sessionUrl: string;
    }>;
    rowsTruncated: boolean;
  } | null;
};

export function EventLapSourcesPanel(props: {
  eventId: string;
  practiceSourceUrl: string | null;
  resultsSourceUrl: string | null;
  raceClass: string | null;
}) {
  const [practice, setPractice] = useState(props.practiceSourceUrl ?? "");
  const [results, setResults] = useState(props.resultsSourceUrl ?? "");
  const [raceClass, setRaceClass] = useState(props.raceClass ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diag, setDiag] = useState<LapDetectionDebug | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(props.eventId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          practiceSourceUrl: practice.trim() || null,
          resultsSourceUrl: results.trim() || null,
          raceClass: raceClass.trim() || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage(typeof j.error === "string" ? j.error : "Could not save");
        return;
      }
      setMessage("Saved");
    } finally {
      setSaving(false);
    }
  }

  async function runDiagnostic() {
    setDiagLoading(true);
    setDiagError(null);
    setDiag(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(props.eventId)}/lap-detection-debug`);
      const j = (await res.json().catch(() => ({}))) as LapDetectionDebug & { error?: string };
      if (!res.ok) {
        setDiagError(typeof j.error === "string" ? j.error : "Diagnostic request failed");
        return;
      }
      setDiag(j);
      setDiagOpen(true);
    } finally {
      setDiagLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm shadow-black/20">
      <h2 className="text-sm font-medium text-foreground">LiveRC lap detection</h2>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Paste practice list or results index URLs. The app matches your LiveRC driver name and surfaces prompts on the dashboard when new sessions appear.
      </p>
      <div className="mt-3 grid gap-3">
        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Practice session list URL</span>
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            value={practice}
            onChange={(e) => setPractice(e.target.value)}
            placeholder="https://…/practice?p=session_list"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Results URL</span>
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            value={results}
            onChange={(e) => setResults(e.target.value)}
            placeholder="https://…/results or …/results/?p=view_event (event hub)"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Race class (must match results row)</span>
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            value={raceClass}
            onChange={(e) => setRaceClass(e.target.value)}
            placeholder="e.g. 17.5 Stock Buggy"
            autoComplete="off"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save sources"}
        </button>
        <button
          type="button"
          disabled={diagLoading}
          onClick={() => void runDiagnostic()}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
        >
          {diagLoading ? "Running…" : "Run lap detection diagnostic"}
        </button>
        {message ? <span className="text-[11px] text-muted-foreground">{message}</span> : null}
      </div>

      {diagError ? (
        <p className="mt-2 text-[11px] text-destructive">{diagError}</p>
      ) : null}

      {diag && diagOpen ? (
        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setDiagOpen(false)}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Hide diagnostic
          </button>
          <div className="mt-2 space-y-3 rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-snug">
            <div>
              <span className="font-medium text-foreground">Dashboard sync scope</span>
              <p className="mt-0.5 text-muted-foreground">{diag.scopeReason}</p>
              {!diag.eventInSyncScope ? (
                <p className="mt-1 text-amber-600 dark:text-amber-500">
                  This event is not synced when you open the dashboard — prompts will not update for it until it is in
                  scope.
                </p>
              ) : null}
              <p className="mt-1 text-muted-foreground">
                Strategy: {diag.scopeStrategy ?? "—"} · LiveRC driver name:{" "}
                {diag.liveRcDriverName?.trim() ? diag.liveRcDriverName : "(not set — practice import skipped)"}
              </p>
              <p className="mt-1 text-muted-foreground">
                Imported sessions linked to this event: practice {diag.importedSessionCounts?.practice ?? 0}, race{" "}
                {diag.importedSessionCounts?.race ?? 0} (total {diag.importedSessionCounts?.total ?? 0})
              </p>
            </div>

            {diag.practice ? (
              <div>
                <span className="font-medium text-foreground">Practice</span>
                <ul className="mt-1 list-inside list-disc text-muted-foreground">
                  <li>URL recognized: {diag.practice.urlRecognized ? "yes" : "no"}</li>
                  <li>Fetch: {diag.practice.fetchOk ? "ok" : diag.practice.fetchError ?? "failed"}</li>
                  <li>Rows extracted: {diag.practice.extractedRowCount}</li>
                  <li>Rows passing watermark: {diag.practice.rowsPassingWatermark}</li>
                  <li>Watermark: {diag.practice.practiceLastSeenSessionCompletedAtIso ?? "(none — all timed rows eligible)"}</li>
                </ul>
                {diag.practice.sampleRows.length > 0 ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[32rem] border-collapse text-left text-[10px]">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="py-1 pr-2 font-medium">Driver</th>
                          <th className="py-1 pr-2 font-medium">Session time (ISO)</th>
                          <th className="py-1 pr-2 font-medium">Passes watermark</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diag.practice.sampleRows.map((r, i) => (
                          <tr key={`${r.sessionUrl}-${i}`} className="border-b border-border/60">
                            <td className="py-1 pr-2 align-top">{r.driverName}</td>
                            <td className="py-1 pr-2 align-top font-mono tabular-nums">
                              {r.sessionCompletedAtIso ?? "—"}
                            </td>
                            <td className="py-1 pr-2 align-top">{r.passesWatermark ? "yes" : "no"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {diag.practice.sampleRowsTruncated ? (
                      <p className="mt-1 text-muted-foreground">Table truncated (first rows only).</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {diag.race ? (
              <div>
                <span className="font-medium text-foreground">Race results</span>
                <ul className="mt-1 list-inside list-disc text-muted-foreground">
                  <li>URL recognized: {diag.race.urlRecognized ? "yes" : "no"}</li>
                  <li>Fetch: {diag.race.fetchOk ? "ok" : diag.race.fetchError ?? "failed"}</li>
                  <li>Configured class: {diag.race.raceClassConfigured || "(empty — sync skips race)"}</li>
                  <li>Normalized configured class: {diag.race.eventClassNormalized ?? "—"}</li>
                  <li>Rows extracted (all classes): {diag.race.extractedRowCount}</li>
                  <li>Rows matching class filter: {diag.race.classMatchedRowCount}</li>
                  <li>Matching rows also past watermark: {diag.race.afterWatermarkRowCount}</li>
                  <li>Watermark: {diag.race.resultsLastSeenSessionCompletedAtIso ?? "(none)"}</li>
                </ul>
                {diag.race.rows.length > 0 ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[40rem] border-collapse text-left text-[10px]">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="py-1 pr-2 font-medium">Row class</th>
                          <th className="py-1 pr-2 font-medium">Norm class</th>
                          <th className="py-1 pr-2 font-medium">Match</th>
                          <th className="py-1 pr-2 font-medium">Time ISO</th>
                          <th className="py-1 pr-2 font-medium">Past watermark</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diag.race.rows.map((r, i) => (
                          <tr key={`${r.sessionUrl}-${i}`} className="border-b border-border/60">
                            <td className="max-w-[10rem] py-1 pr-2 align-top break-words">{r.raceClass ?? "—"}</td>
                            <td className="py-1 pr-2 align-top font-mono text-[9px]">{r.raceClassNormalized ?? "—"}</td>
                            <td className="py-1 pr-2 align-top">{r.classMatchesEvent ? "yes" : "no"}</td>
                            <td className="py-1 pr-2 align-top font-mono tabular-nums">{r.sessionCompletedAtIso ?? "—"}</td>
                            <td className="py-1 pr-2 align-top">{r.passesWatermark ? "yes" : "no"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {diag.race.rowsTruncated ? (
                      <p className="mt-1 text-muted-foreground">Table truncated (most recent rows first).</p>
                    ) : null}
                  </div>
                ) : diag.race.extractedRowCount === 0 && diag.race.fetchOk ? (
                  <p className="mt-1 text-muted-foreground">
                    No <code className="rounded bg-muted px-0.5">view_race_result</code> links found in the page HTML.
                  </p>
                ) : null}
              </div>
            ) : null}

            <details className="text-muted-foreground">
              <summary className="cursor-pointer text-[11px] font-medium text-foreground">Raw JSON</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-background/80 p-2 text-[10px]">
                {JSON.stringify(diag, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      ) : null}
    </div>
  );
}
