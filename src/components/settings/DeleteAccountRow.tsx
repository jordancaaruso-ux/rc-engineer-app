"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";

/**
 * The one irreversible action on this page, at the bottom, in one line.
 *
 * It used to be a yellow-tinted button sitting beside Sign out — the same visual weight as
 * the safest control on the page, wearing the colour this app reserves for the action it
 * wants you to take. Quiet destructive text now (founder call, 2026-08-18); the confirm
 * dialog is unchanged and still spells out what goes with it.
 */
export function DeleteAccountRow() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDeleteAccount() {
    if (
      !window.confirm(
        `Delete your ${PRODUCT_NAME} account and all runs, setups, and uploads? This cannot be undone.`
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
    <div className="mt-10 border-t border-border pt-5">
      <button
        type="button"
        disabled={busy}
        onClick={() => void onDeleteAccount()}
        className="text-xs font-medium text-destructive underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
      >
        {busy ? "Deleting…" : "Delete account"}
      </button>
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
