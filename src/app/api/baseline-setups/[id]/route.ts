import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import {
  cleanBaselineName,
  cleanBaselineNotes,
  parseBaselineGripLevel,
  parseBaselineKind,
  parseBaselineSurface,
} from "@/lib/baselineSetups/baselineSetupShape";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Edit / retire a global baseline setup. Admin-only, like publishing one.
 *
 * Neither handler touches the copies drivers made: `SetupSnapshot.sourceBaselineId` is
 * `onDelete: SetNull`, so a driver's adopted setup keeps its own values whatever happens here.
 * That is the whole point of copying on adoption rather than referencing.
 */

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const user = await getAuthenticatedApiUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isAuthAdminEmail(user.email)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Only an admin can change a baseline setup." },
        { status: 403 }
      ),
    };
  }
  return { ok: true, userId: user.id };
}

export async function PATCH(request: Request, ctx: Ctx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const existing = await prisma.baselineSetup.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Baseline not found" }, { status: 404 });

  const patch: Prisma.BaselineSetupUpdateInput = {};

  if (body.name !== undefined) {
    const name = cleanBaselineName(body.name);
    if (!name) return NextResponse.json({ error: "A name is required" }, { status: 400 });
    patch.name = name;
  }
  if (body.kind !== undefined) {
    const kind = parseBaselineKind(body.kind);
    if (!kind) return NextResponse.json({ error: "Pick kit, base or pro" }, { status: 400 });
    patch.kind = kind;
  }
  // Tags and notes are optional: sending them at all means "set them to this", including to null.
  if (body.notes !== undefined) patch.notes = cleanBaselineNotes(body.notes);
  if (body.surface !== undefined) patch.surface = parseBaselineSurface(body.surface);
  if (body.gripLevel !== undefined) patch.gripLevel = parseBaselineGripLevel(body.gripLevel);
  if (body.data !== undefined) {
    const data = normalizeSetupSnapshotForStorage(body.data);
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "A baseline needs at least one value" }, { status: 400 });
    }
    patch.data = data as Prisma.InputJsonValue;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.baselineSetup.update({
    where: { id },
    data: patch,
    select: { id: true, name: true, kind: true },
  });

  return NextResponse.json({ baseline: updated });
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const deleted = await prisma.baselineSetup.deleteMany({ where: { id } });
  if (deleted.count === 0) {
    return NextResponse.json({ error: "Baseline not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
