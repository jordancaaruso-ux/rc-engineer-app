import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { discoverPetitRcSetupPdfs } from "@/lib/petitrc/discoverPetitRcPdfs";

const SOURCE_SITE = "petitrc";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => ({}))) as { url?: string; maxPdfs?: number };
  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  if (!rawUrl) return NextResponse.json({ error: "url is required" }, { status: 400 });

  const maxPdfs =
    typeof body.maxPdfs === "number" && Number.isFinite(body.maxPdfs) && body.maxPdfs > 0
      ? Math.min(Math.floor(body.maxPdfs), 2000)
      : 500;

  const discovered = await discoverPetitRcSetupPdfs(rawUrl, { maxPdfs, maxFolders: 120 });
  const urls = discovered.map((d) => d.url);
  if (urls.length === 0) {
    return NextResponse.json({ error: "No setup PDFs found at that PetitRC URL." }, { status: 404 });
  }

  const existing = await prisma.setupDocument.findMany({
    where: {
      userId: user.id,
      sourceSite: SOURCE_SITE,
      sourceUrl: { in: urls },
    },
    select: { sourceUrl: true },
  });
  const already = new Set(existing.map((e) => e.sourceUrl).filter((x): x is string => typeof x === "string" && x.length > 0));
  const newUrls = urls.filter((u) => !already.has(u));

  return NextResponse.json(
    {
      discoveredCount: urls.length,
      alreadyImportedByUrlCount: already.size,
      newByUrlCount: newUrls.length,
      note: "This preview only checks URL dedupe. Hash-based dedupe is applied during the actual import.",
    },
    { status: 200 }
  );
}

