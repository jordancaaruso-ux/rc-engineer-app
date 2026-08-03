import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import {
  clampDraftCount,
  clampDraftText,
  parseSetupFillDraftSubject,
  DRAFT_NAME_MAX,
  DRAFT_PENDING_TEXT_MAX,
  DRAFT_STEP_KEY_MAX,
  type SetupFillDraftSubject,
} from "@/lib/setup/setupFillDraft";

/**
 * The sequential fill flow's parked state (`SetupFillDraft`).
 *
 * A draft is never a `SetupSnapshot`, so nothing written here can reach a setup library, the
 * Engineer's context, or a community aggregation. Promotion to a real setup happens in the
 * existing save routes, which delete the draft in the same transaction.
 */

/**
 * Both branches confirm the caller may write against this subject before anything is stored.
 * The model branch matters most: baselines are *global*, so without the admin gate any signed-in
 * user could park rows against a chassis they have nothing to do with.
 */
async function authorizeSubject(
  subject: SetupFillDraftSubject,
  user: { id: string; email: string | null }
): Promise<{ ok: true } | { error: string; status: number }> {
  if ("carId" in subject) {
    const car = await prisma.car.findFirst({
      where: { id: subject.carId, userId: user.id },
      select: { id: true },
    });
    return car ? { ok: true } : { error: "Car not found", status: 404 };
  }

  if (!isAuthAdminEmail(user.email)) {
    return { error: "Only an admin can author a baseline setup.", status: 403 };
  }
  // Setup sheet models are global — never scope this read by userId.
  const model = await prisma.setupSheetModel.findUnique({
    where: { id: subject.setupSheetModelId },
    select: { id: true },
  });
  return model ? { ok: true } : { error: "Chassis type not found", status: 404 };
}

function draftWhere(subject: SetupFillDraftSubject, userId: string) {
  return "carId" in subject
    ? { userId_carId: { userId, carId: subject.carId } }
    : { userId_setupSheetModelId: { userId, setupSheetModelId: subject.setupSheetModelId } };
}

/**
 * Upsert the draft for a subject.
 *
 * PUT-upsert rather than POST-then-PATCH because the client has no draft id at the first
 * keystroke: two debounced saves 800ms apart would both be pre-id and create two rows. The
 * natural key is already unique in the DB, so this is idempotent under retry, under two tabs and
 * under a resumed draft — and "one draft per car" stays a database fact rather than client
 * bookkeeping.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const subject = parseSetupFillDraftSubject(body);
  if ("error" in subject) {
    return NextResponse.json({ error: subject.error }, { status: 400 });
  }

  const authorized = await authorizeSubject(subject, user);
  if ("error" in authorized) {
    return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  }

  // Same normalization every setup-writing route applies, so promoting a draft is a straight copy
  // with no second pass and no chance of the two shapes drifting apart.
  const data = normalizeSetupSnapshotForStorage(body.data);

  const fields = {
    data,
    stepIndex: clampDraftCount(body.stepIndex),
    pendingText: clampDraftText(body.pendingText, DRAFT_PENDING_TEXT_MAX),
    pendingStepKey: clampDraftText(body.pendingStepKey, DRAFT_STEP_KEY_MAX),
    name: clampDraftText(body.name, DRAFT_NAME_MAX),
    answeredCount: clampDraftCount(body.answeredCount),
    stepCount: clampDraftCount(body.stepCount),
    templateId: clampDraftText(body.templateId, DRAFT_STEP_KEY_MAX),
  };

  const draft = await prisma.setupFillDraft.upsert({
    where: draftWhere(subject, user.id),
    create: {
      userId: user.id,
      carId: "carId" in subject ? subject.carId : null,
      setupSheetModelId: "setupSheetModelId" in subject ? subject.setupSheetModelId : null,
      ...fields,
    },
    update: fields,
    select: { id: true, updatedAt: true },
  });

  return NextResponse.json({
    draft: { id: draft.id, updatedAt: draft.updatedAt.toISOString() },
  });
}

/**
 * Discard the draft for a subject.
 *
 * `deleteMany` scoped by userId, never a delete by client-supplied id: the subject plus the owner
 * *is* the identity, and a double-tapped Discard or a draft the promotion transaction already
 * removed should be a quiet `{ deleted: 0 }` rather than a 404 the client has to special-case.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const subject = parseSetupFillDraftSubject({
    carId: params.get("carId") ?? undefined,
    setupSheetModelId: params.get("setupSheetModelId") ?? undefined,
  });
  if ("error" in subject) {
    return NextResponse.json({ error: subject.error }, { status: 400 });
  }

  const { count } = await prisma.setupFillDraft.deleteMany({
    where: {
      userId: user.id,
      ...("carId" in subject
        ? { carId: subject.carId }
        : { setupSheetModelId: subject.setupSheetModelId }),
    },
  });

  return NextResponse.json({ deleted: count });
}
