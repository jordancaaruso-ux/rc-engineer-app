"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

export function AccountSection({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDeleteAccount() {
    if (
      !window.confirm(
        "Delete your JRC Race Engineer account and all runs, setups, and uploads? This cannot be undone."
      )
    ) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/account", { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await signOut({ callbackUrl: "/login" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 rounded-lg border border-border bg-card/40 p-4">
      <h2 className="text-sm font-semibold text-foreground">Account</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Signed in as <span className="text-foreground">{email || "—"}</span>
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
          onClick={() => void signOut({ callbackUrl: "/login" })}
        >
          Sign out
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-sm text-primary hover:bg-primary/20 disabled:opacity-50"
          onClick={() => void onDeleteAccount()}
        >
          {busy ? "Deleting…" : "Delete account"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-primary">{error}</p> : null}
    </section>
  );
}
