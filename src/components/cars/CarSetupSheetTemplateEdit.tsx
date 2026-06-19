"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { labelForSetupSheetTemplate } from "@/lib/setupSheetTemplateId";
import { CardPanel } from "@/components/ui/CardPanel";

type SheetModelOption = { id: string; name: string; slug: string };

export function CarSetupSheetTemplateEdit({
  carId,
  currentTemplate,
}: {
  carId: string;
  currentTemplate: string | null;
}) {
  const router = useRouter();
  const [models, setModels] = useState<SheetModelOption[]>([]);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/setup-sheet-models")
      .then((r) => r.json())
      .then((d: { models?: SheetModelOption[] }) => setModels(d.models ?? []))
      .catch(() => {});
  }, []);

  const dirty = Boolean(value);

  async function handleSave() {
    if (!dirty || !value) return;
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/cars/${carId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupSheetModelId: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || "Failed to update");
      setMessage("Saved.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CardPanel contentClassName="text-sm">
      <div className="text-sm font-medium text-muted-foreground mb-2">
        Setup sheet model <span className="font-normal">(car type for setup features)</span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-2">
        Current:{" "}
        <span className="font-medium text-foreground">
          {labelForSetupSheetTemplate(currentTemplate)}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          <option value="">Select model…</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {dirty && (
          <button
            type="button"
            disabled={saving || !value}
            onClick={handleSave}
            className={cn(
              buttonLinkClassName("primary"),
              saving && "opacity-70 pointer-events-none"
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
        {message && (
          <span className={cn("text-xs", message === "Saved." ? "text-accent" : "text-muted-foreground")}>
            {message}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        Links the car to structured setup data: community aggregations, Engineer spread, and setup compare are keyed by
        model. All models you create in the setup wizard appear here.
      </p>
    </CardPanel>
  );
}
