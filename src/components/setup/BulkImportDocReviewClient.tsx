"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { interpretAwesomatixSetupSnapshot } from "@/lib/setupDocuments/awesomatixImportPostProcess";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { getA800rrSetupSheetTemplateWithDisplayPreferences } from "@/lib/setupCalibrations/customFieldCatalog";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";

type ReviewStatus = "UNSET" | "NOT_CONFIRMED" | "CONFIRMED_ACCURATE";

type CalOption = { id: string; name: string; sourceType: string };

export function BulkImportDocReviewClient(input: {
  batchId: string;
  documentId: string;
  originalFilename: string;
  mimeType: string;
  parseStatus: string;
  importErrorMessage: string | null;
  importDiagnosticJson: unknown;
  parsedDataJson: unknown;
  importDatasetReviewStatus: ReviewStatus;
  eligibleForAggregationDataset: boolean;
  calibrationDataJson: unknown;
  calibrations: CalOption[];
  calibrationProfileId: string | null;
  parsedCalibrationProfileId: string | null;
  documentUpdatedAt: string;
  parsedSetupManuallyEdited?: boolean;
}) {
  const router = useRouter();
  const [editingSetup, setEditingSetup] = useState(false);
  const [localSetup, setLocalSetup] = useState<SetupSnapshotData>(() =>
    applyDerivedFieldsToSnapshot(interpretAwesomatixSetupSnapshot(normalizeSetupData(input.parsedDataJson)))
  );
  const [savingSetup, setSavingSetup] = useState(false);
  const [setupSaveErr, setSetupSaveErr] = useState<string | null>(null);
  const [selectedCalId, setSelectedCalId] = useState(
    () => input.calibrationProfileId || input.calibrations[0]?.id || ""
  );
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(input.importDatasetReviewStatus);
  const [eligible, setEligible] = useState(input.eligibleForAggregationDataset);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [parseOkSummary, setParseOkSummary] = useState<string | null>(null);

  useEffect(() => {
    setSelectedCalId(input.calibrationProfileId || input.calibrations[0]?.id || "");
  }, [input.documentId, input.calibrationProfileId, input.calibrations]);

  useEffect(() => {
    setReviewStatus(input.importDatasetReviewStatus);
    setEligible(input.eligibleForAggregationDataset);
  }, [input.importDatasetReviewStatus, input.eligibleForAggregationDataset, input.documentId]);

  useEffect(() => {
    if (!editingSetup) {
      setLocalSetup(
        applyDerivedFieldsToSnapshot(interpretAwesomatixSetupSnapshot(normalizeSetupData(input.parsedDataJson)))
      );
    }
  }, [input.documentId, input.documentUpdatedAt, editingSetup]);

  const normalizedCalibration = useMemo(
    () => normalizeCalibrationData(input.calibrationDataJson),
    [input.calibrationDataJson]
  );
  const template = useMemo(
    () =>
      getA800rrSetupSheetTemplateWithDisplayPreferences(
        normalizedCalibration.customFieldDefinitions ?? [],
        normalizedCalibration.fieldDisplayOverrides ?? null,
        "setup"
      ),
    [normalizedCalibration]
  );
  const previewUrl = `/api/setup-documents/${input.documentId}/file`;

  const parseOk = input.parseStatus === "PARSED" || input.parseStatus === "PARTIAL";

  async function saveStructuredSetup() {
    if (!parseOk) return;
    setSetupSaveErr(null);
    setSavingSetup(true);
    try {
      const parseStatus =
        input.parseStatus === "PARSED" || input.parseStatus === "PARTIAL" ? input.parseStatus : "PARTIAL";
      const res = await fetch(`/api/setup-documents/${input.documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parsedDataJson: localSetup,
          parseStatus,
          manualStructuredEdit: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setSetupSaveErr(data.error ?? "Could not save setup");
        return;
      }
      setEditingSetup(false);
      router.refresh();
    } finally {
      setSavingSetup(false);
    }
  }

  async function runParse() {
    setParseErr(null);
    setParseOkSummary(null);
    setErr(null);
    if (!selectedCalId) {
      setParseErr("Choose a calibration first.");
      return;
    }
    setParsing(true);
    try {
      const res = await fetch(`/api/setup-documents/${input.documentId}/bulk-import-parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calibrationId: selectedCalId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        calibration?: { name: string };
        importedCount?: number;
      };
      if (!res.ok) {
        setParseErr(data.error ?? "Parse failed");
        router.refresh();
        return;
      }
      setParseErr(null);
      setParseOkSummary(
        `Last parse: “${data.calibration?.name ?? "calibration"}” — ${data.importedCount ?? 0} fields imported from the PDF.`
      );
      setEditingSetup(false);
      router.refresh();
    } finally {
      setParsing(false);
    }
  }

  async function saveReview(next: ReviewStatus) {
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/setup-documents/${input.documentId}/import-dataset-review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importDatasetReviewStatus: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        importDatasetReviewStatus?: ReviewStatus;
        eligibleForAggregationDataset?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setErr(data.error ?? "Could not save");
        return;
      }
      if (data.importDatasetReviewStatus) setReviewStatus(data.importDatasetReviewStatus);
      if (typeof data.eligibleForAggregationDataset === "boolean") setEligible(data.eligibleForAggregationDataset);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const diagStr =
    input.importDiagnosticJson && typeof input.importDiagnosticJson === "object"
      ? JSON.stringify(input.importDiagnosticJson, null, 2)
      : String(input.importDiagnosticJson ?? "");

  const appliedCalLabel =
    input.calibrations.find((c) => c.id === input.parsedCalibrationProfileId)?.name
    ?? (input.parsedCalibrationProfileId ? "Unknown calibration" : null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link href={`/setup/bulk-import/${input.batchId}`} className="rounded-md border border-border px-2 py-1 hover:bg-muted">
          ← Back to batch
        </Link>
        <span className="text-muted-foreground truncate max-w-[min(100%,280px)]">{input.originalFilename}</span>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">Calibration & parse</div>
        {input.calibrations.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No calibrations saved.{" "}
            <Link href="/setup-calibrations" className="text-foreground underline underline-offset-2">
              Create one
            </Link>{" "}
            under Setup calibrations, then return here.
          </p>
        ) : (
          <label className="block text-xs max-w-md">
            <span className="text-muted-foreground">Calibration for this PDF</span>
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={selectedCalId}
              onChange={(e) => setSelectedCalId(e.target.value)}
            >
              <option value="">Select…</option>
              {input.calibrations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.sourceType})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={parsing || !selectedCalId || input.calibrations.length === 0}
            onClick={() => void runParse()}
            className="rounded-md border border-border bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {parsing ? "Parsing…" : "Parse with selected calibration"}
          </button>
          <span className="text-[11px] text-muted-foreground">
            Re-run after changing calibration; the new result replaces the previous snapshot for this file.
          </span>
        </div>
        {appliedCalLabel ? (
          <div className="text-[11px] text-muted-foreground">
            Stored parse used: <span className="text-foreground">{appliedCalLabel}</span>
            {input.parsedCalibrationProfileId && input.parsedCalibrationProfileId !== selectedCalId ? (
              <span className="text-amber-600 dark:text-amber-500"> · picker differs — parse to apply selection</span>
            ) : null}
          </div>
        ) : null}
        {parseOkSummary ? <div className="text-xs text-foreground">{parseOkSummary}</div> : null}
        {(parseErr || (input.parseStatus === "FAILED" && input.importErrorMessage)) ? (
          <div className="text-xs text-destructive whitespace-pre-wrap">
            {parseErr ?? input.importErrorMessage}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card overflow-hidden min-h-[420px] flex flex-col">
          <div className="border-b border-border px-3 py-2 ui-title text-xs uppercase tracking-wide text-muted-foreground">
            PDF
          </div>
          <div className="flex-1 min-h-[360px] bg-muted/20">
            {input.mimeType === "application/pdf" ? (
              <iframe title={input.originalFilename} src={previewUrl} className="h-full min-h-[360px] w-full border-0" />
            ) : (
              <div className="p-4 text-xs text-muted-foreground">Preview available for PDF only.</div>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">Parsed setup</div>
              {input.parsedSetupManuallyEdited ? (
                <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                  Includes manual field corrections (structured keys, not PDF widgets).
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Values map to setup fields (e.g. downstop_front). Parsing again replaces extractor output.
                </div>
              )}
            </div>
            {parseOk ? (
              <div className="flex flex-wrap items-center gap-2">
                {!editingSetup ? (
                  <button
                    type="button"
                    onClick={() => setEditingSetup(true)}
                    className="rounded-md border border-border bg-muted/60 px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    Edit setup
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={savingSetup}
                      onClick={() => void saveStructuredSetup()}
                      className="rounded-md border border-border bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {savingSetup ? "Saving…" : "Save changes"}
                    </button>
                    <button
                      type="button"
                      disabled={savingSetup}
                      onClick={() => setEditingSetup(false)}
                      className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          {setupSaveErr ? <div className="px-3 pt-2 text-xs text-destructive">{setupSaveErr}</div> : null}
          <div className="p-2 max-h-[70vh] overflow-auto">
            {parseOk ? (
              <SetupSheetView
                value={localSetup}
                onChange={(next) => setLocalSetup(applyDerivedFieldsToSnapshot(next))}
                template={template}
                readOnly={!editingSetup}
              />
            ) : (
              <div className="p-3 text-sm text-muted-foreground">
                Parse failed or not run yet. Choose a calibration and run parse, or fix errors above.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">Dataset review</div>
        <div className="text-sm">
          Parse status:{" "}
          <span className={parseOk ? "text-foreground" : "text-destructive"}>{input.parseStatus}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Confirmation: <span className="text-foreground">{reviewStatus}</span> · Aggregation dataset:{" "}
          <span className="text-foreground">{eligible ? "eligible" : "not eligible"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving || !parseOk}
            onClick={() => void saveReview("CONFIRMED_ACCURATE")}
            className="rounded-md border border-border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Confirmed accurate
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveReview("NOT_CONFIRMED")}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
          >
            Not confirmed
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveReview("UNSET")}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
          >
            Clear review
          </button>
        </div>
        {!parseOk ? (
          <p className="text-[11px] text-muted-foreground">Failed or incomplete parses cannot be confirmed for aggregation.</p>
        ) : null}
        {err ? <div className="text-xs text-destructive">{err}</div> : null}
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground mb-1">
          Diagnostics / warnings (raw)
        </div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{diagStr || "—"}</pre>
      </div>
    </div>
  );
}
