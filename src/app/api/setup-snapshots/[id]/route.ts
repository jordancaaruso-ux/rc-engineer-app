import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";

type Ctx = { params: Promise<{ id: string }> };

const MAX_NAME_LENGTH = 80;

/**
 * Rename / re-save / delete a **library** setup (`SetupSnapshot.isLibrary`).
 *
 * Per-run snapshots are deliberately out of reach here: they are run history, edited through
 * `/api/runs/[id]/setup-snapshot`. Every handler below requires `isLibrary: true` *and* the
 * requester's own userId, so neither route can touch the other's rows.
 */

/** Load the row only if it is the caller's own library setup. */
async function loadOwnedLibrarySetup(id: string, userId: string) {
  return prisma.setupSnapshot.findFirst({
    where: { id, userId, isLibrary: true },
    select: { id: true, name: true, data: true, _count: { select: { runs: true } } },
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

  const existing = await loadOwnedLibrarySetup(id, userId);
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
            "This setup is a record of a logged run, so its values can't be changed. Rename it, or start a new setup from it.",
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

  const existing = await loadOwnedLibrarySetup(id, userId);
  if (!existing) return NextResponse.json({ error: "Setup not found" }, { status: 404 });

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
