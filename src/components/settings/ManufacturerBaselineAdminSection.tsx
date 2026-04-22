"use client";

import { useCallback, useEffect, useState } from "react";
import { SETUP_SHEET_TEMPLATE_OPTIONS } from "@/lib/setupSheetTemplateId";

type BaselineRow = {
  setupSheetTemplate: string;
  pdfUrl: string;
  summary: string | null;
  reviewedAt: string | null;
  updatedAt: string;
};

const templateChoices = SETUP_SHEET_TEMPLATE_OPTIONS.filter((o) => o.value !== "");

export function ManufacturerBaselineAdminSection() {
  const [rows, setRows] = useState<BaselineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState(templateChoices[0]?.value ?? "");
  const [pdfUrl, setPdfUrl] = useState("");
  const [summary, setSummary] = useState("");
  const [setReviewedNow, setSetReviewedNow] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/settings/setup-sheet-manufacturer-baseline");
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { baselines: BaselineRow[] };
    setRows(data.baselines);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load baselines");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!template.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/setup-sheet-manufacturer-baseline", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupSheetTemplate: template,
          pdfUrl,
          summary: summary.trim() || null,
          setReviewedNow,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSetReviewedNow(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(t: string) {
    if (!window.confirm(`Remove manufacturer baseline for ${t}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ setupSheetTemplate: t });
      const res = await fetch(`/api/settings/setup-sheet-manufacturer-baseline?${q}`, {
        method: "DELETE",
      });
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
      <h2 className="text-sm font-semibold text-foreground">Manufacturer baseline (admin)</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        One official PDF + optional summary per setup sheet template. Stored in the database; not mixed into
        community sample counts. URLs must be <code className="text-foreground">https://</code>.
      </p>
      {error ? <p className="mt-2 text-xs text-primary">{error}</p> : null}
      {loading ? <p className="mt-3 text-xs text-muted-foreground">Loading…</p> : null}
      {!loading && rows.length > 0 ? (
        <ul className="mt-3 space-y-2 text-xs">
          {rows.map((r) => (
            <li key={r.setupSheetTemplate} className="rounded border border-border/60 p-2">
              <div className="font-medium text-foreground">{r.setupSheetTemplate}</div>
              <div className="mt-1 break-all text-muted-foreground">{r.pdfUrl}</div>
              {r.summary ? <div className="mt-1 whitespace-pre-wrap text-foreground">{r.summary}</div> : null}
              <div className="mt-1 text-muted-foreground">
                Reviewed: {r.reviewedAt ? r.reviewedAt.slice(0, 10) : "—"} · Updated:{" "}
                {r.updatedAt.slice(0, 10)}
              </div>
              <button
                type="button"
                className="mt-2 text-xs text-primary underline disabled:opacity-50"
                disabled={busy}
                onClick={() => void onRemove(r.setupSheetTemplate)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!loading && rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No baselines on file yet.</p>
      ) : null}

      <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={onSave}>
        <div>
          <label className="text-xs font-medium text-foreground">Template</label>
          <select
            className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            {templateChoices.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-foreground">Manufacturer PDF URL</label>
          <input
            className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
            value={pdfUrl}
            onChange={(e) => setPdfUrl(e.target.value)}
            placeholder="https://…"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground">Summary (optional)</label>
          <textarea
            className="mt-1 min-h-[72px] w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Short bullets for the Engineer when the PDF is not parsed into setup rows."
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={setReviewedNow}
            onChange={(e) => setSetReviewedNow(e.target.checked)}
          />
          Set reviewed date to now
        </label>
        <button
          type="submit"
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          disabled={busy}
        >
          Save baseline
        </button>
      </form>
    </section>
  );
}
