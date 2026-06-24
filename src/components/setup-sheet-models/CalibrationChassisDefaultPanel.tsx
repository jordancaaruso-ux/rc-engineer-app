"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

type ModelRow = {
  id: string;
  name: string;
  slug: string;
  carCount: number;
  calibrationCount: number;
};

type Props = {
  calibrationId: string;
  calibrationName: string;
  currentModelId: string | null;
  currentModelName: string | null;
};

export function CalibrationChassisDefaultPanel(props: Props) {
  const router = useRouter();
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState(props.currentModelId ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/setup-sheet-models");
        const data = (await res.json().catch(() => ({}))) as { models?: ModelRow[] };
        if (!cancelled && res.ok && data.models) setModels(data.models);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedModelId(props.currentModelId ?? "");
  }, [props.currentModelId]);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId) ?? null,
    [models, selectedModelId]
  );

  const onSetDefault = useCallback(async () => {
    const modelId = selectedModelId.trim();
    if (!modelId) {
      setStatus("Pick a chassis type first.");
      return;
    }
    const modelName = selectedModel?.name ?? "this chassis";
    const ok = window.confirm(
      `Use "${props.calibrationName}" as the default calibration for ${modelName}?\n\n` +
        "New uploads for that chassis will prefer this profile when the PDF layout matches."
    );
    if (!ok) return;

    setBusy(true);
    setStatus(null);
    try {
      const linkRes = await fetch(`/api/setup-calibrations/${props.calibrationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupSheetModelId: modelId }),
      });
      const linkData = (await linkRes.json().catch(() => ({}))) as { error?: string };
      if (!linkRes.ok) throw new Error(linkData.error || "Failed to link calibration");

      const defaultRes = await fetch(`/api/setup-sheet-models/${modelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultCalibrationId: props.calibrationId }),
      });
      const defaultData = (await defaultRes.json().catch(() => ({}))) as { error?: string };
      if (!defaultRes.ok) throw new Error(defaultData.error || "Failed to set default calibration");

      setStatus(`Saved as default for ${modelName}.`);
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }, [
    props.calibrationId,
    props.calibrationName,
    router,
    selectedModel?.name,
    selectedModelId,
  ]);

  return (
    <CardPanel contentClassName="px-4 py-3 text-sm">
      <Eyebrow dot="accent">Chassis type &amp; default calibration</Eyebrow>
      <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
        Link this profile to a chassis type (e.g. Mugen MTC3) and mark it as the default so uploads
        auto-select it when the PDF matches. If you have duplicate chassis types,{" "}
        <a href="/setup-sheet-models" className="text-accent hover:underline">
          manage chassis types
        </a>{" "}
        to delete extras and keep one.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Chassis type</span>
          <select
            className="ui-control min-w-[220px] rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={selectedModelId}
            disabled={loading || busy}
            onChange={(e) => setSelectedModelId(e.target.value)}
          >
            <option value="">Select…</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.slug})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-primary/10 disabled:opacity-50"
          disabled={loading || busy || !selectedModelId}
          onClick={onSetDefault}
        >
          {busy ? "Saving…" : "Set as chassis default"}
        </button>
      </div>
      {props.currentModelName ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Currently linked to: <span className="text-foreground">{props.currentModelName}</span>
        </p>
      ) : null}
      {status ? <p className="mt-2 text-xs text-foreground">{status}</p> : null}
    </CardPanel>
  );
}
