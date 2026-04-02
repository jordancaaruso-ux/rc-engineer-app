"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Link from "next/link";

type BatchRow = {
  id: string;
  name: string | null;
  createdAt: string;
  calibrationProfile: { name: string } | null;
  _count: { documents: number };
};

type QueuedPdf = { id: string; file: File };

function pdfKey(f: File): string {
  return `${f.name}\0${f.size}\0${f.lastModified}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BulkImportHubClient({ initialBatches }: { initialBatches: BatchRow[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [queued, setQueued] = useState<QueuedPdf[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list?.length) return;
    const incoming = Array.from(list).filter((f) => {
      const t = (f.type || "").toLowerCase();
      return t === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    });
    setQueued((prev) => {
      const seen = new Set(prev.map((q) => pdfKey(q.file)));
      const next = [...prev];
      for (const file of incoming) {
        const k = pdfKey(file);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ id: crypto.randomUUID(), file });
      }
      return next;
    });
    e.target.value = "";
  }

  function removeQueued(id: string) {
    setQueued((prev) => prev.filter((q) => q.id !== id));
  }

  async function createBatch(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const label = name.trim();
    if (!label) {
      setErr("Enter a batch name.");
      return;
    }
    if (queued.length === 0) {
      setErr("Add one or more PDF files.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/setup-import-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: label }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        setErr(data.error ?? "Could not create batch");
        return;
      }
      if (!data.id) {
        setErr("Invalid response");
        return;
      }
      // One PDF per request: Vercel/serverless request bodies are capped (~4.5MB). A single
      // FormData with many PDFs often exceeds the limit; batch POST succeeds then upload fails.
      for (let i = 0; i < queued.length; i++) {
        const fd = new FormData();
        fd.append("files", queued[i].file);
        const up = await fetch(`/api/setup-import-batches/${data.id}/upload`, {
          method: "POST",
          body: fd,
        });
        const upData = (await up.json().catch(() => ({}))) as { error?: string; count?: number };
        if (!up.ok) {
          setErr(
            upData.error ??
              `Upload failed for “${queued[i].file.name}” (${i + 1} of ${queued.length}). Try smaller files or fewer at once.`
          );
          return;
        }
        if (typeof upData.count === "number" && upData.count < 1) {
          setErr(`Upload returned no documents for “${queued[i].file.name}”.`);
          return;
        }
      }
      router.push(`/setup/bulk-import/${data.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error during upload";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={createBatch}
        className="rounded-lg border border-border bg-card p-4 space-y-3 max-w-2xl"
      >
        <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">New import batch</div>
        <p className="text-xs text-muted-foreground">
          Name the batch and upload PDFs. You pick a calibration per file when you open it — try several on one PDF to
          see which template fits.
        </p>
        <label className="block text-xs">
          <span className="text-muted-foreground">Batch name</span>
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Snowbirds 2026 — A800RR sheets"
            required
          />
        </label>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="sr-only"
              onChange={onFilesChosen}
              aria-label="Add PDF files"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-medium hover:bg-muted"
            >
              Add PDFs…
            </button>
            <span className="text-[11px] text-muted-foreground">
              Select many at once or add more in several steps; all stay in the list below.
            </span>
          </div>
          {queued.length > 0 ? (
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2 font-medium">File name</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap w-24">Size</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap w-20">Status</th>
                    <th className="px-3 py-2 font-medium w-20 text-right"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {queued.map((q) => (
                    <tr key={q.id}>
                      <td className="px-3 py-2 max-w-[min(100%,280px)] truncate" title={q.file.name}>
                        {q.file.name}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatFileSize(q.file.size)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">Ready</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeQueued(q.id)}
                          className="rounded border border-border px-2 py-1 hover:bg-muted text-[11px]"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">No PDFs queued yet. Use “Add PDFs…” to build your batch.</p>
          )}
        </div>
        {err ? <div className="text-xs text-destructive">{err}</div> : null}
        <button
          type="submit"
          disabled={busy || queued.length === 0}
          className="rounded-md border border-border bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Creating…" : `Create batch & upload (${queued.length})`}
        </button>
      </form>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-2 ui-title text-xs uppercase tracking-wide text-muted-foreground">
          Recent batches
        </div>
        {initialBatches.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">No batches yet.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {initialBatches.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground">{b.name || "Untitled batch"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {b._count.documents} file{b._count.documents === 1 ? "" : "s"} · {new Date(b.createdAt).toLocaleString()}
                    {b.calibrationProfile ? ` · batch default: ${b.calibrationProfile.name}` : ""}
                  </div>
                </div>
                <Link
                  href={`/setup/bulk-import/${b.id}`}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
