import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

type Ctx = { params: Promise<{ id: string }> };

const MAX_NAME_LENGTH = 80;

/**
 * Keep a setup, or stop keeping it — the bookmark on every row of "All setups".
 *
 * ============================== WHY THIS MARKS AND DOES NOT COPY ==============================
 *
 * Founder call, 2026-08-11: "mark it — one setup, two places". Saving a run's setup used to POST a
 * whole new snapshot built from the same values, so the car ended up holding the setup twice: once
 * as the run's record and once as the library copy. On a car with 123 runs that is how the list
 * became unreadable, and it is the duplication the All-setups rebuild exists to remove.
 *
 * So this flips `isLibrary` on the row that is already there. The run keeps pointing at the same
 * snapshot, the saved-setups card picks it up, and nothing is duplicated.
 *
 * ============================== WHY A SAVED RUN IS RENAME-ONLY ==============================
 *
 * A run's snapshot IS what that run was set up with. Editing its values after the fact would
 * silently rewrite history — the run would claim numbers it never ran. So `PATCH .../[id]` refuses
 * a `data` change on any snapshot a run points at, and this route only ever touches the flag and
 * the name. To change the values, start a new setup from it: that copies, which is correct there.
 *
 * Naming: the caller sends the title the row was already showing, so one tap saves without asking
 * a question. Renaming afterwards is offered, never required.
 */
export async function POST(request: Request, ctx: Ctx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => ({}))) as { saved?: unknown; name?: unknown };
  const saved = body.saved !== false;
  const requestedName =
    typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME_LENGTH) : "";

  // Any snapshot of the caller's own — a run's, a sheet's, or an already-saved one.
  const existing = await prisma.setupSnapshot.findFirst({
    where: { id, userId },
    select: { id: true, name: true, isLibrary: true, carId: true },
  });
  if (!existing) return NextResponse.json({ error: "Setup not found" }, { status: 404 });

  const updated = await prisma.setupSnapshot.update({
    where: { id },
    data: {
      isLibrary: saved,
      /*
       * Name it on the way in, and keep that name on the way back out.
       *
       * Un-saving deliberately leaves the name alone: a driver who un-saves by accident and saves
       * again should get their name back, not the row's generated title.
       */
      ...(saved && !existing.name && requestedName ? { name: requestedName } : {}),
    },
    select: { id: true, name: true, isLibrary: true },
  });

  return NextResponse.json({ setup: updated });
}
