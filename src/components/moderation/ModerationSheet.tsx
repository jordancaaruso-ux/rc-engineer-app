"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DotsThree } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  SHEET_CARD_CLASS,
  SHEET_PILL_DANGER,
  SHEET_PILL_OUTLINE,
  SHEET_SCRIM_CLASS,
} from "@/components/ui/ExitPromptSheet";
import {
  REPORT_REASON_LABEL,
  reasonsForKind,
  type ReportKind,
  type ReportReason,
} from "@/lib/moderation/reportRules";

/**
 * Report and Block, as a bottom sheet behind a "•••" (App Store guideline 1.2, 2026-09-26).
 * Nothing new shows on a screen until the "•••" is tapped (founder: "nothing, your call").
 *
 * One sheet for every place: a teammate's comment offers both, a teammate's row in Team settings
 * offers both, and a shared track, tire or chassis opens straight on the reasons. Same shell and
 * buttons as the app's other yes/no sheets (`ExitPromptSheet`), portalled for the same reason.
 */

export type ReportTarget = {
  kind: ReportKind;
  targetId: string;
  teamId?: string | null;
  /** The button in the first step, e.g. "Report comment". */
  label: string;
};

export type BlockTarget = {
  userId: string;
  name: string;
  /** Blocked by the viewer already: the sheet offers Unblock instead. */
  blocked: boolean;
};

type Step = "menu" | "reasons" | "confirmBlock" | "reported";

/** The "•••" that opens the sheet. Quiet, the size of the row's other small actions. */
export function MoreButton({
  onClick,
  label = "More",
  className,
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "tap-active inline-flex h-6 min-w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
    >
      <DotsThree size={18} weight="bold" aria-hidden />
    </button>
  );
}

export function ModerationSheet({
  open,
  onClose,
  title,
  report,
  block,
  startOnReasons = false,
  onReported,
  onBlockChange,
}: {
  open: boolean;
  onClose: () => void;
  /** What the sheet is about: "Sam's comment", "Sam", "this track". */
  title: string;
  report?: ReportTarget;
  block?: BlockTarget;
  /** Skip the first step when Report is the only thing on offer. */
  startOnReasons?: boolean;
  onReported?: () => void;
  onBlockChange?: (blocked: boolean) => void;
}): ReactNode {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>(startOnReasons ? "reasons" : "menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  // Every opening starts fresh.
  useEffect(() => {
    if (open) {
      setStep(startOnReasons ? "reasons" : "menu");
      setError(null);
      setBusy(false);
    }
  }, [open, startOnReasons]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!mounted || !open) return null;

  async function sendReport(reason: ReportReason) {
    if (!report || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: report.kind,
          targetId: report.targetId,
          teamId: report.teamId ?? null,
          reason,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "That report didn't go through. Try again.");
      setStep("reported");
      onReported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That report didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function setBlocked(next: boolean) {
    if (!block || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = next
        ? await fetch("/api/blocks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: block.userId }),
          })
        : await fetch(`/api/blocks?userId=${encodeURIComponent(block.userId)}`, {
            method: "DELETE",
          });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "That didn't go through. Try again.");
      onBlockChange?.(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
      setBusy(false);
    }
  }

  const heading =
    step === "reasons"
      ? startOnReasons
        ? title
        : "Why report it?"
      : step === "confirmBlock"
        ? `Block ${block?.name ?? "this driver"}?`
        : step === "reported"
          ? "Reported"
          : title;

  const detail =
    step === "confirmBlock"
      ? "You won't see each other's runs or comments, and they can't invite you."
      : step === "reported"
        ? "We'll look at it within 24 hours."
        : null;

  const disabled = busy ? "pointer-events-none opacity-60" : "";

  return createPortal(
    <>
      <div className={SHEET_SCRIM_CLASS} onClick={() => !busy && onClose()} aria-hidden />
      <div className={SHEET_CARD_CLASS} role="dialog" aria-modal="true" aria-label={heading}>
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" aria-hidden />
        <div className="pb-1 text-center font-sans text-[14px] font-bold tracking-tight text-foreground">
          {heading}
        </div>
        {detail ? (
          <div className="pb-3 text-center font-sans text-[11px] text-muted-foreground">{detail}</div>
        ) : (
          <div className="pb-2" />
        )}
        {error ? (
          <div role="alert" className="pb-3 text-center font-sans text-[11px] text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid gap-2">
          {step === "menu" ? (
            <>
              {report ? (
                <button
                  type="button"
                  className={cn(SHEET_PILL_OUTLINE, disabled)}
                  onClick={() => {
                    setError(null);
                    setStep("reasons");
                  }}
                >
                  {report.label}
                </button>
              ) : null}
              {block ? (
                block.blocked ? (
                  <button
                    type="button"
                    className={cn(SHEET_PILL_OUTLINE, disabled)}
                    onClick={() => void setBlocked(false)}
                  >
                    {busy ? "Unblocking…" : `Unblock ${block.name}`}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={cn(SHEET_PILL_DANGER, disabled)}
                    onClick={() => {
                      setError(null);
                      setStep("confirmBlock");
                    }}
                  >
                    {`Block ${block.name}`}
                  </button>
                )
              ) : null}
            </>
          ) : null}

          {step === "reasons" && report
            ? reasonsForKind(report.kind).map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className={cn(SHEET_PILL_OUTLINE, disabled)}
                  onClick={() => void sendReport(reason)}
                >
                  {REPORT_REASON_LABEL[reason]}
                </button>
              ))
            : null}

          {step === "confirmBlock" && block ? (
            <button
              type="button"
              className={cn(SHEET_PILL_DANGER, disabled)}
              onClick={() => void setBlocked(true)}
            >
              {busy ? "Blocking…" : "Block"}
            </button>
          ) : null}

          <button
            type="button"
            className={SHEET_PILL_OUTLINE}
            onClick={() => !busy && onClose()}
          >
            {step === "reported" ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}

/**
 * "•••" → Report, for a shared catalog entry (a track, a tire, a chassis): the sheet opens on the
 * reasons, since there is no one to block.
 */
export function ReportEntryButton({
  kind,
  targetId,
  noun,
  className,
}: {
  kind: Extract<ReportKind, "track" | "tire" | "chassis">;
  targetId: string;
  /** "track", "tire", "chassis" — the sheet reads "Report this track". */
  noun: string;
  className?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <MoreButton label={`More for this ${noun}`} onClick={() => setOpen(true)} className={className} />
      <ModerationSheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Report this ${noun}`}
        startOnReasons
        report={{ kind, targetId, label: `Report this ${noun}` }}
      />
    </>
  );
}
