"use client";

import { useCallback, useEffect, useState } from "react";

type Row = { id: string; email: string; createdAt: string };

export function AllowlistAdminSection() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/settings/auth-allowed-emails");
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { emails: Row[] };
    setRows(
      data.emails.map((r) => ({
        ...r,
        createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(r.createdAt).toISOString(),
      }))
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load allowlist");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const email = input.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/auth-allowed-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setInput("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(email: string) {
    if (!window.confirm(`Remove ${email} from the sign-in allowlist?`)) return;
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ email });
      const res = await fetch(`/api/settings/auth-allowed-emails?${q}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 rounded-lg border border-border bg-card/40 p-4">
      <h2 className="text-sm font-semibold text-foreground">Sign-in allowlist (admin)</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Emails listed here may request a magic link (in addition to <code className="text-foreground">AUTH_ALLOWED_EMAILS</code>{" "}
        and seed). Env admins are set via <code className="text-foreground">AUTH_ADMIN_EMAILS</code>.
      </p>
      {error ? <p className="mt-2 text-xs text-primary">{error}</p> : null}
      <form onSubmit={(e) => void onAdd(e)} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Add email
          <input
            type="email"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            placeholder="teammate@example.com"
            autoComplete="off"
            disabled={busy || loading}
          />
        </label>
        <button
          type="submit"
          disabled={busy || loading || !input.trim()}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {loading ? (
        <p className="mt-4 text-xs text-muted-foreground">Loading…</p>
      ) : (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {rows.length === 0 ? (
            <li className="py-2 text-xs text-muted-foreground">No database allowlist rows yet.</li>
          ) : (
            rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-foreground">{r.email}</span>
                <button
                  type="button"
                  disabled={busy}
                  className="text-xs text-primary hover:underline disabled:opacity-50"
                  onClick={() => void onRemove(r.email)}
                >
                  Remove
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
