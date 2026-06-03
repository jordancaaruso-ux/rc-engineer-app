"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

type MylapsStatus = {
  connected: boolean;
  accountId: string | null;
  chipCount: number;
  chipNumbers: number[];
  oauthAppConfigured: boolean;
};

export function MylapsLinkSection() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<MylapsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageOk, setMessageOk] = useState(false);

  const flash = searchParams.get("mylaps");
  const flashHint = searchParams.get("mylaps_hint");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mylaps/status", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as MylapsStatus | null;
      if (res.ok && data) setStatus(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (flash === "connected") {
      setMessageOk(true);
      setMessage("MYLAPS account linked.");
      void loadStatus();
    } else if (flash === "error" || flash === "oauth_unavailable") {
      setMessageOk(false);
      setMessage(flashHint ?? "Could not link MYLAPS account.");
    }
  }, [flash, flashHint, loadStatus]);

  async function pasteTokenLink() {
    const accessToken = tokenInput.trim();
    if (!accessToken) {
      setMessageOk(false);
      setMessage("Paste an access token first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/mylaps/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setMessageOk(false);
        setMessage(data?.error ?? "Link failed.");
        return;
      }
      setTokenInput("");
      setMessageOk(true);
      setMessage("MYLAPS account linked.");
      await loadStatus();
    } catch {
      setMessageOk(false);
      setMessage("Link failed.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/mylaps/disconnect", { method: "POST" });
      if (!res.ok) {
        setMessageOk(false);
        setMessage("Could not disconnect.");
        return;
      }
      setMessageOk(true);
      setMessage("MYLAPS account disconnected.");
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
      <div>
        <div className="text-sm font-medium text-foreground">MYLAPS / Speedhive account</div>
        <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
          Link once to pull <span className="text-foreground/90">your</span> race sessions (from your
          transponders) when logging a run — no per-track Speedhive URL needed.
        </p>
      </div>

      {loading ? (
        <p className="text-[11px] text-muted-foreground">Checking link status…</p>
      ) : status?.connected ? (
        <div className="space-y-2">
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
            Connected
            {status.accountId ? (
              <>
                {" "}
                · account <span className="font-mono text-foreground/80">{status.accountId}</span>
              </>
            ) : null}
            {status.chipCount > 0 ? ` · ${status.chipCount} transponder(s)` : null}
          </p>
          {status.chipNumbers.length > 0 ? (
            <p className="text-[10px] font-mono text-muted-foreground break-all">
              {status.chipNumbers.join(", ")}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void disconnect()}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
          >
            Disconnect MYLAPS
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/mylaps/connect"
              className={cn(
                "rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted",
                busy && "pointer-events-none opacity-60"
              )}
            >
              Sign in with MYLAPS
            </a>
            {!status?.oauthAppConfigured ? (
              <span className="text-[10px] text-muted-foreground self-center">
                (requires MYLAPS OAuth app — use token paste below)
              </span>
            ) : null}
          </div>

          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground/90">
              Paste access token (works today)
            </summary>
            <ol className="mt-2 list-decimal pl-4 space-y-1 leading-snug">
              <li>
                Open{" "}
                <a
                  href="https://speedhive.mylaps.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  speedhive.mylaps.com
                </a>{" "}
                and sign in.
              </li>
              <li>Open browser DevTools → Network.</li>
              <li>Reload the page; click any request to <code className="text-[10px]">usersandproducts-api.speedhive.com</code>.</li>
              <li>
                Copy the <code className="text-[10px]">Authorization</code> header value (the part
                after <code className="text-[10px]">Bearer </code>).
              </li>
              <li>Paste below and save. Tokens expire — link again if imports stop working.</li>
            </ol>
            <textarea
              className="mt-2 w-full min-h-[72px] rounded-md border border-border bg-card px-3 py-2 text-[11px] font-mono outline-none"
              placeholder="Paste Bearer token…"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void pasteTokenLink()}
              className="mt-2 rounded-md border border-border bg-muted/70 px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
            >
              {busy ? "Linking…" : "Link with token"}
            </button>
          </details>
        </div>
      )}

      {message ? (
        <p
          className={cn(
            "text-[11px]",
            messageOk ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
          )}
        >
          {message}
        </p>
      ) : null}

      <p className="text-[10px] text-muted-foreground">
        For production OAuth, MYLAPS must register redirect URI{" "}
        <code className="text-foreground/80">/api/mylaps/callback</code> on an Azure B2C app — set{" "}
        <code className="text-foreground/80">MYLAPS_OAUTH_CLIENT_ID</code> in env. See{" "}
        <Link href="https://help.mylaps.com" className="underline" target="_blank" rel="noopener noreferrer">
          MYLAPS support
        </Link>{" "}
        if you need partner access.
      </p>
    </div>
  );
}
