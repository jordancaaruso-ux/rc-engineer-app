"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import type { EntryCandidate } from "@/lib/runs/entryCandidate";

/**
 * Wizard Session-step start controls (v4, founder interview 2026-07-17
 * evening). The Continue/New-log choice is no longer a gate — the wizard lands
 * pre-continued when the last run is recent, so this block is a STATUS plus a
 * switch, not navigation:
 *
 * - Hero status card (dashboard-CTA DNA — micro-label deck, −21° notch, 20px
 *   Sora headline; founder-owned numbers, don't nudge): "Continued from
 *   Main · …" or "New log". Inert — tapping it does nothing (founder pick).
 * - Quiet row: the other mode. Switching remounts the form, so it two-tap
 *   confirms before discarding what's entered.
 * - Open drafts ride above (finish before starting another).
 */

export type WizardDraftRow = {
  id: string;
  carName: string;
  trackName: string | null;
  eventName: string | null;
  sessionLabel: string;
  createdAt: string;
};

/** Open drafts — finish before starting another. Renders ABOVE the car card
 *  (a detour, not a selection), split out so Car can be the first selection. */
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
          <span className="font-mono text-[10px] text-muted-foreground">
            {[d.trackName, d.eventName, relativeWhen(d.createdAt)].filter(Boolean).join(" · ")}
          </span>
          <span className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
            finish logging — laps &amp; rating
          </span>
        </button>
      ))}
    </CardPanel>
  );
}

export function WizardStartControls({
  continuing,
  candidate,
  venueSwapNote,
  carSwapNote = null,
  onSwitch,
}: {
  continuing: boolean;
  candidate: EntryCandidate | null;
  /** GPS said we're somewhere else — the carried venue was swapped (note copy). */
  venueSwapNote: string | null;
  /** Mid-context car change — what moved with the car (setup / tires+prep). */
  carSwapNote?: string | null;
  onSwitch?: (mode: "continued" | "fresh") => void;
}) {
  return (
    <div className="space-y-2">
      {/* No prior run → nothing to continue, nothing to switch: no chrome. */}
      {candidate ? (
        continuing ? (
          <>
            {/* Headline IS the copy fact (founder 2026-07-17 late — "Continued
                from Race" read as meaningless; the always-on ✓ line retired;
                subject word "Everything" + tail dropped since the micro-label
                names the source run). Sub-lines appear only when something
                notable happened. */}
            <StartStatusCard
              micro={candidateMicro(candidate)}
              headline="Everything carried over"
              note={venueSwapNote}
              subNote={carSwapNote}
            />
            {onSwitch ? (
              <SwitchRow
                icon="fresh"
                label="New log — start this run blank"
                confirmLabel="Tap again — clears what carried over"
                onConfirm={() => onSwitch("fresh")}
              />
            ) : null}
          </>
        ) : (
          <>
            <StartStatusCard
              micro={`Last run ${relativeWhen(candidate.whenIso)}`}
              headline="New log"
              note={null}
            />
            {onSwitch ? (
              <SwitchRow
                icon="continue"
                label={`Carry over last run · ${relativeWhen(candidate.whenIso)}`}
                confirmLabel="Tap again — replaces what you've entered"
                onConfirm={() => onSwitch("continued")}
              />
            ) : null}
          </>
        )
      ) : null}
    </div>
  );
}

/**
 * Status card — the dashboard CTA's design DNA on dark glass: micro-label deck
 * over a 20px Sora 700 headline, −21° sector notch baseline-aligned at Sora's
 * measured cap height (0.76em — same numbers as DashboardStartRunCta,
 * founder-owned). Inert by design: the run state, not a button.
 */
function StartStatusCard({
  micro,
  headline,
  note,
  subNote = null,
}: {
  micro: string;
  headline: string;
  /** Exceptional info line (e.g. the GPS venue swap) — null in the normal case. */
  note: string | null;
  /** Second exceptional line (e.g. what a mid-context car swap moved). */
  subNote?: string | null;
}) {
  return (
    <div className="w-full rounded-xl border border-primary/40 bg-secondary px-4 pb-3.5 pt-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      {/* Micro label — indented by notch width + gap (6.5 + 8) so it sits on
          the headline text's left edge, mirroring the dashboard bar. */}
      <span className="ml-[14.5px] block text-[10.5px] font-bold uppercase tracking-[0.09em] tabular-nums text-muted-foreground">
        {micro}
      </span>
      <span className="mt-[3px] block text-[20px] font-bold leading-[1.2] tracking-[-0.02em] text-foreground">
        {/* Sector notch — baseline-aligned; 0.76em = Sora 700 cap height. */}
        <span
          aria-hidden
          className="mr-2 inline-block h-[0.76em] w-[6.5px] -skew-x-[21deg] rounded-[1px] bg-primary align-baseline"
        />
        {headline}
      </span>
      {note ? (
        <span
          className="rc-fade ml-[14.5px] mt-1.5 block text-[11px] font-semibold leading-snug text-muted-foreground"
          style={{ "--rc-delay": "40ms" } as CSSProperties}
        >
          <span aria-hidden className="text-primary">
            ↳
          </span>{" "}
          {note}
        </span>
      ) : null}
      {subNote ? (
        <span
          className="rc-fade ml-[14.5px] mt-1 block text-[11px] font-semibold leading-snug text-muted-foreground"
          style={{ "--rc-delay": "40ms" } as CSSProperties}
        >
          <span aria-hidden className="text-primary">
            ↳
          </span>{" "}
          {subNote}
        </span>
      ) : null}
    </div>
  );
}

/** Quiet mode-switch row with a two-tap confirm (switching remounts the form). */
function SwitchRow({
  icon,
  label,
  confirmLabel,
  onConfirm,
}: {
  icon: "fresh" | "continue";
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    []
  );
  const Icon = icon === "fresh" ? Plus : RotateCcw;
  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          onConfirm();
          return;
        }
        setArmed(true);
        timerRef.current = window.setTimeout(() => setArmed(false), 4000);
      }}
      className={cn(
        "tap-active flex w-full items-center justify-center gap-2 rounded-xl border bg-transparent px-4 py-3 text-[13.5px] font-semibold transition-colors duration-200",
        armed
          ? "border-amber-500/60 text-amber-600 dark:text-amber-300"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      )}
    >
      <Icon aria-hidden className="size-[15px] shrink-0" strokeWidth={2.2} />
      <span className="truncate">{armed ? confirmLabel : label}</span>
    </button>
  );
}

/** Short label for the run being continued (session label, else session kind). */
function candidateLabel(c: EntryCandidate): string {
  if (c.sessionLabel) return c.sessionLabel;
  const t = c.meetingSessionType;
  if (!t || t === "TESTING") return "Testing";
  return t.charAt(0) + t.slice(1).toLowerCase();
}

function candidateMicro(c: EntryCandidate): string {
  return [candidateLabel(c), c.trackName, relativeWhen(c.whenIso)].filter(Boolean).join(" · ");
}

function relativeWhen(iso: string): string {
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
  return new Date(iso).toLocaleDateString();
}
