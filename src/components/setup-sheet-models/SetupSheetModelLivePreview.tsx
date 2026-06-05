"use client";

import { useMemo, useState } from "react";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import {
  buildSetupSheetTemplateFromParsedSchema,
  type SetupSheetTemplateView,
} from "@/lib/setupSheetModels/buildSetupSheetTemplate";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

const PREVIEW_MODES: { value: SetupSheetTemplateView; label: string; hint: string }[] = [
  { value: "setup", label: "Setup page", hint: "Full setup editor" },
  { value: "logRun", label: "Log run", hint: "Fields shown when logging a run" },
  { value: "analysis", label: "Analysis", hint: "Compare / analysis views" },
];

export function SetupSheetModelLivePreview(props: {
  modelId: string;
  modelName: string;
  schema: SetupSheetModelSchema;
}) {
  const { modelId, modelName, schema } = props;
  const [previewMode, setPreviewMode] = useState<SetupSheetTemplateView>("setup");

  const previewTemplate = useMemo(
    () => buildSetupSheetTemplateFromParsedSchema(modelId, modelName, schema, previewMode),
    [modelId, modelName, schema, previewMode]
  );

  const activeHint = PREVIEW_MODES.find((m) => m.value === previewMode)?.hint ?? "";

  return (
    <div className="min-w-0 space-y-2 xl:sticky xl:top-4 xl:self-start">
      <div>
        <div className="text-[11px] font-medium text-foreground">Live preview</div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Matches what drivers see after you save — same template builder as Setup, Log run, and Analysis.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PREVIEW_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`rounded-md border px-2 py-1 text-[11px] transition ${
              previewMode === m.value
                ? "border-sky-500/50 bg-sky-500/15 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setPreviewMode(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {activeHint ? (
        <p className="text-[10px] text-muted-foreground">{activeHint}</p>
      ) : null}
      <SetupSheetView value={{}} onChange={() => {}} readOnly template={previewTemplate} />
    </div>
  );
}
