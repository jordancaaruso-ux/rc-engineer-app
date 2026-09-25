"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useEnterExit } from "@/components/ui/Collapse";
import { useVisualViewportBox } from "@/components/ui/PickerSheet";
import { SheetFillSurface } from "@/components/setup/SheetFillSurface";
import { storedValuesToSurface } from "@/lib/setupSheetModels/sheetSurfaceValues";
import { namedChangesMessage, type SheetChangeRow } from "@/lib/engineer/sheetChanges";
import type { SheetLinkTarget } from "@/lib/engineer/sheetLinks";

/**
 * What a setup-change link in an Engineer answer opens (founder design, 2026-09-24): the driver's
 * whole sheet with the boxes that moved ringed and numbered, a Before/After switch, and one "What is
 * it?" box per change. "Tell the Engineer" sends the names as the driver's next message and saves
 * them to the car, so the next time those boxes move they are already filled in.
 *
 * The switch flips the values on ONE sheet rather than showing two (his pick over side-by-side
 * crops): the page, zoom and rings stay still, and only the values in the rings change. The ring
 * turns grey on Before so the side on show is never in doubt.
 *
 * A box the Engineer already reads (the pinion on an Xray) is ringed and listed by the app's own
 * name, with no box to type in: the Engineer knows it, and asking the driver would be a question it
 * already has the answer to.
 */

type SideData = { runId: string; clock: string | null; day: string; values: Record<string, unknown> };

type SheetChangesData = {
  sheetMode: boolean;
  setupSheetModelId: string | null;
  editionBlankId: string | null;
  carId: string;
  sameDay: boolean;
  after: SideData;
  before: SideData;
  changes: SheetChangeRow[];
};

type LoadState = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; data: SheetChangesData };

function sideLabel(side: SideData, sameDay: boolean): string {
  if (!side.clock) return side.day;
  return sameDay ? side.clock : `${side.day} ${side.clock}`;
}

export function EngineerSheetChanges({
  target,
  onClose,
  onTell,
  disabled = false,
}: {
  /** The two runs to open; null = shut. */
  target: SheetLinkTarget | null;
  onClose: () => void;
  /** Sends the driver's names as their next message. */
  onTell: (message: string) => void;
  /** The chat is busy — the names can still be typed, but not sent yet. */
  disabled?: boolean;
}) {
  const open = target != null;
  const sheet = useEnterExit(open, 300);
  const viewportBox = useVisualViewportBox(sheet.mounted);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [side, setSide] = useState<"before" | "after">("after");
  const [names, setNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const runId = target?.runId ?? null;
  const sinceRunId = target?.sinceRunId ?? null;

  useEffect(() => {
    if (!runId || !sinceRunId) return;
    let cancelled = false;
    setState({ kind: "loading" });
    setSide("after");
    fetch(`/api/runs/${encodeURIComponent(runId)}/sheet-changes?since=${encodeURIComponent(sinceRunId)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? (r.json() as Promise<SheetChangesData>) : null))
      .then((data) => {
        if (cancelled) return;
        if (!data || !Array.isArray(data.changes)) {
          setState({ kind: "failed" });
          return;
        }
        // Each box starts with the name this driver gave it on this car before, if any.
        setNames(Object.fromEntries(data.changes.filter((c) => c.savedName).map((c) => [c.key, c.savedName!])));
        setState({ kind: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [runId, sinceRunId]);

  // Escape closes; the page underneath stays put while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const data = state.kind === "ready" ? state.data : null;
  const surfaceAfter = useMemo(() => (data ? storedValuesToSurface(data.after.values) : {}), [data]);
  const surfaceBefore = useMemo(() => (data ? storedValuesToSurface(data.before.values) : {}), [data]);
  const rings = useMemo(
    () =>
      (data?.changes ?? [])
        .filter((c): c is SheetChangeRow & { number: number } => c.number != null)
        .map((c) => ({ key: c.key, number: c.number })),
    [data]
  );
  const firstPage = data?.changes.find((c) => c.pageNumber != null)?.pageNumber ?? 1;

  if (!sheet.mounted || typeof document === "undefined") return null;

  const changes = data?.changes ?? [];
  const n = changes.length;
  const afterWhen = data ? (data.after.clock ? `your ${data.after.clock} run` : "this run") : "";
  const title = data
    ? `${n} change${n === 1 ? "" : "s"} before ${afterWhen}${data.sameDay ? "" : ` on ${data.after.day}`}`
    : "Setup changes";
  const message = data
    ? namedChangesMessage({
        clock: data.after.clock,
        dayLabel: data.sameDay ? null : data.after.day,
        changes: changes.map((c) => ({ name: c.known ?? names[c.key] ?? "", before: c.before, after: c.after })),
      })
    : null;
  // Only a name the driver typed tells the Engineer something new; the boxes it reads it knows.
  const namedUnknown = changes.some((c) => !c.known && (names[c.key] ?? "").trim());
  const canTell = Boolean(message) && namedUnknown && !disabled && !saving;

  const tell = async () => {
    if (!data || !message || !canTell) return;
    setSaving(true);
    // Saved to THIS car only (founder, 2026-09-25: "their car at once"). A save that fails still
    // sends the message — the names are a convenience for next time, the answer is the point.
    const typed = Object.fromEntries(
      changes.filter((c) => !c.known && (names[c.key] ?? "").trim() !== (c.savedName ?? "")).map((c) => [c.key, names[c.key] ?? ""])
    );
    if (Object.keys(typed).length > 0) {
      await fetch(`/api/cars/${encodeURIComponent(data.carId)}/sheet-box-names`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: typed }),
      }).catch(() => null);
    }
    setSaving(false);
    onTell(message);
    onClose();
  };

  // Portaled to <body>: the chat sits inside cards, and a transformed ancestor would turn `fixed`
  // into `absolute` and strand the sheet mid-page (same construction as PickerSheet).
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[70] flex items-end justify-center bg-black/50 transition-opacity duration-300 ease-out motion-reduce:transition-none sm:items-center",
        sheet.entered ? "opacity-100" : "opacity-0"
      )}
      style={viewportBox ? { top: viewportBox.top, height: viewportBox.height, bottom: "auto" } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      data-testid="engineer-sheet-changes"
    >
      <div
        className={cn(
          "flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-card pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-out motion-reduce:transition-none sm:rounded-2xl sm:pb-2",
          "max-h-[min(94dvh,60rem)]",
          sheet.entered ? "translate-y-0" : "translate-y-full sm:translate-y-4"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-2.5 sm:hidden">
          <div className="mx-auto h-1 w-9 rounded-full bg-border" aria-hidden />
        </div>
        <div className="flex items-start justify-between gap-2 px-4 pb-1 pt-2">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold leading-snug tracking-tight text-foreground">{title}</h2>
            {data && data.sheetMode && rings.length > 0 ? (
              <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                The ringed boxes changed. Switch to see them before and after.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-active -mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 pt-1">
          {state.kind === "loading" ? (
            <div className="grid h-64 place-items-center text-sm text-muted-foreground">Opening your sheet…</div>
          ) : state.kind === "failed" || !data ? (
            <p className="py-6 text-sm text-muted-foreground">That sheet couldn&rsquo;t be opened. Try again in a moment.</p>
          ) : (
            <div className="space-y-3">
              {data.sheetMode && data.setupSheetModelId ? (
                <>
                  <SegmentedControl
                    size="sm"
                    ariaLabel="Which setup is on the sheet"
                    value={side}
                    onChange={setSide}
                    options={[
                      { value: "before", label: `Before · ${sideLabel(data.before, data.sameDay)}` },
                      { value: "after", label: `After · ${sideLabel(data.after, data.sameDay)}` },
                    ]}
                  />
                  <SheetFillSurface
                    planUrl={`/api/setup-sheet-models/${data.setupSheetModelId}/sheet-plan${data.editionBlankId ? `?blank=${encodeURIComponent(data.editionBlankId)}` : ""}`}
                    pageImageUrl={`/api/setup-sheet-models/${data.setupSheetModelId}/sheet-page${data.editionBlankId ? `?blank=${encodeURIComponent(data.editionBlankId)}` : ""}`}
                    initialValues={surfaceAfter}
                    alternateValues={surfaceBefore}
                    showAlternate={side === "before"}
                    rings={rings}
                    ringsMuted={side === "before"}
                    initialPage={firstPage}
                    readOnly
                  />
                </>
              ) : null}

              <div>
                <p className="text-[15px] font-bold text-foreground">What did you change?</p>
                <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                  Say what each ringed box is, and the Engineer can tell you what the change did.
                </p>
              </div>

              <ol className="space-y-2.5">
                {changes.map((c) => {
                  const id = `sheet-change-${c.key}`;
                  const change = `${c.before ?? "—"} → ${c.after ?? "—"}`;
                  return (
                    <li key={c.key} className="space-y-1">
                      <label htmlFor={c.known ? undefined : id} className="flex items-center gap-2 text-[13px] text-muted-foreground">
                        <span
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                            c.number != null ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                          )}
                          aria-hidden
                        >
                          {c.number ?? "·"}
                        </span>
                        <span className="tabular-nums text-foreground">{change}</span>
                        {c.known ? <span className="min-w-0 truncate">· {c.known}</span> : null}
                      </label>
                      {c.known ? null : (
                        <input
                          id={id}
                          type="text"
                          value={names[c.key] ?? ""}
                          onChange={(e) => setNames((prev) => ({ ...prev, [c.key]: e.target.value }))}
                          placeholder="What is it? e.g. front roll bar"
                          autoComplete="off"
                          enterKeyHint="done"
                          maxLength={60}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[15px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                        />
                      )}
                    </li>
                  );
                })}
              </ol>

              <div className="flex items-center justify-between gap-3 pt-1">
                <Button type="button" variant="primary" onClick={() => void tell()} disabled={!canTell} className="min-h-11 px-5">
                  {saving ? "Sending…" : "Tell the Engineer"}
                </Button>
                <button
                  type="button"
                  onClick={onClose}
                  className="tap-active min-h-11 px-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
