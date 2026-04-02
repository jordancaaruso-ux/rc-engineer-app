"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { interpretAwesomatixSetupSnapshot } from "@/lib/setupDocuments/awesomatixImportPostProcess";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { getA800rrSetupSheetTemplateWithDisplayPreferences } from "@/lib/setupCalibrations/customFieldCatalog";
import { normalizeCalibrationData, type CustomSetupFieldDefinition } from "@/lib/setupCalibrations/types";
import { getEffectiveFieldCatalog } from "@/lib/setupDocuments/fieldMap";
import { mappedFieldKeys } from "@/lib/setupDocuments/normalize";
import { cn } from "@/lib/utils";
import { formatAppTimestampUtc } from "@/lib/formatDate";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
import { computeA800rrDerived } from "@/lib/setupCalculations/a800rrDerived";
import { computeDetailedDerivedFieldStatuses } from "@/lib/setup/derivedFields";

function formatDerivedValidationLine(
  row: { status?: string; absDelta?: number | null } | undefined
): string {
  if (!row?.status) return "—";
  if (row.status === "no_imported_comparison") return "no imported comparison";
  if (row.status === "missing_input_value") return "not computed";
  if (row.status === "matched" || row.status === "mismatch") {
    const d = row.absDelta;
    return `${row.status}${d != null ? ` Δ=${d.toFixed(3)}` : ""}`;
  }
  return row.status;
}

type CarOption = { id: string; name: string };
type Calibration = {
  id: string;
  name: string;
  sourceType: string;
  calibrationDataJson: unknown;
  createdAt: string | Date;
};

type SetupDocumentDetail = {
  id: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sourceType: "PDF" | "IMAGE";
  parseStatus: "PENDING" | "PARSED" | "PARTIAL" | "FAILED";
  importStatus?: "PENDING" | "PROCESSING" | "FAILED" | "COMPLETED" | "COMPLETED_WITH_WARNINGS";
  importOutcome?: "COMPLETED_TRUSTED" | "COMPLETED_WITH_WARNINGS" | "PARTIAL_DIAGNOSTIC" | "FAILED" | null;
  currentStage?: string | null;
  lastCompletedStage?: string | null;
  importErrorMessage?: string | null;
  importDiagnosticJson?: unknown;
  parseStartedAt?: string | null;
  parseFinishedAt?: string | null;
  calibrationResolvedProfileId?: string | null;
  calibrationResolvedSource?: string | null;
  calibrationResolvedDebug?: string | null;
  calibrationUsedIsForcedDefault?: boolean | null;
  parserType: string | null;
  extractedText: string | null;
  parsedDataJson: unknown;
  calibrationProfileId?: string | null;
  parsedCalibrationProfileId?: string | null;
  parsedAt?: string | null;
  parsedSetupManuallyEdited?: boolean;
  effectiveCalibration?: { calibrationId: string | null; source: string; debug: string };
  createdAt: string;
  updatedAt: string;
  createdSetupId: string | null;
};

export function SetupDocumentReviewClient({
  doc,
  cars,
  calibrations,
}: {
  doc: SetupDocumentDetail;
  cars: CarOption[];
  calibrations: Calibration[];
}) {
  const [liveDoc, setLiveDoc] = useState<SetupDocumentDetail>(doc);
  const [setupData, setSetupData] = useState<SetupSnapshotData>(() =>
    applyDerivedFieldsToSnapshot(interpretAwesomatixSetupSnapshot(normalizeSetupData(doc.parsedDataJson)))
  );
  const [carId, setCarId] = useState<string>("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [creatingSetup, setCreatingSetup] = useState(false);
  const [mode, setMode] = useState<"review" | "manual">("review");
  const [calibrationName, setCalibrationName] = useState(
    `${doc.originalFilename.replace(/\.[^.]+$/, "")} calibration`
  );
  const [savingCalibration, setSavingCalibration] = useState(false);
  const [savingCalibrationSelection, setSavingCalibrationSelection] = useState(false);
  const [processingImport, setProcessingImport] = useState(false);
  const [selectedCalibrationId, setSelectedCalibrationId] = useState("");
  const [calibrationHighlightKeys, setCalibrationHighlightKeys] = useState<Set<string> | null>(null);
  const [formImportDebug, setFormImportDebug] = useState<
    | Array<{
        appKey: string;
        pdfFieldName?: string;
        rawExtracted?: string;
        finalValue: string;
        rawNote: string;
        warning?: string;
      }>
    | null
  >(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originalOpen, setOriginalOpen] = useState(false);
  const router = useRouter();

  const previewUrl = `/api/setup-documents/${liveDoc.id}/file`;
  const forcedCalibrationLabel = liveDoc.effectiveCalibration
    ? `${liveDoc.effectiveCalibration.calibrationId ?? "none"} · ${liveDoc.effectiveCalibration.source}`
    : (liveDoc.calibrationProfileId ? `${liveDoc.calibrationProfileId} · stored` : "none");
  const parseStamp = liveDoc.parsedCalibrationProfileId
    ? `${liveDoc.parsedCalibrationProfileId}${liveDoc.parsedAt ? ` · ${formatAppTimestampUtc(liveDoc.parsedAt)}` : ""}`
    : "—";
  const parseStatusLabel =
    liveDoc.parseStatus === "PARSED"
      ? "Parsed"
      : liveDoc.parseStatus === "PARTIAL"
        ? "Partially Parsed"
        : "Minimal Parse";
  const awaitingCalibration = !liveDoc.calibrationProfileId || liveDoc.currentStage === "awaiting_calibration";
  const parseIsStale = Boolean(
    liveDoc.calibrationProfileId
    && liveDoc.parsedCalibrationProfileId
    && liveDoc.calibrationProfileId !== liveDoc.parsedCalibrationProfileId
  );
  const hasProcessedResult = Boolean(
    liveDoc.parsedCalibrationProfileId
    && !parseIsStale
    && (liveDoc.parseStatus === "PARSED" || liveDoc.parseStatus === "PARTIAL")
  );
  const reviewState: "awaiting_calibration" | "selected_not_processed" | "processing" | "processed" | "warnings" | "failed" =
    awaitingCalibration
      ? "awaiting_calibration"
      : liveDoc.importStatus === "PROCESSING"
        ? "processing"
        : liveDoc.importStatus === "FAILED"
          ? "failed"
          : liveDoc.importStatus === "COMPLETED_WITH_WARNINGS"
            ? "warnings"
            : !hasProcessedResult
              ? "selected_not_processed"
              : liveDoc.importOutcome === "COMPLETED_WITH_WARNINGS" || liveDoc.importOutcome === "PARTIAL_DIAGNOSTIC"
                ? "warnings"
                : "processed";
  useEffect(() => {
    setSetupData(applyDerivedFieldsToSnapshot(interpretAwesomatixSetupSnapshot(normalizeSetupData(liveDoc.parsedDataJson))));
  }, [liveDoc.id, liveDoc.updatedAt, liveDoc.parsedDataJson]);

  // Keep picker synced to the document's stored calibration selection.
  useEffect(() => {
    setSelectedCalibrationId(liveDoc.calibrationProfileId || "");
  }, [liveDoc.id, liveDoc.calibrationProfileId]);

  useEffect(() => {
    // Poll only while processing (never auto-start processing).
    let alive = true;
    const id = liveDoc.id;

    async function fetchDoc(): Promise<SetupDocumentDetail | null> {
      const res = await fetch(`/api/setup-documents/${id}`);
      const data = (await res.json().catch(() => ({}))) as { document?: SetupDocumentDetail; error?: string };
      if (!res.ok || !data.document) return null;
      return data.document;
    }

    if (liveDoc.importStatus !== "PROCESSING") return () => { alive = false; };

    const poll = async () => {
      const next = await fetchDoc().catch(() => null);
      if (!alive || !next) return;
      setLiveDoc((cur) => (cur.updatedAt === next.updatedAt ? cur : next));
      if (next.importStatus !== "PROCESSING") return;
      window.setTimeout(poll, 1500);
    };
    window.setTimeout(poll, 600);

    return () => {
      alive = false;
    };
    // Intentionally only depend on id + importStatus so we don’t restart polling aggressively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveDoc.id, liveDoc.importStatus]);

  const filledCount = useMemo(() => mappedFieldKeys(setupData).length, [setupData]);
  const mappedKeys = useMemo(() => mappedFieldKeys(setupData), [setupData]);
  const selectedCalibration = useMemo(
    () => calibrations.find((c) => c.id === selectedCalibrationId) ?? null,
    [calibrations, selectedCalibrationId]
  );
  const storedCalibration = useMemo(
    () => calibrations.find((c) => c.id === (liveDoc.calibrationProfileId ?? "")) ?? null,
    [calibrations, liveDoc.calibrationProfileId]
  );
  const missingStoredCalibration = Boolean(
    liveDoc.calibrationProfileId && !storedCalibration
  );
  const calibrationForView = storedCalibration ?? selectedCalibration;
  const selectedCalibrationNormalized = useMemo(() => {
    if (!calibrationForView?.calibrationDataJson) return null;
    return normalizeCalibrationData(calibrationForView.calibrationDataJson);
  }, [calibrationForView]);
  const fallbackCustomFieldDefinitions = useMemo<CustomSetupFieldDefinition[]>(() => {
    const existing = new Set(
      getEffectiveFieldCatalog(selectedCalibrationNormalized?.customFieldDefinitions ?? []).map((f) => f.key)
    );
    const unknownKeys = Object.keys(setupData).filter((k) => {
      if (existing.has(k)) return false;
      if (/^text\d+$/i.test(k)) return false;
      if (/^checkbox\d+$/i.test(k)) return false;
      if (k.startsWith("front_spring_calc_") || k.startsWith("rear_spring_calc_")) return false;
      if (k.startsWith("imported_displayed_")) return false;
      return true;
    });
    return unknownKeys.map((k, idx) => ({
      id: `fallback_${k}`,
      key: k,
      displayLabel: k.replace(/_/g, " "),
      sectionId: "other",
      sectionTitle: "Other",
      fieldDomain: "metadata",
      valueType: "string",
      uiType: "text",
      isMetadata: true,
      showInSetupSheet: true,
      showInAnalysis: true,
      isPdfExportable: true,
      sortOrder: 10000 + idx,
    }));
  }, [selectedCalibrationNormalized, setupData]);
  const effectiveCustomFieldDefinitions = useMemo(
    () => [...(selectedCalibrationNormalized?.customFieldDefinitions ?? []), ...fallbackCustomFieldDefinitions],
    [selectedCalibrationNormalized, fallbackCustomFieldDefinitions]
  );
  const reviewSetupTemplate = useMemo(
    () =>
      getA800rrSetupSheetTemplateWithDisplayPreferences(
        effectiveCustomFieldDefinitions,
        selectedCalibrationNormalized?.fieldDisplayOverrides,
        "setup"
      ),
    [selectedCalibrationNormalized, effectiveCustomFieldDefinitions]
  );
  const totalTrackedFields = useMemo(
    () => getEffectiveFieldCatalog(effectiveCustomFieldDefinitions).length,
    [effectiveCustomFieldDefinitions]
  );
  const blankTrackedFields = Math.max(0, totalTrackedFields - mappedKeys.length);
  const shouldSuggestManual = liveDoc.parseStatus === "FAILED" || mappedKeys.length < 8;

  const parseStartedAtMs = liveDoc.parseStartedAt ? Date.parse(liveDoc.parseStartedAt) : null;
  const parseAgeMs = parseStartedAtMs ? Date.now() - parseStartedAtMs : null;
  const stuck = liveDoc.importStatus === "PROCESSING" && (parseAgeMs != null ? parseAgeMs > 60000 : false);
  const diagnostic = liveDoc.importDiagnosticJson as any;
  const liveDerived = useMemo(() => {
    const { diagnostics } = computeA800rrDerived(setupData);
    return {
      diagnostics,
      statuses: computeDetailedDerivedFieldStatuses(setupData, diagnostics),
    };
  }, [setupData]);
  const derivedStatuses = liveDerived.statuses;
  const derivedValidation = liveDerived.diagnostics.validation;
  const resolutionHints = liveDerived.diagnostics.resolutionHints;

  async function saveDraft() {
    setSavingDraft(true);
    setError(null);
    setStatus(null);
    try {
      const nextStatus = filledCount >= 10 ? "PARSED" : filledCount > 0 ? "PARTIAL" : "FAILED";
      const res = await fetch(`/api/setup-documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parsedDataJson: setupData,
          parseStatus: nextStatus,
          manualStructuredEdit: mode === "manual",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        document?: Partial<SetupDocumentDetail>;
      };
      if (!res.ok) {
        setError(data.error || "Failed to save draft");
        return;
      }
      if (data.document) {
        setLiveDoc((cur) => ({ ...cur, ...data.document }));
      }
      setStatus(mode === "manual" ? "Structured setup saved." : "Draft saved.");
    } catch {
      setError("Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  }

  async function createSetup() {
    if (liveDoc.createdSetupId) return;
    setCreatingSetup(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/setup-documents/${doc.id}/create-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupData, carId: carId || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; setup?: { id: string } };
      if (!res.ok || !data.setup?.id) {
        setError(data.error || "Failed to create setup");
        return;
      }
      setStatus(`Setup created (${data.setup.id}).`);
      window.location.reload();
    } catch {
      setError("Failed to create setup");
    } finally {
      setCreatingSetup(false);
    }
  }

  async function reparseNow() {
    setReparsing(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/setup-documents/${doc.id}/reparse`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mappedFieldCount?: number;
        extractedTextLength?: number;
        parserNote?: string | null;
      };
      if (!res.ok) {
        setError(data.error || "Re-parse failed");
        return;
      }
      setStatus(
        `Re-parse complete · mapped ${data.mappedFieldCount ?? 0} · text length ${data.extractedTextLength ?? 0}${
          data.parserNote ? ` · ${data.parserNote}` : ""
        }`
      );
      window.location.reload();
    } catch {
      setError("Re-parse failed");
    } finally {
      setReparsing(false);
    }
  }

  async function saveCalibration() {
    setSavingCalibration(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/setup-calibrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: calibrationName.trim() || "Setup sheet calibration",
          sourceType: doc.mimeType === "application/pdf" ? "awesomatix_pdf" : "awesomatix_image_v1",
          exampleDocumentId: doc.id,
          calibrationDataJson: {
            templateType: "pdf_form_fields",
            documentMeta: { lineGroupingEpsilon: 2.5 },
            formFieldMappings: {},
            fieldMappings: {},
            fields: {},
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!res.ok || !data.id) {
        setError(data.error || "Failed to save calibration");
        return;
      }
      setStatus("Template created. Opening text mapping…");
      router.push(`/setup-calibrations/${data.id}`);
      router.refresh();
    } catch {
      setError("Failed to save calibration");
    } finally {
      setSavingCalibration(false);
    }
  }

  function applyCalibration() {
    void (async () => {
      if (!selectedCalibration) return;
      setError(null);
      setStatus("Applying calibration…");
      try {
        const res = await fetch(`/api/setup-documents/${doc.id}/apply-calibration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calibrationId: selectedCalibration.id }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          parsedData?: unknown;
          importedKeys?: string[];
          importedCount?: number;
          calibration?: { name?: string };
          formImportDebug?: Array<{
            appKey: string;
            pdfFieldName?: string;
            rawExtracted?: string;
            finalValue: string;
            rawNote: string;
            warning?: string;
          }>;
        };
        if (!res.ok) {
          setError(data.error || "Failed to apply calibration");
          setStatus(null);
          return;
        }
        const next = applyDerivedFieldsToSnapshot(interpretAwesomatixSetupSnapshot(normalizeSetupData(data.parsedData ?? {})));
        const imported = new Set(data.importedKeys ?? []);
        setSetupData(next);
        setLiveDoc((cur) => ({
          ...cur,
          calibrationProfileId: selectedCalibration.id,
          parsedCalibrationProfileId: selectedCalibration.id,
          parsedSetupManuallyEdited: false,
        }));
        setCalibrationHighlightKeys(imported);
        setFormImportDebug(Array.isArray(data.formImportDebug) && data.formImportDebug.length ? data.formImportDebug : null);
        setStatus(
          `Applied calibration: ${data.calibration?.name ?? selectedCalibration.name} (${data.importedCount ?? imported.size} fields prefilled).`
        );
      } catch {
        setError("Failed to apply calibration");
        setStatus(null);
      }
    })();
  }

  async function saveSelectedCalibrationToDocument() {
    setSavingCalibrationSelection(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/setup-documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calibrationProfileId: selectedCalibrationId || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Failed to save calibration selection");
        return;
      }
      setLiveDoc((cur) => ({
        ...cur,
        calibrationProfileId: selectedCalibrationId || null,
        parsedCalibrationProfileId: null,
        parsedAt: null,
        parseStatus: "PENDING",
        importStatus: "PENDING",
        currentStage: selectedCalibrationId ? "calibration_selected" : "awaiting_calibration",
      }));
      setStatus(
        selectedCalibrationId
          ? `Selected calibration saved: ${selectedCalibration?.name ?? selectedCalibrationId}. Reprocess to refresh parsed values.`
          : "Calibration selection cleared."
      );
    } catch {
      setError("Failed to save calibration selection");
    } finally {
      setSavingCalibrationSelection(false);
    }
  }

  async function processNow() {
    if (!liveDoc.calibrationProfileId) {
      setError("Select and save a calibration before processing.");
      return;
    }
    setProcessingImport(true);
    setError(null);
    setStatus("Processing document with selected calibration…");
    try {
      const res = await fetch(`/api/setup-documents/${doc.id}/process`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok && data.status !== "awaiting_calibration") {
        setError(data.error || "Failed to start processing");
        setStatus(null);
        return;
      }
      if (data.status === "awaiting_calibration") {
        setStatus("Awaiting calibration selection.");
        return;
      }
      setLiveDoc((cur) => ({ ...cur, importStatus: "PROCESSING" }));
      setStatus("Processing started.");
    } catch {
      setError("Failed to start processing");
      setStatus(null);
    } finally {
      setProcessingImport(false);
    }
  }

  return (
    <section className="page-body space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="ui-title text-sm">{doc.originalFilename}</h2>
            <p className="text-xs text-muted-foreground">
              {liveDoc.sourceType} · {parseStatusLabel} · {liveDoc.parserType ?? "no parser"}
            </p>
          </div>
          <Link href="/setup-documents" className="text-xs text-muted-foreground hover:text-foreground">
            Back to documents
          </Link>
        </div>
        <div className="mt-2 rounded border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Review state:{" "}
          <span className="font-mono text-foreground">
            {reviewState === "awaiting_calibration"
              ? "uploaded_no_calibration"
              : reviewState === "selected_not_processed"
                ? "calibration_selected_not_processed"
                : reviewState}
          </span>
        </div>
        {shouldSuggestManual ? (
          <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Auto-parse is incomplete. You can apply an existing calibration, create a new calibration for this layout, or continue manually.
          </div>
        ) : null}
        {status ? <p className="mt-2 text-xs text-muted-foreground">{status}</p> : null}
        {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}

        <div className="mt-3 rounded border border-border/70 bg-muted/30 p-2 text-xs">
          <div className="ui-title text-[11px] text-muted-foreground">Import diagnostics</div>
          <div className="mt-1 grid grid-cols-1 gap-1.5 text-[11px] text-muted-foreground md:grid-cols-2">
            <div>
              <span className="text-foreground">Import status:</span>{" "}
              <span
                className={cn(
                  liveDoc.importStatus === "FAILED"
                    ? "text-rose-300"
                    : liveDoc.importStatus === "COMPLETED_WITH_WARNINGS"
                      ? "text-amber-200"
                      : "text-foreground"
                )}
              >
                {liveDoc.importStatus ?? "—"}
              </span>
            </div>
            <div>
              <span className="text-foreground">Outcome:</span>{" "}
              <span
                className={cn(
                  liveDoc.importOutcome === "COMPLETED_TRUSTED"
                    ? "text-emerald-300"
                    : liveDoc.importOutcome === "COMPLETED_WITH_WARNINGS" || liveDoc.importOutcome === "PARTIAL_DIAGNOSTIC"
                      ? "text-amber-200"
                      : liveDoc.importOutcome === "FAILED"
                        ? "text-rose-300"
                        : "text-muted-foreground"
                )}
              >
                {liveDoc.importOutcome ?? "—"}
              </span>
            </div>
            <div>
              <span className="text-foreground">Last completed stage:</span>{" "}
              <span className="font-mono">{liveDoc.lastCompletedStage ?? "—"}</span>
            </div>
            <div className="md:col-span-2">
              <span className="text-foreground">Current stage:</span>{" "}
              <span className="font-mono">{liveDoc.currentStage ?? "—"}</span>
              {stuck ? <span className="ml-2 text-amber-200/90">(stuck &gt; 60s)</span> : null}
            </div>
            {liveDoc.importStatus === "FAILED" && liveDoc.importErrorMessage ? (
              <div className="md:col-span-2">
                <span className="text-foreground">Error:</span>{" "}
                <span className="text-rose-300">{liveDoc.importErrorMessage}</span>
              </div>
            ) : null}
            {diagnostic && typeof diagnostic === "object" ? (
              <div className="md:col-span-2">
                <details className="rounded border border-border/60 bg-muted/20 p-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                    Diagnostic extraction (raw PDF fields)
                  </summary>
                  <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    <div>
                      <span className="text-foreground">Pages:</span> {diagnostic.pageCount ?? "—"} ·{" "}
                      <span className="text-foreground">Tokens:</span> {diagnostic.tokenCount ?? "—"} ·{" "}
                      <span className="text-foreground">PDF fields:</span> {diagnostic.pdfFieldCount ?? "—"}
                    </div>
                    <div>
                      <span className="text-foreground">Calibration attempted:</span>{" "}
                      <span className="font-mono">{diagnostic.calibrationAttemptedId ?? "—"}</span>{" "}
                      {diagnostic.calibrationAttemptedName ? `(${diagnostic.calibrationAttemptedName})` : ""}
                    </div>
                    {Array.isArray(diagnostic.pdfFieldNamesSample) ? (
                      <div className="font-mono text-[10px] whitespace-pre-wrap break-words">
                        {diagnostic.pdfFieldNamesSample.slice(0, 80).join("\n")}
                      </div>
                    ) : null}
                    {diagnostic.mapping ? (
                      <div className="mt-2 rounded border border-border/60 bg-card/40 p-2">
                        <div>
                          <span className="text-foreground">Matched keys:</span>{" "}
                          {diagnostic.mapping?.matched?.keys ?? 0}
                        </div>
                        {Array.isArray(diagnostic.mapping?.unmatched?.expectedFormKeys) ? (
                          <div className="mt-1">
                            <span className="text-foreground">Missing expected form keys (sample):</span>{" "}
                            <span className="font-mono text-[10px]">
                              {diagnostic.mapping.unmatched.expectedFormKeys.slice(0, 25).join(", ") || "—"}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </details>
              </div>
            ) : null}
            <div className="md:col-span-2">
              <span className="text-foreground">Calibration chosen:</span>{" "}
              <span className="font-mono">{liveDoc.calibrationResolvedProfileId ?? liveDoc.effectiveCalibration?.calibrationId ?? "—"}</span>{" "}
              <span className="opacity-80">
                ({liveDoc.calibrationResolvedSource ?? liveDoc.effectiveCalibration?.source ?? "unknown"})
              </span>
            </div>
            {liveDoc.calibrationResolvedDebug ? (
              <div className="md:col-span-2">
                <span className="text-foreground">Calibration debug:</span>{" "}
                <span className="font-mono break-all">{liveDoc.calibrationResolvedDebug}</span>
              </div>
            ) : null}
            <div>
              <span className="text-foreground">Parse started:</span>{" "}
              {formatAppTimestampUtc(liveDoc.parseStartedAt)}
            </div>
            <div>
              <span className="text-foreground">Parse finished:</span>{" "}
              {formatAppTimestampUtc(liveDoc.parseFinishedAt)}
            </div>
          </div>
          {liveDoc.importStatus === "FAILED" || stuck ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
                onClick={() => void processNow()}
                disabled={!liveDoc.calibrationProfileId || processingImport}
              >
                Retry import
              </button>
              <span className="text-[10px] text-muted-foreground">
                If this keeps stalling, the stage above tells us exactly where it stops.
              </span>
            </div>
          ) : null}
        </div>
        {formImportDebug?.length ? (
          <details className="mt-2 rounded border border-border/70 bg-muted/30 p-2 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">PDF form import debug</summary>
            <ul className="mt-2 max-h-48 space-y-1.5 overflow-auto font-mono text-[10px] text-muted-foreground">
              {formImportDebug.map((row) => (
                <li key={row.appKey} className="border-b border-border/40 pb-1 last:border-0">
                  <span className="text-foreground">{row.appKey}</span>
                  <span className="mx-1">→</span>
                  <span className="text-emerald-200/90">{row.finalValue || "—"}</span>
                  {row.pdfFieldName ? (
                    <div className="mt-0.5 text-[9px] opacity-90">PDF field: {row.pdfFieldName}</div>
                  ) : null}
                  {row.rawExtracted != null ? (
                    <div className="mt-0.5 text-[9px] opacity-90">raw extract: {row.rawExtracted}</div>
                  ) : null}
                  <div className="mt-0.5 text-[9px] opacity-90">note: {row.rawNote}</div>
                  {row.warning ? <div className="text-amber-200/90">warn: {row.warning}</div> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground md:grid-cols-3">
          <div className="rounded border border-border/70 bg-muted/40 px-2 py-1.5">
            <span className="text-foreground">{mappedKeys.length} fields imported</span>
          </div>
          <div className="rounded border border-border/70 bg-muted/40 px-2 py-1.5">
            <span className="text-foreground">{blankTrackedFields} fields still blank</span>
          </div>
          <div className="rounded border border-border/70 bg-muted/40 px-2 py-1.5">
            <span className="text-foreground">Parser status: {liveDoc.parseStatus}</span>
          </div>
          <div className="rounded border border-border/70 bg-muted/40 px-2 py-1.5 md:col-span-3">
            <span className="text-foreground">Calibration in use:</span>{" "}
            <span className="font-mono">
              {storedCalibration ? `${storedCalibration.name} (${storedCalibration.id})` : forcedCalibrationLabel}
            </span>
          </div>
          <div className="rounded border border-border/70 bg-muted/40 px-2 py-1.5 md:col-span-3">
            <span className="text-foreground">Parsed with calibration:</span>{" "}
            <span className="font-mono">{parseStamp}</span>
            {parseIsStale ? (
              <span className="ml-2 text-amber-200/90">
                (stale parse — reparse to apply current calibration)
              </span>
            ) : null}
          </div>
          <div className="mt-2 rounded border border-border/70 bg-card/30 px-2 py-1.5 text-[11px] text-muted-foreground">
            <span className="text-foreground">Derived (canonical inputs):</span>{" "}
            <span className="font-mono">
              front={liveDerived.diagnostics.computed.frontSpringRateGfMm != null ? `${liveDerived.diagnostics.computed.frontSpringRateGfMm.toFixed(2)} gf/mm` : "—"}{" "}
              · rear={liveDerived.diagnostics.computed.rearSpringRateGfMm != null ? `${liveDerived.diagnostics.computed.rearSpringRateGfMm.toFixed(2)} gf/mm` : "—"}{" "}
              · final drive={liveDerived.diagnostics.computed.finalDriveRatio != null ? liveDerived.diagnostics.computed.finalDriveRatio.toFixed(4) : "—"}
            </span>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground/95">
              status: spring front={derivedStatuses.front_spring_rate_gf_mm ?? "—"} · spring rear=
              {derivedStatuses.rear_spring_rate_gf_mm ?? "—"} · final drive={derivedStatuses.final_drive_ratio ?? "—"}
            </div>
            <span className="mt-0.5 block text-[10px] opacity-80">
              Imported PDF display fields (text91/text93/ratio) are comparison-only, not canonical.
            </span>
            <div className="mt-1 font-mono text-[10px] opacity-90">
              validate front=
              {formatDerivedValidationLine(derivedValidation.frontSpringRateGfMm)} · rear=
              {formatDerivedValidationLine(derivedValidation.rearSpringRateGfMm)} · ratio=
              {formatDerivedValidationLine(derivedValidation.finalDriveRatio)}
            </div>
            {(resolutionHints.frontSpring || resolutionHints.rearSpring || resolutionHints.finalDrive) && (
              <div className="mt-1 space-y-0.5 text-[10px] text-amber-200/85">
                {resolutionHints.frontSpring ? <div>{resolutionHints.frontSpring}</div> : null}
                {resolutionHints.rearSpring ? <div>{resolutionHints.rearSpring}</div> : null}
                {resolutionHints.finalDrive ? <div>{resolutionHints.finalDrive}</div> : null}
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-border bg-muted/60 px-3 py-1.5 text-xs hover:bg-muted"
            onClick={() => setMode((m) => (m === "manual" ? "review" : "manual"))}
          >
            {mode === "manual" ? "Done editing" : "Edit setup"}
          </button>
          <span className="text-[11px] text-muted-foreground">
            Edit structured fields (e.g. downstop_front), then save. Re-parse or apply template replaces extractor output.
          </span>
        </div>
        <div className="mt-3 rounded border border-border/70 bg-muted/40 p-2">
          <div className="ui-title text-[11px] text-muted-foreground">Apply saved template</div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Saved templates map editable PDF text (and optional regions) to setup fields. Choose one and confirm to prefill.
          </p>
          {missingStoredCalibration ? (
            <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
              Selected calibration not found. Choose another calibration below.
            </div>
          ) : null}
          {!liveDoc.calibrationProfileId ? (
            <div className="mt-2 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1.5 text-[11px] text-blue-100">
              No calibration selected.
            </div>
          ) : null}
          {calibrations.length === 0 ? (
            <div className="mt-2 rounded border border-border/70 bg-card/30 px-2 py-1.5 text-[11px] text-muted-foreground">
              No calibrations available yet. Create one to enable calibrated mapping.
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              value={selectedCalibrationId}
              onChange={(e) => setSelectedCalibrationId(e.target.value)}
            >
              <option value="">Select calibration…</option>
              {calibrations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              onClick={applyCalibration}
              disabled={!selectedCalibration}
            >
              Apply template
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              onClick={saveSelectedCalibrationToDocument}
              disabled={savingCalibrationSelection || (selectedCalibrationId || "") === (liveDoc.calibrationProfileId || "")}
            >
              {savingCalibrationSelection ? "Saving…" : "Save selection"}
            </button>
            <button
              type="button"
              className="rounded-md border border-primary/40 bg-primary/20 px-3 py-1.5 text-xs hover:bg-primary/30 disabled:opacity-60"
              onClick={processNow}
              disabled={processingImport || !liveDoc.calibrationProfileId || liveDoc.importStatus === "PROCESSING"}
            >
              {processingImport || liveDoc.importStatus === "PROCESSING" ? "Processing…" : "Process with calibration"}
            </button>
            <a href="/setup-calibrations" className="text-xs text-muted-foreground hover:text-foreground">
              Manage calibrations
            </a>
            <button
              type="button"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              onClick={saveCalibration}
              disabled={savingCalibration || doc.mimeType !== "application/pdf"}
            >
              {savingCalibration ? "Creating…" : "Create text template from PDF"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={mode === "manual" ? "xl:sticky xl:top-4 xl:self-start" : ""}>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">Original sheet</div>
              <button
                type="button"
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
                onClick={() => setOriginalOpen(true)}
              >
                View Original Sheet
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              View-only reference. Use the structured setup on the right for edits.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className={mode === "manual" ? "xl:sticky xl:top-4 xl:z-10" : ""}>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">
                {mode === "manual" ? "Edit structured setup" : "Review parsed setup"}
              </div>
              {liveDoc.parsedSetupManuallyEdited ? (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                  This document includes saved manual corrections to structured fields.
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {mode === "manual"
                  ? "Adjust values to fix mis-mapped or ambiguous PDF fields, then save changes."
                  : "Read-only review. Click Edit setup to change structured fields, then save."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  className="rounded-md border border-border bg-muted/60 px-2 py-1.5 text-xs"
                  value={carId}
                  onChange={(e) => setCarId(e.target.value)}
                >
                  <option value="">No car link</option>
                  {cars.map((car) => (
                    <option key={car.id} value={car.id}>
                      {car.name}
                    </option>
                  ))}
                </select>
                {mode === "manual" ? (
                  <button
                    type="button"
                    className="rounded-md border border-border bg-muted/60 px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                    onClick={saveDraft}
                    disabled={savingDraft}
                  >
                    {savingDraft ? "Saving…" : "Save changes"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-md border border-border bg-muted/60 px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                  onClick={reparseNow}
                  disabled={reparsing}
                >
                  {reparsing ? "Re-parsing…" : "Re-parse"}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-primary/40 bg-primary/20 px-3 py-1.5 text-xs hover:bg-primary/30 disabled:opacity-60"
                  onClick={createSetup}
                  disabled={creatingSetup || Boolean(liveDoc.createdSetupId)}
                >
                  {liveDoc.createdSetupId ? "Setup already created" : creatingSetup ? "Creating…" : "Create setup from document"}
                </button>
              </div>
              <div className="mt-3 rounded border border-border/70 bg-muted/40 p-2">
                <div className="ui-title text-[11px] text-muted-foreground">New text template</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    className="min-w-[18rem] rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                    value={calibrationName}
                    onChange={(e) => setCalibrationName(e.target.value)}
                    placeholder="Calibration name"
                  />
                  <button
                    type="button"
                    className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                    onClick={saveCalibration}
                    disabled={savingCalibration || doc.mimeType !== "application/pdf"}
                  >
                    {savingCalibration ? "Creating…" : "Create text template"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {hasProcessedResult ? (
            <SetupSheetView
              value={setupData}
              onChange={(next) => setSetupData(applyDerivedFieldsToSnapshot(next))}
              template={reviewSetupTemplate}
              highlightChangedKeys={calibrationHighlightKeys}
              readOnly={mode === "review"}
            />
          ) : (
            <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              {awaitingCalibration
                ? "No calibration selected yet. Save a calibration selection, then process the document."
                : "Calibration is selected but this document has not been processed with it yet. Run process to load parsed setup values."}
            </div>
          )}

          <div className="rounded-lg border border-border bg-card p-3">
            <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">Extracted text</div>
            <div className="mt-1 rounded border border-border/70 bg-muted/40 p-2 text-[11px] text-muted-foreground">
              <div>Text length: {(liveDoc.extractedText ?? "").length}</div>
              <div>Mapped field count: {mappedKeys.length}</div>
              <div className="truncate">Mapped keys: {mappedKeys.length ? mappedKeys.join(", ") : "none"}</div>
              <div>Parser note: {status?.trim() || "—"}</div>
            </div>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
              {liveDoc.extractedText?.trim() || "No extracted text available."}
            </pre>
          </div>
        </div>
      </div>

      {originalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Original setup sheet"
          onClick={(e) => e.target === e.currentTarget && setOriginalOpen(false)}
        >
          <div
            className="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-lg border border-border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border bg-background/95 px-3 py-2">
              <div className="min-w-0 truncate text-xs text-muted-foreground">{doc.originalFilename}</div>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                onClick={() => setOriginalOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="h-[80vh] bg-muted/20">
              {doc.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt={doc.originalFilename} className="h-full w-full object-contain" />
              ) : (
                <iframe title={doc.originalFilename} src={previewUrl} className="h-full w-full border-0" />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

