import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { CAR_SHEET_NAMES_MAX_PER_SAVE, mergeCarSheetNames } from "@/lib/engineer/carSheetNames";

export const dynamic = "force-dynamic";

/** A box key as sheets write them ("text20", "check_box4", "fr_rollbar"); a longer one is not a key. */
const MAX_KEY_CHARS = 120;

/**
 * Save the driver's own names for boxes on their car's sheet (carSheetNames.ts), sent by "Tell the
 * Engineer" under a setup-change link. Owner only: a name is the driver's word about their own car.
 *
 * `POST { names: { "<box key>": "front roll bar" } }` — an empty name forgets that box's name.
 */
export async function POST(request: Request, context: { params: Promise<{ carId: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { carId } = await context.params;

  const body = (await request.json().catch(() => null)) as { names?: unknown } | null;
  const raw = body?.names;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "names is required" }, { status: 400 });
  }
  const updates: Record<string, string> = {};
  for (const [key, name] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || key.length > MAX_KEY_CHARS || typeof name !== "string") continue;
    updates[key] = name;
  }
  if (Object.keys(updates).length === 0 || Object.keys(updates).length > CAR_SHEET_NAMES_MAX_PER_SAVE) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }

  const car = await prisma.car.findFirst({ where: { id: carId, userId }, select: { id: true, sheetBoxNamesJson: true } });
  if (!car) return NextResponse.json({ error: "Car not found" }, { status: 404 });

  const next = mergeCarSheetNames(car.sheetBoxNamesJson, updates, new Date().toISOString());
  await prisma.car.update({ where: { id: car.id }, data: { sheetBoxNamesJson: next } });
  return NextResponse.json({ ok: true, count: Object.keys(next).length });
}
