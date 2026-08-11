"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SheetFillSurface } from "@/components/setup/SheetFillSurface";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/utils";

/**
 * Saying what each box on a chassis's sheet is, by tapping it on the sheet.
 *
 * ============================== WHY ON THE PICTURE ==============================
 *
 * The name of a box is written next to it, on the paper, in print the derivation cannot read. So
 * the only way to name two hundred boxes correctly is to look at each one where it sits — and the
 * surface that already does that well is the one drivers fill in. This is that surface in naming
 * mode: same panning, same zoom, same stepping, different bar.
 *
 * ============================== WHY IT SAVES IN ONE GO ==============================
 *
 * Naming a sheet is one long sitting, not a thing done between heats, and every box named is a
 * write to a schema every driver on that chassis reads. So the names are collected here and sent
 * once, and until then nothing anyone else sees has changed.
 */
export function BoxNamingSurface({
  modelId,
  chassisName,
  initialLabels,
  boxCount,
  initialNamedCount,
}: {
  modelId: string;
  chassisName: string;
  /** Current label per key. Generated position labels arrive empty — there is nothing to keep. */
  initialLabels: Record<string, string>;
  boxCount: number;
  initialNamedCount: number;
}) {
  const router = useRouter();
  const [labels, setLabels] = useState<Record<string, string>>(initialLabels);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the server has. State rather than a ref, because the unsaved count is rendered from it. */
  const [saved, setSaved] = useState(initialLabels);

  /*
   * Stable for the life of the component. The surface reports through an effect that depends on
   * this function, so a fresh identity every render would update this component, re-render, and
   * fire the effect again — forever.
   */
  const handleChange = useCallback((next: Record<string, string>) => setLabels(next), []);

  const unsaved = useMemo(
    () =>
      Object.entries(labels).filter(([k, v]) => (v ?? "").trim() !== "" && (saved[k] ?? "") !== v)
        .length,
    [labels, saved]
  );

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/setup-sheet-models/${modelId}/box-labels`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        changed?: number;
        pooled?: Array<{ key: string }>;
        namedCount?: number;
        boxCount?: number;
      };
      if (!res.ok) throw new Error(data.error?.trim() || `Save failed (${res.status})`);
      setSaved({ ...labels });
      const pooled = data.pooled?.length ?? 0;
      setResult(
        `${data.changed ?? 0} named${pooled > 0 ? `, ${pooled} now pooling across cars` : ""}. ` +
          `${data.namedCount ?? 0} of ${data.boxCount ?? boxCount} boxes done.`
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save those names.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="px-1 text-[11.5px] leading-snug text-muted-foreground">
        Tap a box to name it. A name the app knows — &ldquo;Camber (Front)&rdquo;, &ldquo;Droop
        (Rear)&rdquo; — also pools that box with the same knob on every other car. Anything else is
        still a good name; it just stays this car&rsquo;s own.
      </div>

      <SheetFillSurface
        mode="name"
        planUrl={`/api/setup-sheet-models/${modelId}/sheet-plan`}
        pageImageUrl={`/api/setup-sheet-models/${modelId}/sheet-page`}
        initialValues={initialLabels}
        onChange={handleChange}
      />

      <div className="flex flex-wrap items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || unsaved === 0}
          className={cn(
            buttonLinkClassName("primary"),
            (saving || unsaved === 0) && "pointer-events-none opacity-60"
          )}
        >
          {saving ? "Saving…" : unsaved === 0 ? "Nothing to save" : `Save ${unsaved} name${unsaved === 1 ? "" : "s"}`}
        </button>
        <span className="text-[11px] text-muted-foreground">
          {initialNamedCount} of {boxCount} named on {chassisName}
        </span>
      </div>

      {result ? <p className="px-1 text-[11px] text-muted-foreground">{result}</p> : null}
      {error ? <p className="px-1 text-[11px] text-amber-700 dark:text-amber-400">{error}</p> : null}
    </div>
  );
}
