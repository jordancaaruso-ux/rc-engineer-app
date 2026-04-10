import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

function optString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ eventId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getOrCreateLocalUser();
  const { eventId } = await context.params;

  const existing = await prisma.event.findFirst({
    where: { id: eventId, userId: user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    practiceSourceUrl?: unknown;
    resultsSourceUrl?: unknown;
    raceClass?: unknown;
  };

  const practiceSourceUrl = optString(body.practiceSourceUrl);
  const resultsSourceUrl = optString(body.resultsSourceUrl);
  const raceClass = optString(body.raceClass);

  const data: {
    practiceSourceUrl?: string | null;
    resultsSourceUrl?: string | null;
    raceClass?: string | null;
  } = {};

  if (practiceSourceUrl !== undefined) data.practiceSourceUrl = practiceSourceUrl;
  if (resultsSourceUrl !== undefined) data.resultsSourceUrl = resultsSourceUrl;
  if (raceClass !== undefined) data.raceClass = raceClass;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await prisma.event.update({
    where: { id: eventId },
    data,
  });

  return NextResponse.json({ ok: true });
}
