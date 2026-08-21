import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import { setupFieldLabel } from "@/lib/setupCompare/changedSincePrevious";
import { planCascadeCandidatesForRun } from "@/lib/runs/planSetupCascadeCandidates";
import { setupKeyIsInlineEditable } from "@/lib/setup/inlineEditableKeys";
import {
  buildSetupCorrectionWrites,
  clearEngineerReadsReferencing,
  runSelectForSetupCorrection,
} from "@/lib/runs/applySetupCorrection";

/**
 * Correcting ONE setup value on a run, from the run page itself.
 *
 * The run page used to have exactly one edit door — a pencil into the six-step
 * log-run wizard — for fixing a mistyped ride height. This is the small door: one
 * key, one value, no route change.
 *
 * The response carries the later runs that plausibly inherited the same mistake,
 * so the "did later runs have this wrong too?" question can open immediately
 * instead of costing a second round trip. Applying it is a separate call
 * (`./apply`) because it is a separate decision — this one has already happened.
 */

type Params = { params: Promise<{ id: string }> };

/** Scalars only. A preset-with-other, a screw list or a tire selection is not something to retype into a text box — those stay on the sheet editor. */
function readScalarBody(body: unknown): { key: string; value: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const key = typeof b.key === "string" ? b.key.trim() : "";
  if (!key) return null;
  const raw = b.value;
  if (typeof raw === "number" && Number.isFinite(raw)) return { key, value: String(raw) };
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length > 120) return null;
  return { key, value };
}

export async function POST(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = readScalarBody(await request.json().catch(() => null));
  if (!body) {
    return NextResponse.json({ error: "A setup key and a value are required" }, { status: 400 });
  }
  // Screw patterns, multi-selects, preset-plus-other and the tire selection are not
  // text, however they render. See `lib/setup/inlineEditableKeys`.
  if (!setupKeyIsInlineEditable(body.key)) {
    return NextResponse.json(
      { error: "That field is edited on the setup sheet, not here" },
      { status: 400 }
    );
  }

  const run = await prisma.run.findFirst({
    where: { id, userId },
    select: runSelectForSetupCorrection,
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!run.carId) {
    return NextResponse.json({ error: "This run has no car, so it has no setup to correct" }, { status: 400 });
  }

  const built = await buildSetupCorrectionWrites({ userId, run, key: body.key, value: body.value });
  if (!built) {
    return NextResponse.json({ ok: true, changed: false, candidates: [] });
  }

  await prisma.$transaction(built.writes);
  await clearEngineerReadsReferencing(userId, [run.id]);
  revalidateAfterRunMutation(userId);

  const candidates = await planCascadeCandidatesForRun({
    userId,
    run: { id: run.id, carId: run.carId, sortAt: run.sortAt },
    key: body.key,
    previousValue: built.previousValue,
    nextValue: body.value,
  });

  return NextResponse.json({
    ok: true,
    changed: true,
    field: { key: body.key, label: setupFieldLabel(body.key) },
    previousValue: built.previousValue ?? null,
    value: body.value,
    candidates,
  });
}
