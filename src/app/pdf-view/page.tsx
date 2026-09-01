import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { PdfPageImages } from "@/components/pdfView/PdfPageImages";

/**
 * A PDF, inside the app — header, back arrow, and the file as pictures.
 *
 * Every PDF door used to be a raw `target="_blank"` link at the API route. In a desktop browser
 * that is a closable tab; in the installed PWA and the iOS shell a same-origin `_blank` just
 * REPLACES the view with the platform's bare PDF surface — no chrome, no back, stuck (founder
 * report, 2026-09-01). This page is the door back, under the same header as every other page.
 *
 * The body is server-rendered PNGs of the pages (`/api/pdf-view/image`), not an `<iframe>` of the
 * file — iOS clips a framed PDF to a non-scrolling strip, and a picture behaves the same
 * everywhere. Download is the actual file.
 */

const ID_RE = /^[a-z0-9]{16,40}$/i;

type Source = { imageBase: string; downloadHref: string; title: string; fallbackBack: string };

async function resolveSource(
  userId: string,
  params: { snapshot?: string; run?: string; document?: string }
): Promise<Source | null> {
  const snapshotId = params.snapshot?.trim();
  if (snapshotId && ID_RE.test(snapshotId)) {
    const snap = await prisma.setupSnapshot.findFirst({
      where: { id: snapshotId, userId },
      select: { id: true, name: true, carId: true },
    });
    if (!snap) return null;
    return {
      imageBase: `/api/pdf-view/image?snapshot=${encodeURIComponent(snap.id)}`,
      downloadHref: `/api/setup-snapshots/${encodeURIComponent(snap.id)}/setup-pdf?download=1`,
      title: snap.name ?? "Setup sheet",
      fallbackBack: snap.carId ? `/cars/${snap.carId}/setups/${snap.id}` : "/cars",
    };
  }

  const documentId = params.document?.trim();
  if (documentId && ID_RE.test(documentId)) {
    const doc = await prisma.setupDocument.findFirst({
      where: { id: documentId, userId },
      select: { id: true, originalFilename: true },
    });
    if (!doc) return null;
    return {
      imageBase: `/api/pdf-view/image?document=${encodeURIComponent(doc.id)}`,
      // `download=1`: the route answers `attachment`, which is what a phone with no share
      // sheet needs — see `useShareFiles`. Every other caller of this route wants it inline.
      downloadHref: `/api/setup-documents/${encodeURIComponent(doc.id)}/file?download=1`,
      title: doc.originalFilename,
      fallbackBack: "/cars",
    };
  }

  const runId = params.run?.trim();
  if (runId && ID_RE.test(runId)) {
    // The image route itself decides who may read a run's sheet; this page only frames it.
    return {
      imageBase: `/api/pdf-view/image?run=${encodeURIComponent(runId)}`,
      downloadHref: `/api/runs/${encodeURIComponent(runId)}/setup-pdf?download=1`,
      title: "Setup sheet",
      fallbackBack: `/runs/${runId}`,
    };
  }

  return null;
}

/** Only in-app destinations — `back` is a query param anyone can type. */
function safeBack(raw: string | undefined, fallback: string): string {
  const v = raw?.trim() ?? "";
  return v.startsWith("/") && !v.startsWith("//") ? v : fallback;
}

/** What the file calls itself in the share sheet / Downloads folder. */
function pdfFilename(title: string): string {
  const stem = title.replace(/\.pdf$/i, "").replace(/[^\w\- ]+/g, "").trim() || "setup-sheet";
  return `${stem}.pdf`;
}

export default async function PdfViewPage(props: {
  searchParams: Promise<{
    snapshot?: string;
    run?: string;
    document?: string;
    title?: string;
    back?: string;
  }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) notFound();
  const user = await requireCurrentUser();
  const params = await props.searchParams;

  const source = await resolveSource(user.id, params);
  if (!source) notFound();

  const title = params.title?.trim() || source.title;
  const back = safeBack(params.back, source.fallbackBack);

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href={back} />
          <div className="min-w-0">
            <h1 className="page-title truncate">{title}</h1>
          </div>
        </div>
      </header>
      <section className="page-body">
        {/* Actions ride in the body, not the header — the fixed mobile chrome owns its corners. */}
        <PdfPageImages
          imageBase={source.imageBase}
          downloadHref={source.downloadHref}
          filename={pdfFilename(title)}
          title={title}
        />
      </section>
    </>
  );
}
