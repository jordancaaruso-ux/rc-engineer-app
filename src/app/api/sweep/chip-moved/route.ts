import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { answerChipMovedQuestion } from "@/lib/sweep/chipMovedQuestion";

export const dynamic = "force-dynamic";

/**
 * The "has this chip moved?" answer from the import sheet (founder call 2026-09-17). Body:
 * `{ chip, carId, moved }` — `moved: true` pairs the chip with that car, `false` keeps the pairing
 * and never asks about that chip and car again. `src/lib/sweep/chipMovedQuestion.ts`.
 */
export async function POST(req: Request): Promise<Response> {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { chip?: unknown; carId?: unknown; moved?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const chip = typeof body.chip === "string" ? body.chip.trim() : "";
  const carId = typeof body.carId === "string" ? body.carId.trim() : "";
  if (!chip || !carId || typeof body.moved !== "boolean") {
    return NextResponse.json({ error: "chip, carId and moved are required" }, { status: 400 });
  }

  const result = await answerChipMovedQuestion({ userId: user.id, chip, carId, moved: body.moved });
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
