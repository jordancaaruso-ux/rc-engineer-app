"use client";

import { cn } from "@/lib/utils";

/**
 * The one save model this page uses: every control writes the moment you leave it.
 *
 * There is no Save button anywhere in Settings — a field commits on blur, a chip
 * commits on Enter, a button commits on click. That is only safe if failure
 * recovers itself, which is what `postSetting`'s retry is for: the typed value
 * stays in React state throughout, so nothing is lost even if every attempt fails.
 *
 * Lived inside `SettingsClient` until the 2026-08-18 resection split that file into
 * a "You" card and a timing card; both need it, so it moved here rather than one
 * importing the other.
 */

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok" }
  | { kind: "error"; text: string };

const MAX_RETRIES = 3;

export async function postSetting(
  url: string,
  payload: Record<string, string | boolean | null>,
  setState: (s: SaveState) => void,
  attempt = 0
): Promise<boolean> {
  setState({ kind: "saving" });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    setState({ kind: "ok" });
    window.setTimeout(() => setState({ kind: "idle" }), 1600);
    return true;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      setState({ kind: "error", text: "Couldn’t save — retrying…" });
      await new Promise((r) => window.setTimeout(r, 1500 * (attempt + 1)));
      return postSetting(url, payload, setState, attempt + 1);
    }
    setState({
      kind: "error",
      text: err instanceof Error ? err.message : "Couldn’t save — check your connection",
    });
    return false;
  }
}

/** Saving… / Saved. / the error, in the one place a row reports itself. */
export function SaveNote({ state, className }: { state: SaveState; className?: string }) {
  if (state.kind === "idle") return null;
  return (
    <span
      className={cn(
        "ui-caption",
        state.kind === "error" ? "text-destructive" : "text-muted-foreground",
        state.kind === "ok" && "text-gain",
        className
      )}
      role={state.kind === "error" ? "alert" : undefined}
    >
      {state.kind === "saving" ? "Saving…" : state.kind === "ok" ? "Saved." : state.text}
    </span>
  );
}
