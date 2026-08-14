"use client";

import { useRouter } from "next/navigation";
import { Plus, RotateCcw } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import type { WizardStepId } from "@/lib/runs/wizardWalk";

/**
 * Wizard Session-step prefill card (v6, founder interview 2026-07-17,
 * artifact round 3: https://claude.ai/code/artifact/a27a8375-f3a1-4ec1-b4e1-7832b36cfed1).
 *
 * Prefill is a TAP, never automatic — the wizard lands blank and this card is
 * the OFFER: it lists exactly what one tap fills (Session · Track · Tires ·
 * Prep · Setup, with values from the car's last run) above a yellow "Prefill
 * this run" button. After the tap the same five rows gain ✓s (the card never
 * changes shape); Tires/Prep/Setup rows jump to their step for auditing, and
 * "＋ Start blank instead" undoes with a single tap (remounts the form).
 *
 * No staleness cutoff: an old run is still offered, honestly dated in the
 * header's mono slot. No hero/dashboard-CTA DNA here — that styling is
 * reserved for real actions (the founder retired it from this tab).
 */

export type WizardPrefillRow = {
  key: string;
  label: string;
  value: string;
  /** Applied state: tap the row to audit that step (Tires/Prep/Setup only). */
  jump?: WizardStepId;
};

export function WizardPrefillCard({
  applied,
  loading = false,
  kindLabel,
  whenIso,
  rows,
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
  /** GPS said we're somewhere else — the carried venue stayed put (note copy). */
  note?: string | null;
  /** Mid-context car change — what moved with the car (setup / tires+prep). */
  subNote?: string | null;
  onPrefill: () => void;
  onStartBlank?: () => void;
  onJump?: (step: WizardStepId) => void;
}) {
  return (
    <SurfaceCard variant="panel" overflowHidden={false} contentClassName="space-y-0">
      <div className="flex items-baseline justify-between gap-3 pb-1">
        <span className="text-[14px] font-bold tracking-tight text-foreground">
          {applied ? "Prefilled from your last run" : "Prefill from your last run"}
        </span>
        <span className="shrink-0 micro-caps text-faint">
          {kindLabel} · {relativeWhen(whenIso)}
        </span>
      </div>
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
      {note ? <PrefillNote text={note} /> : null}
      {subNote ? <PrefillNote text={subNote} /> : null}
      {applied ? (
        onStartBlank ? (
          <button
            type="button"
            onClick={onStartBlank}
            className="tap-active mt-1 flex w-full items-center justify-center gap-1.5 border-t border-border/60 pb-0.5 pt-2.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <Plus aria-hidden className="size-[13px]" strokeWidth={2.2} />
            Start blank instead
          </button>
        ) : null
      ) : (
        <button
          type="button"
          onClick={onPrefill}
          disabled={loading}
          className={cn(
            "tap-active mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-bold text-primary-foreground",
            loading && "opacity-60"
          )}
        >
          <RotateCcw aria-hidden className="size-[14px]" strokeWidth={2.4} />
          Prefill this run
        </button>
      )}
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
            {[d.trackName, d.eventName, relativeWhen(d.createdAt)].filter(Boolean).join(" · ")}
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
