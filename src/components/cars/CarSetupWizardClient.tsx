"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SetupSheetModelSchemaEditor } from "@/components/setup-sheet-models/SetupSheetModelSchemaEditor";
import { buildGenericPresetSchema } from "@/lib/setupSheetModels/genericPresetSchema";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { SETUP_SHEET_TEMPLATE_A800RR } from "@/lib/setupSheetTemplateId";

type SheetModelOption = { id: string; name: string; slug: string };

type Step = "car" | "schema" | "upload" | "done";

export function CarSetupWizardClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("car");
  const [models, setModels] = useState<SheetModelOption[]>([]);
  const [carName, setCarName] = useState("");
  const [chassis, setChassis] = useState("");
  const [modelMode, setModelMode] = useState<"existing" | "new">("new");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [schema, setSchema] = useState<SetupSheetModelSchema | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [carId, setCarId] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [calibrationId, setCalibrationId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/setup-sheet-models")
      .then((r) => r.json())
      .then((d: { models?: SheetModelOption[] }) => setModels(d.models ?? []))
      .catch(() => {});
  }, []);

  const ensureSchemaForNewModel = useCallback(() => {
    const name = newModelName.trim() || chassis.trim() || "New sheet";
    setSchema(buildGenericPresetSchema(name));
  }, [newModelName, chassis]);

  async function createModelAndSaveSchema(): Promise<string> {
    const name = newModelName.trim() || chassis.trim();
    if (!name) throw new Error("Sheet model name is required.");
    const res = await fetch("/api/setup-sheet-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        schema: schema ?? buildGenericPresetSchema(name),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || "Failed to create sheet model");
    return (data as { model: { id: string } }).model.id;
  }

  async function saveSchemaForModel(id: string) {
    if (!schema) return;
    const res = await fetch(`/api/setup-sheet-models/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || "Failed to save parameters");
  }

  async function createCar(mid: string) {
    const name = carName.trim();
    if (!name) throw new Error("Car name is required.");
    const res = await fetch("/api/cars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        chassis: chassis.trim() || null,
        setupSheetModelId: mid,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || "Failed to create car");
    return (data as { car: { id: string } }).car.id;
  }

  async function handleCarStepNext() {
    setError(null);
    setBusy(true);
    try {
      let mid = modelMode === "existing" ? selectedModelId : null;
      if (modelMode === "new") {
        if (!schema) ensureSchemaForNewModel();
        setStep("schema");
        setBusy(false);
        return;
      }
      if (!mid) throw new Error("Select a setup sheet model.");
      setModelId(mid);
      const cid = await createCar(mid);
      setCarId(cid);
      setStep("upload");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSchemaStepNext() {
    setError(null);
    setBusy(true);
    try {
      let mid = modelId;
      if (!mid) {
        mid = await createModelAndSaveSchema();
        setModelId(mid);
      } else {
        await saveSchemaForModel(mid);
      }
      const cid = await createCar(mid);
      setCarId(cid);
      setStep("upload");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File) {
    if (!carId || !modelId) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("carId", carId);
      fd.append("setupSheetModelId", modelId);
      const res = await fetch("/api/setup-documents", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || "Upload failed");
      const docId = (data as { document?: { id: string } }).document?.id;
      if (!docId) throw new Error("No document id returned");
      setDocumentId(docId);

      const calRes = await fetch("/api/setup-calibrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${newModelName.trim() || carName.trim()} calibration`,
          sourceType: "pdf",
          exampleDocumentId: docId,
          setupSheetModelId: modelId,
          calibrationDataJson: {
            formFieldMappings: {},
            fieldMappings: {},
            fields: {},
            customFieldDefinitions: [],
          },
        }),
      });
      const calData = await calRes.json().catch(() => ({}));
      if (!calRes.ok) throw new Error((calData as { error?: string }).error || "Failed to create calibration");
      const calId = (calData as { calibration?: { id: string } }).calibration?.id;
      if (calId) {
        setCalibrationId(calId);
        await fetch(`/api/setup-documents/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calibrationProfileId: calId }),
        });
      }
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        {(["car", "schema", "upload", "done"] as const).map((s, i) => (
          <span
            key={s}
            className={
              step === s
                ? "rounded bg-foreground/15 px-2 py-0.5 text-foreground"
                : "px-2 py-0.5"
            }
          >
            {i + 1}. {s === "car" ? "Car & model" : s === "schema" ? "Parameters" : s === "upload" ? "PDF" : "Calibrate"}
          </span>
        ))}
      </div>

      {error ? (
        <div className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{error}</div>
      ) : null}

      {step === "car" && (
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <h2 className="ui-title text-sm">Car & setup sheet model</h2>
          <label className="block text-xs text-muted-foreground">
            Car name *
            <input
              className="mt-1 w-full rounded border border-border bg-muted/40 px-3 py-2 text-sm"
              value={carName}
              onChange={(e) => setCarName(e.target.value)}
              placeholder="e.g. Race MTC3"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Chassis / model label (optional)
            <input
              className="mt-1 w-full rounded border border-border bg-muted/40 px-3 py-2 text-sm"
              value={chassis}
              onChange={(e) => setChassis(e.target.value)}
              placeholder="e.g. Mugen MTC3"
            />
          </label>
          <div className="space-y-2">
            <div className="text-xs font-medium text-foreground/90">Setup sheet model</div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                checked={modelMode === "new"}
                onChange={() => {
                  setModelMode("new");
                  setNewModelName(chassis || "");
                }}
              />
              Create new model for this car type
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                checked={modelMode === "existing"}
                onChange={() => setModelMode("existing")}
              />
              Use existing model
            </label>
          </div>
          {modelMode === "new" ? (
            <label className="block text-xs text-muted-foreground">
              Model name (shared by all cars of this type) *
              <input
                className="mt-1 w-full rounded border border-border bg-muted/40 px-3 py-2 text-sm"
                value={newModelName}
                onChange={(e) => {
                  setNewModelName(e.target.value);
                  if (!schema) setSchema(buildGenericPresetSchema(e.target.value || "New sheet"));
                }}
                placeholder="e.g. Mugen MTC3"
              />
            </label>
          ) : (
            <select
              className="w-full rounded border border-border bg-muted/40 px-3 py-2 text-sm"
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
            >
              <option value="">Select model…</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="rounded border border-sky-500/60 bg-sky-500/15 px-4 py-2 text-sm font-medium disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              if (modelMode === "new") {
                ensureSchemaForNewModel();
                setStep("schema");
              } else {
                void handleCarStepNext();
              }
            }}
          >
            Continue
          </button>
        </div>
      )}

      {step === "schema" && schema && (
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <h2 className="ui-title text-sm">Configure parameters</h2>
          <p className="text-[11px] text-muted-foreground">
            Start from generic touring preset. Add parameters and types (e.g. numeric ARB vs one-of-many thicknesses).
          </p>
          <SetupSheetModelSchemaEditor schema={schema} onChange={setSchema} />
          <button
            type="button"
            className="rounded border border-sky-500/60 bg-sky-500/15 px-4 py-2 text-sm font-medium disabled:opacity-50"
            disabled={busy}
            onClick={() => void handleSchemaStepNext()}
          >
            {busy ? "Saving…" : "Save & continue to PDF upload"}
          </button>
        </div>
      )}

      {step === "upload" && (
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <h2 className="ui-title text-sm">Upload example setup PDF</h2>
          <p className="text-[11px] text-muted-foreground">
            We will create a calibration profile linked to this model. Map PDF fields on the next screen.
          </p>
          <input
            type="file"
            accept="application/pdf"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
            }}
          />
          {uploading ? <p className="text-xs text-muted-foreground">Uploading…</p> : null}
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-100">Car and sheet model are ready.</p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            {modelId ? (
              <li>
                <Link href={`/setup-sheet-models/${modelId}/schema`} className="text-sky-300 hover:underline">
                  Edit parameters
                </Link>
              </li>
            ) : null}
            {calibrationId ? (
              <li>
                <Link href={`/setup-calibrations/${calibrationId}`} className="text-sky-300 hover:underline">
                  Map PDF to parameters (calibration editor)
                </Link>
              </li>
            ) : null}
            {documentId ? (
              <li>
                <Link href={`/setup-documents/${documentId}`} className="text-sky-300 hover:underline">
                  Review uploaded document
                </Link>
              </li>
            ) : null}
            <li>
              <Link href="/runs/new" className="text-sky-300 hover:underline">
                Log a run
              </Link>
            </li>
          </ul>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => router.push("/cars")}
          >
            Back to cars
          </button>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Legacy Awesomatix A800RR cars can still use template{" "}
        <span className="font-mono">{SETUP_SHEET_TEMPLATE_A800RR}</span> until fully migrated.
      </p>
    </div>
  );
}
