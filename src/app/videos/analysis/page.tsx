import type { ReactNode } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { VideoAnalysisHub } from "@/components/videoAnalysis/VideoAnalysisHub";

export const dynamic = "force-dynamic";

export default async function VideoAnalysisPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <section className="page-body">
        <p className="text-sm text-muted-foreground">Database not configured.</p>
      </section>
    );
  }

  const user = await requireCurrentUser();
  const tracks = await prisma.track.findMany({
    where: { userId: user.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, location: true },
  });

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Video analysis</h1>
          <p className="page-subtitle">
            Manual sector timing from video + transponder, or automatic worker import.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          <Link
            href="/videos/overlay"
            className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
          >
            Overlay compare
          </Link>
        </div>
      </header>
      <section className="page-body">
        <VideoAnalysisHub tracks={tracks} />
      </section>
    </>
  );
}
