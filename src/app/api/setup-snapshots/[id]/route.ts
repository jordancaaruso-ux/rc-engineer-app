import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";

type Ctx = { params: Promise<{ id: string }> };

const MAX_NAME_LENGTH = 80;

/**
 * Rename / re-save / delete one of the caller's own setups.
 *
 * The gate used to be `isLibrary: true`, which made a setup an uploaded sheet created — the kind
 * with no runs and nothing depending on it — permanently unopenable, purely because nobody had
 * bookmarked it. The rule is now the one that describes the actual risk: **values may be written in
 * place when no run points at them.** A run's own record still cannot be written here; it is edited
 * through `/api/runs/[id]/setup-snapshot`, which writes a new snapshot and repoints the run rather
 * than rewriting what that run claims to have raced.
 */

/** Load the row only if it is the caller's own setup. */
async function loadOwnedSetup(id: string, userId: string) {
  return prisma.setupSnapshot.findFirst({
    where: { id, userId },
    select: {
      id: true,
      name: true,
      data: true,
      isLibrary: true,
      carId: true,
      car: { select: { setupSheetModelId: true } },
      _count: { select: { runs: true } },
    },
  });
}

/**
 * Read one of the caller's own setups in full.
 *
 * Exists for the Geometry Lab, which is seeded by a URL carrying only the geometry slice — 19 keys
 * of a sheet that has getting on for 300 boxes. Drawing that sheet from the slice alone would show a
 * driver their own setup with every non-geometry box blank, and saving from it would write that
 * emptiness back. So the Lab follows the seed's reference and fetches the row.
 *
 * `runCount` rides along because it is the fact that decides what the Lab may offer: a snapshot a run
 * points at is that run's record and cannot be written in place (see PATCH below). The client needs
 * to know that before it draws a button, not after the 409.
 */
export async function GET(_request: Request, ctx: Ctx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const existing = await loadOwnedSetup(id, userId);
  if (!existing) return NextResponse.json({ error: "Setup not found" }, { status: 404 });

  return NextResponse.json({
    setup: {
      id: existing.id,
      name: existing.name,
      data: existing.data,
      isLibrary: existing.isLibrary,
      carId: existing.carId,
      setupSheetModelId: existing.car?.setupSheetModelId ?? null,
      runCount: existing._count.runs,
    },
  });
}

export async function PATCH(request: Request, ctx: Ctx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const existing = await loadOwnedSetup(id, userId);
  if (!existing) return NextResponse.json({ error: "Setup not found" }, { status: 404 });

  const patch: { name?: string; data?: ReturnType<typeof normalizeSetupSnapshotForStorage> } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME_LENGTH) : "";
    if (!name) return NextResponse.json({ error: "A setup name is required" }, { status: 400 });
    patch.name = name;
  }
  if (body.data !== undefined) {
    /*
     * A saved setup that a run points at is that run's own record, and must never be edited here.
     *
     * Saving from "All setups" flips `isLibrary` on the run's existing snapshot rather than copying
     * it (see `./save/route.ts`). That is what keeps the list free of duplicates — and it puts run
     * history inside the one table this route may write, so the guard has to live here. Without it,
     * saving a run's setup and then editing it would silently change the numbers that run claims to
     * have been on.
     */
    if (existing._count.runs > 0) {
      return NextResponse.json(
        {
          error:
            "This setup is what a logged run recorded, so it can't be written over. Correct the run, or save a new setup from it.",
        },
        { status: 409 }
      );
    }
    patch.data = normalizeSetupSnapshotForStorage(body.data);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.setupSnapshot.update({
    where: { id },
    data: {
      ...patch,
      // A re-saved setup invalidates its cached filled PDF; drop it so the next request re-renders.
      ...(patch.data ? { renderedSetupPdfPath: null, renderedSetupPdfGeneratedAt: null } : {}),
    },
    select: { id: true, name: true },
  });

  return NextResponse.json({ setup: updated });
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const existing = await loadOwnedSetup(id, userId);
  if (!existing) return NextResponse.json({ error: "Setup not found" }, { status: 404 });

  /*
   * Delete stays library-only, and deliberately did not follow the PATCH gate down. A setup an
   * upload created is the only record that the sheet was ever read: `SetupDocument.createdSetupId`
   * points at it, and deleting it would leave that row pointing at nothing while the file itself
   * survives. Un-bookmarking is the driver's door for "I don't want this in my list".
   */
  if (!existing.isLibrary) {
    return NextResponse.json({ error: "Setup not found" }, { status: 404 });
  }

  // `Run.setupSnapshot` is a required relation, so deleting a snapshot a run points at would fail
  // at the FK anyway — refuse with a message the UI can show instead of a 500.
  if (existing._count.runs > 0) {
    return NextResponse.json(
      {
        error: `This setup is used by ${existing._count.runs} logged run${
          existing._count.runs === 1 ? "" : "s"
        } and can't be deleted.`,
      },
      { status: 409 }
    );
  }

  // Runs derived *from* this setup keep their own resolved data; the lineage link is onDelete: SetNull.
  await prisma.setupSnapshot.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
