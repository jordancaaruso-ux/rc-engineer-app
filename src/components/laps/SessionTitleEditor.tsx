"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { SESSION_CUSTOM_NAME_MAX } from "@/lib/lapImport/sessionNaming";

/**
 * An imported session's page title, which is also where it gets renamed (founder pick,
 * 2026-09-23: rename lives on the session's own page, not on the list rows).
 *
 * The title reads as the title with a small pencil after it; tapping it turns it into a box
 * holding the current name. Clearing the box puts the automatic name back — its placeholder shows
 * what that will be.
 */
export function SessionTitleEditor({
  sessionId,
  title,
  autoTitle,
}: {
  sessionId: string;
  title: string;
  autoTitle: string;
}) {
  const router = useRouter();
  const [shown, setShown] = useState(title);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A refresh after saving hands back the server's copy of the name.
  useEffect(() => setShown(title), [title]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function startEdit() {
    setDraft(shown);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const typed = draft.trim().replace(/\s+/g, " ");
    const customName = typed && typed !== autoTitle ? typed.slice(0, SESSION_CUSTOM_NAME_MAX) : null;
    if ((customName ?? autoTitle) === shown) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/lap-time-sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customName }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Couldn't save that name.");
        return;
      }
      setShown(customName ?? autoTitle);
      setEditing(false);
      router.refresh();
    } catch {
      setError("Couldn't reach the app just now.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <h1 className="page-title max-w-full [overflow-wrap:anywhere]">
        <button
          type="button"
          onClick={startEdit}
          title="Rename"
          className="tap-active cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {shown}
          <Pencil
            className="ml-2 inline-block size-[15px] align-[-1px] text-muted-foreground"
            strokeWidth={2.2}
            aria-hidden
          />
        </button>
      </h1>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex w-[calc(100vw-7.5rem)] max-w-xl flex-col gap-1"
    >
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Session name</span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            placeholder={autoTitle}
            maxLength={SESSION_CUSTOM_NAME_MAX}
            enterKeyHint="done"
            autoComplete="off"
            disabled={saving}
            className="h-11 w-full rounded-lg border border-primary-ink/70 bg-card px-3 text-[17px] font-bold tracking-tight text-foreground outline-none ring-2 ring-primary/30 placeholder:font-semibold placeholder:text-muted-foreground"
          />
        </label>
        <button
          type="button"
          onClick={() => setEditing(false)}
          aria-label="Cancel rename"
          className="tap-active grid size-9 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground transition hover:bg-muted"
        >
          <X className="size-4" aria-hidden />
        </button>
        <button
          type="submit"
          aria-label="Save name"
          disabled={saving}
          className="tap-active primary-face grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:brightness-105 disabled:opacity-60"
        >
          <Check className="size-4" strokeWidth={2.6} aria-hidden />
        </button>
      </div>
      {error ? (
        <p className="text-left text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
