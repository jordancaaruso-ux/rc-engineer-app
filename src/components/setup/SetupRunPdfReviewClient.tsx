"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { getDefaultSetupSheetTemplate, type SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

type PdfReviewPayload = {
  runId: string;
  isOwner: boolean;
  run: {
    id: string;
    createdAt: string;
    sessionLabel: string;
    car: {
      id: string;
      name: string;
      setupSheetTemplate: string | null;
      setupSheetModelId: string | null;
    } | null;
    track: { id: string; name: string } | null;
    event: { name: string } | null;
  };
  setupSnapshot: { id: string; data: unknown } | null;
};

function stableSetupJson(data: SetupSnapshotData): string {
  try {
    return JSON.stringify(data);
  } catch {
    return "";
  }
}

export function SetupRunPdfReviewClient({ runId }: { runId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payload, setPayload] = useState<PdfReviewPayload | null>(null);
  const [template, setTemplate] = useState<SetupSheetTemplate>(() => getDefaultSetupSheetTemplate());
  const [setupData, setSetupData] = useState<SetupSnapshotData>({});
  const [savedBaselineJson, setSavedBaselineJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/setup-snapshot`);
      const json = (await res.json().catch(() => null)) as PdfReviewPayload | { error?: string } | null;
      if (!res.ok || !json || !("runId" in json)) {
        throw new Error((json && "error" in json && json.error) || `Failed to load run (${res.status})`);
      }
      setPayload(json);
      const normalized = applyDerivedFieldsToSnapshot(normalizeSetupData(json.setupSnapshot?.data));
      setSetupData(normalized);
      setSavedBaselineJson(stableSetupJson(normalized));

      const carId = json.run.car?.id;
      if (carId) {
        const tRes = await fetch(`/api/cars/${encodeURIComponent(carId)}/setup-sheet-template`);
        const tJson = (await tRes.json().catch(() => null)) as { template?: SetupSheetTemplate } | null;
        if (tRes.ok && tJson?.template) {
          setTemplate(tJson.template);
        } else {
          setTemplate(getDefaultSetupSheetTemplate());
        }
      } else {
        setTemplate(getDefaultSetupSheetTemplate());
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load setup");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => savedBaselineJson !== "" && stableSetupJson(setupData) !== savedBaselineJson,
    [setupData, savedBaselineJson]
  );

  const canGeneratePdf = Boolean(payload?.isOwner && !dirty && !saving);

  async function handleSaveSetup() {
    if (!payload?.isOwner) return;
    setSaving(true);
    setSaveStatus(null);
    setPdfError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/setup-snapshot`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupData }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; snapshot?: { id: string; data: unknown } }
        | null;
      if (!res.ok || !json?.ok || !json.snapshot) {
        throw new Error(json?.error ?? `Save failed (${res.status})`);
      }
      const merged = applyDerivedFieldsToSnapshot(normalizeSetupData(json.snapshot.data));
      setSetupData(merged);
      setSavedBaselineJson(stableSetupJson(merged));
      setSaveStatus({ kind: "ok", text: "Setup saved to this run." });
    } catch (err) {
      setSaveStatus({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to save setup.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleGeneratePdf(download: boolean) {
    if (!canGeneratePdf) return;
    setPdfError(null);
    const url = `/api/runs/${encodeURIComponent(runId)}/setup-pdf${download ? "?download=1" : ""}`;
    if (download) {
      window.location.assign(url);
      return;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `Could not generate PDF (${res.status})`);
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "Could not generate PDF.");
    }
  }

  const runTitle = payload
    ? [
        payload.run.event?.name,
        payload.run.track?.name,
        payload.run.car?.name,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <>
      <header className="page-header">
        <div>
          <Link
            href="/setup"
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            ← Back to Setup tools
          </Link>
          <h1 className="page-title mt-2">Review setup for PDF</h1>
          <p className="page-subtitle">
            {runTitle || "Run setup"}
            {payload ? (
              <>
                {" "}
                · {payload.run.sessionLabel} · {formatRunCreatedAtDateTime(payload.run.createdAt)}
              </>
            ) : null}
          </p>
        </div>
      </header>

      <section className="page-body space-y-4">
        {loading ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Loading setup…
          </div>
        ) : loadError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="text-foreground">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 text-xs font-medium text-accent underline"
            >
              Retry
            </button>
          </div>
        ) : payload ? (
          <>
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-snug text-foreground">
              Review your setup before generating a PDF. Fill any missing fields, then{" "}
              <span className="font-medium">Save setup</span> before generating or downloading.
            </div>

            {!payload.isOwner ? (
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                Only the run owner can edit setup and generate a PDF. You can review the sheet below.
              </div>
            ) : null}

            <div
              className={cn(
                "sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-sm backdrop-blur-sm",
                dirty && "border-amber-500/50"
              )}
            >
              {payload.isOwner ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleSaveSetup()}
                    disabled={saving || !dirty}
                    className={cn(
                      buttonLinkClassName("primary"),
                      "text-xs",
                      (saving || !dirty) && "opacity-60 pointer-events-none"
                    )}
                  >
                    {saving ? "Saving…" : "Save setup"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleGeneratePdf(false)}
                    disabled={!canGeneratePdf}
                    title={dirty ? "Save setup first" : undefined}
                    className={cn(
                      buttonLinkClassName("outline"),
                      "text-xs",
                      !canGeneratePdf && "opacity-60 pointer-events-none"
                    )}
                  >
                    Generate PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleGeneratePdf(true)}
                    disabled={!canGeneratePdf}
                    title={dirty ? "Save setup first" : undefined}
                    className={cn(
                      buttonLinkClassName("outline"),
                      "text-xs",
                      !canGeneratePdf && "opacity-60 pointer-events-none"
                    )}
                  >
                    Download PDF
                  </button>
                </>
              ) : null}
              {dirty ? (
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  Unsaved changes — save before generating PDF
                </span>
              ) : payload.isOwner ? (
                <span className="text-[11px] text-muted-foreground">Saved — ready to generate PDF</span>
              ) : null}
              {saveStatus ? (
                <span
                  className={cn(
                    "text-[11px]",
                    saveStatus.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                  )}
                >
                  {saveStatus.text}
                </span>
              ) : null}
            </div>

            {pdfError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground">
                {pdfError}
                {pdfError.includes("mapped PDF") || pdfError.includes("calibrat") ? (
                  <span className="block mt-1 text-muted-foreground">
                    Upload and calibrate a setup PDF under{" "}
                    <Link href="/setup-documents" className="underline">
                      Setup documents
                    </Link>
                    {payload.run.car?.id ? (
                      <>
                        {" "}
                        or open your{" "}
                        <Link href={`/cars/${payload.run.car.id}`} className="underline">
                          car
                        </Link>{" "}
                        calibration settings.
                      </>
                    ) : null}
                  </span>
                ) : null}
              </div>
            ) : null}

            <SetupSheetView
              value={setupData}
              onChange={(next) => {
                setSetupData(applyDerivedFieldsToSnapshot(next));
                setSaveStatus(null);
              }}
              readOnly={!payload.isOwner}
              template={template}
              enableFieldSearch={payload.isOwner}
            />
          </>
        ) : null}
      </section>
    </>
  );
}
