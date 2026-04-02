"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { SETUP_SHEET_TEMPLATE_OPTIONS } from "@/lib/setupSheetTemplateId";

export function CarSetupSheetTemplateEdit({
  carId,
  currentTemplate,
}: {
  carId: string;
  currentTemplate: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentTemplate ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = value !== (currentTemplate ?? "");

  async function handleSave() {
    if (!dirty) return;
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/cars/${carId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupSheetTemplate: value === "awesomatix_a800rr" ? "awesomatix_a800rr" : null,
        }),
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
    <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm">
      <div className="text-sm font-medium text-muted-foreground mb-2">Setup sheet template</div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          {SETUP_SHEET_TEMPLATE_OPTIONS.map((o) => (
            <option key={o.value || "none"} value={o.value}>{o.label}</option>
          ))}
        </select>
        {dirty && (
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className={cn(
              "rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition",
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
        When set to Awesomatix A800RR, Analysis run details will show a &quot;View setup sheet&quot; button for runs with this car.
      </p>
    </div>
  );
}
