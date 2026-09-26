"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, RotateCcw } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import { meetingNameLessTrack } from "@/lib/events/meetingNameLessTrack";
import type { WizardStepId } from "@/lib/runs/wizardWalk";

/**
 * Wizard Session-step prefill card (v7, founder pick "A" 2026-09-26, off the bench at
 * https://claude.ai/artifact/7y7xFN1D36TbKFQ21VYtoF; v6 was the always-open five-row card with a
 * full-width yellow button, which took a third of the phone before the Car box).
 *
 * Prefill is a TAP, never automatic — the wizard lands blank and this card is the OFFER, closed by
 * default to one line: "Last run" + when, then where / which session / which tyres / how much
 * setup, with a small yellow "Prefill" pill on the right. Tapping the line opens the five rows
 * (Session · Track · Tires · Prep · Setup) that one tap fills. After the tap it reads "✓ Prefilled"
 * and the pill becomes a grey "Undo", which remounts the form blank; opened, the same five rows
 * gain ✓s and Tires/Prep/Setup jump to their step for auditing.
 *
 * No staleness cutoff: an old run is still offered, honestly dated in the mono slot. The notes
 * (venue swap, car swap, setup from an unfinished run) stay outside the fold: they change what the
 * tap means, so they can't hide behind it.
 */

export type WizardPrefillRow = {
  key: string;
  label: string;
  value: string;
  /** Applied state: tap the row to audit that step (Tires/Prep/Setup only). */
  jump?: WizardStepId;
  /** The closed card's line uses this instead of `value` (the Tires row minus its prep). */
  short?: string;
};

/** Values that say "nothing here", which the closed line leaves out rather than print. */
const EMPTY_PREFILL_VALUES = new Set(["", "—", "…", "none", "none saved", "not attached", "track needed"]);

/**
 * The closed card's one line: track · session · tyres · setup size, e.g.
 * "Bayside · Main · Vaulk 36SK run 5 · 97 setup values". Built from the same rows the open card
 * lists, so the line and the rows can never disagree.
 */
function prefillSummaryLine(rows: WizardPrefillRow[], loading: boolean): string {
  const pick = (key: string) => {
    const row = rows.find((r) => r.key === key);
    return (row?.short ?? row?.value ?? "").trim();
  };
  const setupCount = /^(\d+) values?\b/.exec(pick("setup"))?.[1];
  const parts = [
    pick("track"),
    pick("session").replace(/^Event · /, ""),
    pick("tires").replace(/ · run /g, " run "),
    setupCount ? `${setupCount} setup value${setupCount === "1" ? "" : "s"}` : "",
  ].filter((p) => !EMPTY_PREFILL_VALUES.has(p));
  if (parts.length > 0) return parts.join(" · ");
  return loading ? "…" : "Nothing saved on it yet";
}

export function WizardPrefillCard({
  applied,
  loading = false,
  kindLabel,
  whenIso,
  rows,
  setupNote,
  note,
  subNote,
  onPrefill,
  onStartBlank,
  onJump,
}: {
  applied: boolean;
  /** Per-car last-run fetch still resolving — button disabled, values may be "…". */
  loading?: boolean;
  /** Short source-run label for the header's mono slot ("Race", "Main", "Testing"). */
  kindLabel: string;
  whenIso: string;
  rows: WizardPrefillRow[];
  /**
   * The setup on offer came off a run the driver never finished, while the rest of the card
   * describes the last COMPLETED run. Said out loud because "from your last run" would
   * otherwise cover two different runs at once (see `lib/runs/prefillSetupSource`).
   */
  setupNote?: string | null;
  /** GPS said we're somewhere else — the carried venue stayed put (note copy). */
  note?: string | null;
  /** Mid-context car change — what moved with the car (setup / tires+prep). */
  subNote?: string | null;
  onPrefill: () => void;
  onStartBlank?: () => void;
  onJump?: (step: WizardStepId) => void;
}) {
  const [open, setOpen] = useState(false);
  const foldId = useId();
  return (
    <SurfaceCard variant="panel" overflowHidden={false} contentClassName="space-y-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={foldId}
          className="tap-active grid min-w-0 flex-1 gap-1.5 text-left"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            {applied ? (
              <span aria-hidden className="text-[13px] font-bold text-gain">
                ✓
              </span>
            ) : null}
            <span className="whitespace-nowrap text-[13.5px] font-bold tracking-tight text-foreground">
              {applied ? "Prefilled" : "Last run"}
            </span>
            <span className="min-w-0 truncate micro-caps text-faint">
              {kindLabel} · {relativeWhen(whenIso)}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
            <span className="min-w-0 truncate">{prefillSummaryLine(rows, loading)}</span>
            <ChevronDown
              aria-hidden
              className={cn("size-[14px] shrink-0 transition-transform duration-200", open && "rotate-180")}
              strokeWidth={2.2}
            />
          </span>
        </button>
        {applied ? (
          onStartBlank ? (
            <button
              type="button"
              onClick={onStartBlank}
              className="tap-active h-[34px] shrink-0 rounded-full border border-border bg-secondary px-3.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Undo
            </button>
          ) : null
        ) : (
          <button
            type="button"
            onClick={onPrefill}
            disabled={loading}
            aria-label="Prefill this run"
            className={cn(
              "tap-active flex h-[34px] shrink-0 items-center gap-1.5 rounded-full primary-face bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground",
              loading && "opacity-60"
            )}
          >
            <RotateCcw aria-hidden className="size-[14px]" strokeWidth={2.4} />
            Prefill
          </button>
        )}
      </div>
      {setupNote ? <PrefillNote text={setupNote} /> : null}
      {note ? <PrefillNote text={note} /> : null}
      {subNote ? <PrefillNote text={subNote} /> : null}
      <div id={foldId} hidden={!open} className="mt-2.5 border-t border-border/60 pt-0.5">
      {rows.map((r) => {
        const rowInner = (
          <>
            {applied ? (
              <span aria-hidden className="w-3 shrink-0 text-[12px] text-gain">
                ✓
              </span>
            ) : null}
            <span className="w-14 shrink-0 text-[12.5px] text-muted-foreground">{r.label}</span>
            <span className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-foreground">
              {r.value}
            </span>
            {applied && r.jump && onJump ? (
        <span className="shrink-0 micro-caps text-faint">
                {r.label} →
              </span>
            ) : null}
          </>
        );
        const rowClass = "flex w-full items-center gap-2.5 border-t border-border/60 py-2 first:border-t-0";
        return applied && r.jump && onJump ? (
          <button
            key={r.key}
            type="button"
            onClick={() => onJump(r.jump as WizardStepId)}
            className={cn(rowClass, "tap-active text-left hover:bg-muted/60")}
          >
            {rowInner}
          </button>
        ) : (
          <div key={r.key} className={rowClass}>
            {rowInner}
          </div>
        );
      })}
      </div>
    </SurfaceCard>
  );
}

/** Exceptional info line (venue swap / car swap) — carries info, not confirmation. */
function PrefillNote({ text }: { text: string }) {
  return (
    <p className="pb-1 pt-1.5 text-[11px] font-semibold leading-snug text-muted-foreground">
      <span aria-hidden className="text-primary-ink">
        ↳
      </span>{" "}
      {text}
    </p>
  );
}

export type WizardDraftRow = {
  id: string;
  carName: string;
  trackName: string | null;
  eventName: string | null;
  sessionLabel: string;
  createdAt: string;
};

/** Open drafts — finish before starting another. Renders topmost on the
 *  Session step (a detour, not a selection). */
export function WizardDraftsCard({ drafts }: { drafts: WizardDraftRow[] }) {
  const router = useRouter();
  if (drafts.length === 0) return null;
  return (
    <CardPanel contentClassName="space-y-2" className="border-amber-500/40">
      <Eyebrow>Finish today&apos;s runs</Eyebrow>
      {drafts.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => router.push(`/runs/${encodeURIComponent(d.id)}/edit`)}
          className="flex w-full flex-col items-start rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-left hover:border-amber-500/60"
        >
          <span className="text-sm font-semibold text-foreground">
            {d.sessionLabel || "Run"} — {d.carName}
          </span>
          <span className="tabular-nums text-[10px] text-muted-foreground">
            {[d.trackName, meetingNameLessTrack(d.eventName, d.trackName), relativeWhen(d.createdAt)]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="mt-1 text-[11px] text-warning">
            finish logging — laps &amp; rating
          </span>
        </button>
      ))}
    </CardPanel>
  );
}

export function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  const wks = Math.round(days / 7);
  if (days < 60) return `${wks} wks ago`;
  return new Date(iso).toLocaleDateString();
}
