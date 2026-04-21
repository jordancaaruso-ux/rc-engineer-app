import type { ReactNode } from "react";
import Link from "next/link";

export default async function VideosPage(): Promise<ReactNode> {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Videos</h1>
          <p className="page-subtitle">
            Local-file overlay only (no uploads). Choose two videos on the overlay page to compare lines and pace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          <Link href="/videos/overlay" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted">
            Overlay compare
          </Link>
          <Link href="/" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted">
            Home
          </Link>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Video upload/library is disabled for now to avoid Blob storage/bandwidth costs on Vercel. Use{" "}
          <Link href="/videos/overlay" className="underline hover:text-foreground">
            Video overlay
          </Link>{" "}
          to pick files directly from your device.
        </div>
      </section>
    </>
  );
}

