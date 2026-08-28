"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, ExternalLink, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { Spinner } from "@/components/ui/Spinner";
import type { LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { MYRCM_HOME_URL } from "@/lib/lapUrlParsers/myRcmPdfSource";

/**
 * The way MyRCM results get into a run since the page reader was switched off (2026-08-26).
 *
 * The app can never fetch `myrcm.ch`. The driver taps MyRCM's own "Download PDF" on the run they
 * drove and hands the file over here; the server reads every driver's laps out of it and refuses
 * anything whose numbers don't add up. This card is the whole driver-facing side of that: the
 * door, the instructions for the trip to MyRCM, the reading state, the refusal, and the note
 * after landing. Attaching the laps to the run is the ingest panel's job — see `onImported`.
 *
 * Sits below the URL tabs rather than being a fifth tab: LiveRC and Speedhive drivers never
 * need it, so it stays a quiet row until MyRCM is in play — a MyRCM link pasted into the URL
 * box, or a result already imported this way.
 */

/** `POST /api/lap-time-sessions/import-pdf`, success body. */
export type MyRcmPdfImportResponse = {
  importedSessionId: string;
  parserId: string;
  sourceUrl: string;
  fileName: string | null;
  alreadyImported: boolean;
  recordedAt: string;
  sessionCompletedAtIso: string | null;
  sessionCompletedAtDbIso: string | null;
  session: { name: string | null; eventName: string | null; className: string | null };
  laps: number[];
  /** True when the names in Settings matched none of the rows; the driver must pick. */
  driverNotFound: boolean;
  /** Their row when the name matched, as a `sessionDrivers` id. */
  matchedDriverId: string | null;
  warnings: Array<{ kind: string; severity: string; message: string }>;
  drivers: Array<{
    id: string;
    position: number;
    carNumber: string | null;
    driverName: string;
    club: string | null;
    note: string | null;
    lapCount: number;
    bestLapSeconds: number | null;
    laps: number[];
  }>;
};

/** The response's field, in the shape every other import already hands the panel. */
export function myRcmPdfSessionDrivers(res: MyRcmPdfImportResponse): LapUrlSessionDriver[] {
  return res.drivers.map((d) => ({
    id: d.id,
    driverId: d.id,
    driverName: d.driverName,
    normalizedName: d.driverName.trim().toLowerCase().replace(/\s+/g, " "),
    laps: d.laps,
    lapCount: d.laps.length,
  }));
}

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string; bytes: number }
  | {
      kind: "refused";
      code: string;
      message: string;
      fileName: string;
      /** "Patrick MOSER: states 13 laps, none found" — the file's own disagreement, per driver. */
      issues: string[];
    }
  | {
      kind: "landed";
      importedSessionId: string;
      fileName: string;
      drivers: MyRcmPdfImportResponse["drivers"];
      sessionLabel: string | null;
      warnings: string[];
      driverNotFound: boolean;
      alreadyImported: boolean;
    };

/** Headline for a refusal — the server's message underneath says what to do next. */
function refusalHeadline(code: string): string {
  switch (code) {
    case "no_lap_matrix":
      return "This file has no lap times in it";
    case "not_a_run_result":
    case "no_classification":
      return "That's not a single run's result";
    case "did_not_reconcile":
      return "The numbers in this file don't agree";
    case "not_a_pdf":
      return "That isn't a PDF";
    case "password_protected":
      return "This PDF is locked";
    case "damaged":
      return "This file arrived incomplete";
    case "too_large":
      return "That file is too big";
    default:
      return "We couldn't read that file";
  }
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Flush yellow across the card, like the add-car upload — not the 30px toolbar chip. The
 * outline twin sits beside it at the same height so the pair reads as one decision.
 */
const WIDE_PRIMARY =
  "tap-active flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-[13px] font-semibold tracking-tight text-primary-foreground transition hover:brightness-105 active:brightness-95 disabled:opacity-60";
const WIDE_OUTLINE =
  "tap-active flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-runna px-3 py-2.5 text-[13px] font-semibold tracking-tight text-foreground transition hover:bg-surface-runna-inset disabled:opacity-60";
const TEXT_LINK =
  "text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline";

export function MyRcmPdfImportCard({
  pastedUrl,
  openUrl,
  hasImported,
  onImported,
  selectedDriverIdFor,
  onPickDriver,
  className,
}: {
  /** The MyRCM page the driver pasted into the URL box, when that is how we got here. */
  pastedUrl: string | null;
  /** The event's MyRCM page when one is saved; "Open MyRCM" lands on MyRCM's front page otherwise. */
  openUrl: string | null;
  /** A PDF result is already on this run — Choose file leads from then on. */
  hasImported: boolean;
  /** The server accepted the file; the panel attaches it to the run. */
  onImported: (res: MyRcmPdfImportResponse) => void;
  /**
   * Whose laps the attached import currently counts as the driver's — `null` until they pick.
   * Read back from the panel's block rather than remembered here, so the strip above and this
   * list can never disagree about who "you" is.
   *
   * Both this and `onPickDriver` are omitted when the file isn't landing on a run — the
   * lap-analysis library takes MyRCM PDFs of races nobody here drove, and "which of these
   * is you" is not a question that has an answer there. Without a pair the card lands and
   * says so, and leaves the driver list to the sheet that opens next.
   */
  selectedDriverIdFor?: (importedSessionId: string) => string | null;
  /** The driver tapped their own row in the list. */
  onPickDriver?: (importedSessionId: string, driverId: string) => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [howOpen, setHowOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // A pasted MyRCM link is the driver asking for this; open on it rather than making them find
  // the row underneath the message that just told them the paste went nowhere.
  //
  // A saved MyRCM page on the meeting says the same thing more quietly: somebody set this event
  // up as a MyRCM one, so the file door is the way in here and shouldn't need finding first.
  useEffect(() => {
    if (pastedUrl || openUrl?.trim()) setExpanded(true);
  }, [pastedUrl, openUrl]);

  const isOpen = expanded || phase.kind !== "idle";
  const leadsWithFile = hasImported || phase.kind === "landed";
  const target = openUrl?.trim() || MYRCM_HOME_URL;
  /**
   * The meeting carries its own MyRCM page, so this is not a maybe — it is how laps get onto this
   * run. The card takes the accent surface and the link takes the yellow, because the driver's
   * next move is the trip out to fetch the file, not the file picker they have nothing to feed yet.
   */
  const featured = target !== MYRCM_HOME_URL;

  function pickFile() {
    setHowOpen(false);
    fileRef.current?.click();
  }

  async function upload(file: File) {
    setPhase({ kind: "reading", fileName: file.name, bytes: file.size });
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/lap-time-sessions/import-pdf", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as
        | MyRcmPdfImportResponse
        | { error?: string; code?: string; issues?: Array<{ driverName?: string; detail?: string }> };
      if (!res.ok || !("importedSessionId" in data)) {
        const failure = data as {
          error?: string;
          code?: string;
          issues?: Array<{ driverName?: string; detail?: string }>;
        };
        setPhase({
          kind: "refused",
          fileName: file.name,
          issues: (failure.issues ?? [])
            .map((i) => [i.driverName, i.detail].filter(Boolean).join(": "))
            .filter(Boolean),
          code: failure.code ?? (res.status === 429 ? "rate_limited" : "unknown"),
          message:
            failure.error ??
            (res.status === 429
              ? "Too many files in a row — give it a few minutes."
              : "Something went wrong reading that file. Try once more."),
        });
        haptic("light");
        return;
      }
      const ok = data as MyRcmPdfImportResponse;
      const sessionLabel = [ok.session.name, ok.session.eventName].filter(Boolean).join(" · ") || null;
      setPhase({
        kind: "landed",
        importedSessionId: ok.importedSessionId,
        fileName: ok.fileName ?? file.name,
        drivers: ok.drivers,
        sessionLabel,
        warnings: ok.warnings.map((w) => w.message),
        driverNotFound: ok.driverNotFound,
        alreadyImported: ok.alreadyImported,
      });
      onImported(ok);
    } catch {
      setPhase({
        kind: "refused",
        fileName: file.name,
        issues: [],
        code: "network",
        message: "The upload didn't get through. Check the signal and try again.",
      });
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border",
        featured ? "border-primary-ink/35 bg-primary/[0.06]" : "border-border bg-surface-runna",
        isOpen ? "p-3" : "p-0",
        className
      )}
      data-testid="myrcm-pdf-card"
    >
      {/*
        Hidden native input behind styled buttons — the native control can't be restyled, and the
        value is cleared after every pick so choosing the same file again still fires.
      */}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (f) void upload(f);
        }}
      />

      {!isOpen ? (
        <button
          type="button"
          className="tap-active flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
          onClick={() => setExpanded(true)}
        >
          <span className="shrink-0 rounded border border-border bg-surface-runna-inset px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-foreground/80">
            MyRCM
          </span>
          <span className="min-w-0 flex-1 text-[12px] leading-snug text-muted-foreground">
            Raced on MyRCM? Import your result.
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-semibold text-foreground">
            Import
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </button>
      ) : phase.kind === "reading" ? (
        <div className="space-y-2">
          <FileChip name={phase.fileName} meta={formatFileSize(phase.bytes)} />
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <p className="text-[13px] font-semibold text-foreground">Reading the lap list…</p>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Checking every driver&apos;s laps against the totals printed in the file.
          </p>
        </div>
      ) : phase.kind === "refused" ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-destructive">
            Not saved
          </p>
          <p className="text-[13px] font-semibold leading-snug text-foreground">
            {refusalHeadline(phase.code)}
          </p>
          <p className="text-[12px] leading-snug text-muted-foreground">{phase.message}</p>
          {phase.issues.length > 0 ? (
            /*
             * The specifics. "The numbers don't agree" is the honest headline, but which
             * driver, and how, is what tells anyone whether the export was cut short or the
             * reader was wrong — and it is the line to send back when it is the latter.
             */
            <ul className="space-y-0.5 text-[11px] leading-snug text-muted-foreground">
              {phase.issues.slice(0, 5).map((line) => (
                <li key={line} className="tabular-nums">
                  {line}
                </li>
              ))}
              {phase.issues.length > 5 ? <li>…and {phase.issues.length - 5} more</li> : null}
            </ul>
          ) : null}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <OpenMyRcmLink href={target} variant="outline" />
            <button type="button" className={WIDE_PRIMARY} onClick={pickFile}>
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Choose another file
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Your run is untouched — nothing was imported.
          </p>
        </div>
      ) : phase.kind === "landed" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-foreground">
              <Check className="h-3.5 w-3.5 text-primary-ink" aria-hidden />
              {phase.alreadyImported ? "Imported again" : "Imported"}
            </span>
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {phase.fileName} · {phase.drivers.length} driver{phase.drivers.length === 1 ? "" : "s"}
            </span>
          </div>
          {phase.sessionLabel ? (
            <p className="text-[12px] leading-snug text-foreground/90">{phase.sessionLabel}</p>
          ) : null}
          {selectedDriverIdFor && onPickDriver ? (
            <DriverList
              drivers={phase.drivers}
              selectedId={selectedDriverIdFor(phase.importedSessionId)}
              driverNotFound={phase.driverNotFound}
              onPick={(id) => onPickDriver(phase.importedSessionId, id)}
            />
          ) : null}
          {selectedDriverIdFor && phase.driverNotFound && selectedDriverIdFor(phase.importedSessionId) == null ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              The run can&apos;t be saved until it knows which laps are yours. Put your name as
              timing prints it under Settings → Timing identity, and next time it&apos;s picked
              for you.
            </p>
          ) : null}
          {phase.warnings.length > 0 ? (
            <div className="rounded-md border border-border bg-surface-runna-inset px-2.5 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {phase.warnings.length === 1 ? "One thing to know" : "Things to know"}
              </p>
              <ul className="mt-1 space-y-1">
                {phase.warnings.map((w, i) => (
                  <li key={i} className="text-[11px] leading-snug text-foreground/90">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex items-center gap-3 pt-0.5">
            <button type="button" className={TEXT_LINK} onClick={pickFile}>
              Import another file
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold leading-snug text-foreground">
            {pastedUrl ? "That's a MyRCM link" : "Import a MyRCM result"}
          </p>
          {/*
            One line, and it sells rather than explains. The old three-line paragraph taught the
            driver how the feature works, which they only need once and then resent; what is
            actually worth saying every time is what they get out of it — the whole field, which
            is what makes the pace-vs-rivals comparisons downstream possible at all.
          */}
          <p className="text-[12px] leading-snug text-muted-foreground">
            {pastedUrl
              ? "Results come in as a file, not a page."
              : "Every driver's laps come with it, so you can compare yourself with the field."}
          </p>
          {/*
            Two doors, in the order they happen: out to MyRCM, then back with the file. The link
            is a real <a> the driver taps — we never request MyRCM ourselves, and that is the
            whole line between this and the scraper it replaced.
          */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <OpenMyRcmLink href={target} variant={featured ? "primary" : "outline"} />
            <button
              type="button"
              className={featured ? WIDE_OUTLINE : WIDE_PRIMARY}
              onClick={pickFile}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Choose file
            </button>
          </div>
          {/*
            The steps are behind this, not printed above the buttons: it is a flow drivers repeat
            every round, and a standing paragraph of instructions is a wall to everyone who already
            knows. Small and quiet, so it reads as help on tap rather than a third action.
          */}
          <div className="flex items-center gap-3 pt-0.5">
            <button type="button" className={TEXT_LINK} onClick={() => setHowOpen(true)}>
              How do I get the file?
            </button>
            {!pastedUrl && !hasImported && !leadsWithFile && !featured ? (
              <button type="button" className={TEXT_LINK} onClick={() => setExpanded(false)}>
                Not on MyRCM
              </button>
            ) : null}
          </div>
        </div>
      )}

      <HowToSheet open={howOpen} onClose={() => setHowOpen(false)} />
    </div>
  );
}

/**
 * Which one are you? MyRCM publishes no driver id and no transponder number — the name is the
 * only handle there has ever been. The name from Settings pre-selects a row, but a club that
 * types "C. Hawkins" one week and "Craig Hawkins" the next will miss, so the whole field is
 * always shown and the selection is always visible, never assumed silently. Tapping any row
 * re-picks. It doubles as the glance that says you grabbed the right race.
 */
function DriverList({
  drivers,
  selectedId,
  driverNotFound,
  onPick,
}: {
  drivers: MyRcmPdfImportResponse["drivers"];
  selectedId: string | null;
  driverNotFound: boolean;
  onPick: (driverId: string) => void;
}) {
  if (drivers.length === 0) return null;
  const needsPick = selectedId == null;
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1.5",
        needsPick ? "border-primary-ink/35 bg-primary/10" : "border-border bg-surface-runna-inset"
      )}
    >
      <p className="px-1 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {needsPick
          ? driverNotFound
            ? "We couldn't find your name — pick your row"
            : "Pick your name"
          : "Your name"}
      </p>
      <ul className="mt-1 divide-y divide-border/70" role="listbox" aria-label="Drivers in this result">
        {drivers.map((d) => {
          const selected = d.id === selectedId;
          return (
            <li key={d.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={cn(
                  "tap-active flex w-full items-center gap-2 rounded px-1 py-1.5 text-left transition",
                  selected ? "bg-surface-runna" : "hover:bg-surface-runna/70"
                )}
                onClick={() => onPick(d.id)}
              >
                <span className="w-5 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {d.position}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[12.5px]",
                    selected ? "font-semibold text-foreground" : "text-foreground/90"
                  )}
                >
                  {d.driverName}
                </span>
                {selected ? (
                  <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">
                    You
                  </span>
                ) : null}
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {d.lapCount} ·{" "}
                  {d.bestLapSeconds != null ? d.bestLapSeconds.toFixed(3) : "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 px-1 text-[10px] text-muted-foreground">
        laps · best lap. Every driver comes with you — pace against the field and rivals.
      </p>
    </div>
  );
}

function FileChip({ name, meta }: { name: string; meta: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface-runna-inset px-2.5 py-1.5 text-xs text-foreground">
        <span className="truncate">{name}</span>
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{meta}</span>
    </div>
  );
}

/**
 * The trip out to MyRCM. A plain link the driver taps — never a fetch, never an auto-click.
 *
 * `href` is the meeting's own class page when the event carries one (`Event.myRcmUrl`), else
 * MyRCM's front page.
 */
function OpenMyRcmLink({
  href,
  variant = "outline",
}: {
  href: string;
  variant?: "primary" | "outline";
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={variant === "primary" ? WIDE_PRIMARY : WIDE_OUTLINE}
      onClick={() => haptic("light")}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      Open MyRCM
    </a>
  );
}

/**
 * The three taps on MyRCM, on demand.
 *
 * Instructions only — the trip out and the file picker are both on the card itself now, so this
 * never competes with them. The ticked-boxes warning is the reason it still exists: untick the lap
 * list on MyRCM's download dialog and the file arrives with finishing positions and no lap times,
 * which is the likeliest way this whole flow fails.
 *
 * Portalled like `ExitPromptSheet` — it opens from inside a card, and any transformed ancestor
 * would quietly turn `fixed` into `absolute` and strand the sheet mid-page.
 */
function HowToSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" onClick={onClose} aria-hidden />
      <div
        className="fixed inset-x-0 bottom-0 z-[61] mx-auto w-full max-w-md rounded-t-[22px] border-t border-border bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.35)]"
        role="dialog"
        aria-modal="true"
        aria-label="Getting your result from MyRCM"
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" aria-hidden />
        <p className="text-[15px] font-bold tracking-tight text-foreground">Getting your result</p>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          Three taps on MyRCM:
        </p>
        <ol className="mt-3 space-y-2">
          {[
            <>Open your class, then the race you drove</>,
            <>
              Tap <span className="font-semibold text-foreground">Download PDF</span>
            </>,
            <>Come back here and pick the file</>,
          ].map((step, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 text-[13px] leading-snug text-foreground"
            >
              <span className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-runna-inset text-[11px] font-bold tabular-nums text-foreground/80">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-3 rounded-md border border-primary-ink/35 bg-primary/10 px-3 py-2">
          <p className="text-[12px] font-semibold text-foreground">Leave everything ticked.</p>
          <p className="mt-0.5 text-[11px] leading-snug text-foreground/85">
            The lap list is the part we need — without it the file only has finishing positions.
          </p>
        </div>
        <div className="mt-4">
          <button type="button" className={WIDE_PRIMARY} onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
