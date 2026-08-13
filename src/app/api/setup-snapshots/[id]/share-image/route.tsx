import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { renderSetupSheetImage } from "@/lib/share/renderSetupImage";

/**
 * A setup, as a picture of its own sheet with the brand footer stamped on.
 *
 * Owner-only, unlike the run card. `ensureRenderedSetupSnapshotPdf` is already scoped by `userId`
 * internally, so the explicit `userId` here is what stops a peer probing another driver's
 * snapshot ids. Sharing a teammate's setup is their call to make, not yours.
 *
 * 404 when the chassis has no sheet the app can draw. There is deliberately no fallback picture:
 * a setup share must always look like the sheet, so the honest answer is a sentence naming what is
 * missing, which the Share button shows the driver verbatim.
 */

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const snapshot = await prisma.setupSnapshot.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!snapshot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await renderSetupSheetImage({ userId, setupSnapshotId: snapshot.id });
  if (!bytes) {
    return NextResponse.json(
      {
        error:
          "This car has no setup sheet the app can draw yet — link it to a chassis type with a sheet, or import a setup PDF.",
      },
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=300",
    },
  });
}
