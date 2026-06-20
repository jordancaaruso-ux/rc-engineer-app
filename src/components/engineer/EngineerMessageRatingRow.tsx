"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const LOW_SCORE_NOTE_THRESHOLD = 6;

type Props = {
  messageId: string;
  disabled?: boolean;
  initialContext?: {
    question?: string;
    answer?: string;
    runId?: string | null;
    compareRunId?: string | null;
    kbSections?: string[];
  };
};

export function EngineerMessageRatingRow({ messageId, disabled, initialContext }: Props) {
  const [score, setScore] = useState<number | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/engineer/messages/${encodeURIComponent(messageId)}/rating`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { rating: { stars: number; note: string | null } | null };
        if (data.rating && !cancelled) {
          setScore(data.rating.stars);
          setNote(data.rating.note ?? "");
          setSaved(true);
          if (data.rating.stars <= LOW_SCORE_NOTE_THRESHOLD || data.rating.note) {
            setNoteOpen(true);
          }
        }
      } catch {
        /* ignore load errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  const submit = useCallback(
    async (nextScore: number, nextNote?: string) => {
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`/api/engineer/messages/${encodeURIComponent(messageId)}/rating`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            score: nextScore,
            note: nextNote ?? note,
            contextSnapshot: initialContext ?? undefined,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setScore(nextScore);
        setSaved(true);
        if (nextScore <= LOW_SCORE_NOTE_THRESHOLD) setNoteOpen(true);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not save rating");
      } finally {
        setBusy(false);
      }
    },
    [messageId, note, initialContext]
  );

  const showNoteHint = score != null && score <= LOW_SCORE_NOTE_THRESHOLD && !note.trim();

  return (
    <div className="mt-2 pt-2 border-t border-border/50">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-muted-foreground mr-1">Rate 0–10</span>
        {SCORES.map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled || busy}
            aria-label={`Score ${n} out of 10`}
            aria-pressed={score === n}
            onClick={() => void submit(n)}
            className={cn(
              "min-w-[1.35rem] rounded px-0.5 font-mono text-[10px] leading-none transition",
              score === n
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground"
            )}
          >
            {n}
          </button>
        ))}
        {saved ? <span className="text-[10px] text-muted-foreground ml-1">Saved</span> : null}
        <button
          type="button"
          className="text-[10px] text-muted-foreground ml-auto hover:text-foreground"
          onClick={() => setNoteOpen((v) => !v)}
        >
          {noteOpen ? "Hide note" : "Add note"}
        </button>
      </div>
      {showNoteHint ? (
        <p className="text-[10px] text-muted-foreground mt-1">Add a note — what was wrong or missing?</p>
      ) : null}
      {noteOpen ? (
        <div className="mt-1.5 flex gap-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={score != null && score <= LOW_SCORE_NOTE_THRESHOLD ? "What was wrong?" : "Optional note…"}
            className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring/30"
            disabled={busy}
          />
          <button
            type="button"
            disabled={busy || score == null}
            onClick={() => void submit(score ?? 0)}
            className="text-[10px] rounded border border-border px-2 py-1 hover:bg-muted/40 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      ) : null}
      {err ? <p className="text-[10px] text-destructive mt-1">{err}</p> : null}
    </div>
  );
}
