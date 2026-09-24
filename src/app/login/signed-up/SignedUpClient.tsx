"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";

/**
 * Ask the server again whenever the driver comes back to the app — they left to pay on the
 * website, so the likeliest next moment is a plan appearing. The page redirects into the app as
 * soon as it sees one. The slow poll covers paying on another device with this screen still open.
 */
export function RefreshWhenBack(): null {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const poll = window.setInterval(refresh, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.clearInterval(poll);
    };
  }, [router]);
  return null;
}

/**
 * The demo opens only for a signed-out visitor (a signed-in one is sent back to their own
 * garage), so this signs out first. Their account stays; they sign back in with a code.
 */
export function TryDemoButton(): ReactNode {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signOut({ redirect: false }).then(() => window.location.assign("/demo"));
      }}
      className={buttonLinkClassName("outline", "mt-5 w-full px-4 py-3 disabled:opacity-60")}
    >
      {busy ? "Opening the demo…" : "Try the demo"}
    </button>
  );
}

/**
 * Sign out, and delete — the app can create an account, so Apple requires the app to be able to
 * delete one (guideline 5.1.1(v)); an unpaid account can't reach Settings. Same confirm and same
 * route as `DeleteAccountRow`.
 */
export function SignedUpFooter(): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount(): Promise<void> {
    if (!window.confirm(`Delete your ${PRODUCT_NAME} account? This cannot be undone.`)) return;
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
      setBusy(false);
    }
  }

  return (
    <>
      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        <button
          type="button"
          disabled={busy}
          onClick={() => void signOut({ callbackUrl: "/login" })}
          className="text-primary-ink underline-offset-2 hover:underline disabled:opacity-60"
        >
          Sign out
        </button>
        <span aria-hidden="true" className="mx-2.5 opacity-50">
          ·
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void deleteAccount()}
          className="underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60"
        >
          {busy ? "Deleting…" : "Delete account"}
        </button>
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-center text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
