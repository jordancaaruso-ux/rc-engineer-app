import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { isChassisPlatformId } from "@/lib/cars/carClasses";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import { StorageConfigurationError } from "@/lib/setupDocuments/storage";
import { recordChassisTypeRequest } from "@/lib/setupSheetModels/chassisTypeRequests";
import {
  createModelFromBlank,
  type BlankUploadSource,
} from "@/lib/setupSheetModels/createModelFromBlank";

export const dynamic = "force-dynamic";

/**
 * Create a chassis type from a blank manufacturer setup sheet.
 *
 * TWO DOORS, ONE ROUTE.
 *
 *   derive=1   Any signed-in driver. The parameter list is read off the PDF's form layer, so the
 *              car works the moment it is added, and whatever the file already holds comes back
 *              with it as values. One door handles a finished sheet and a manufacturer's blank
 *              alike, because nothing can tell them apart — see `createModelFromBlank`. The chassis
 *              is global and unreviewed, exactly like a driver-authored track or tire; see
 *              `docs/ASSET_ACCESS_NORTH_STAR.md`, where chassis types were the one admin-only-create
 *              exception. This retires that exception: the founder still reviews, he no longer has
 *              to author.
 *
 *   (default)  Admin only. An empty schema plus an empty AcroForm calibration anchored to the
 *              blank, then straight into the mapping editor. Every parameter comes into existence
 *              by clicking its box — no derived naming to undo.
 *
 * Duplicate NAMES are not blocked on the driver's door: a name is a label, not evidence, and
 * refusing on one would let anyone deny a name to everyone else by typing it first. Two uploads
 * become one chassis only when the derivation proves them identical — see `createModelFromBlank`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = isAuthAdminEmail(user.email);

  const contentType = request.headers.get("content-type") ?? "";
  let name = "";
  let discipline = "";
  let derive = false;
  let upload: BlankUploadSource | null = null;

  if (contentType.includes("application/json")) {
    // The browser already streamed the file to Blob because it was over the serverless body limit.
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    name = typeof body.name === "string" ? body.name.trim() : "";
    discipline = typeof body.discipline === "string" ? body.discipline.trim() : "";
    derive = body.derive === true || body.derive === "1";
    const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
    if (!storagePath) {
      return NextResponse.json({ error: "storagePath is required." }, { status: 400 });
    }
    upload = {
      kind: "stored",
      storagePath,
      originalFilename: typeof body.originalFilename === "string" ? body.originalFilename : "blank.pdf",
      mimeType: typeof body.mimeType === "string" ? body.mimeType : "application/pdf",
      byteSize: typeof body.byteSize === "number" ? body.byteSize : 1,
    };
  } else {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart form data (name, pdf)." }, { status: 400 });
    }
    name = (typeof form.get("name") === "string" ? (form.get("name") as string) : "").trim();
    discipline = (
      typeof form.get("discipline") === "string" ? (form.get("discipline") as string) : ""
    ).trim();
    derive = form.get("derive") === "1";
    const pdf = form.get("pdf");
    if (!(pdf instanceof File)) {
      return NextResponse.json({ error: "The blank setup sheet PDF is required." }, { status: 400 });
    }
    upload = { kind: "file", file: pdf };
  }

  if (!name) return NextResponse.json({ error: "A chassis name is required." }, { status: 400 });

  /*
   * DISCIPLINE IS REQUIRED ON THE DRIVER'S DOOR (founder call, 2026-08-26).
   *
   * Nothing used to ask. Discipline was inferred from `CHASSIS_PLATFORM_BY_SLUG` — twelve curated
   * slugs — and a derived row's slug is a fingerprint, so every chassis a driver added read as
   * "unknown" for the life of the row unless they found the override picker on the car page.
   *
   * Required here and not merely on the client, because the client is not the only caller and a
   * null that reaches the column is indistinguishable from a pre-2026-08-26 row.
   *
   * The ADMIN door stays optional: the by-hand path starts from an empty schema and the founder
   * is authoring a catalog row whose slug the platform map already answers for. Sending it is
   * still honoured — it is the requirement, not the column, that is scoped to the driver.
   */
  if (derive && !isChassisPlatformId(discipline)) {
    return NextResponse.json(
      {
        error: discipline
          ? "That isn't a discipline we know."
          : "Pick what this chassis races.",
      },
      { status: 400 }
    );
  }
  if (!derive && discipline && !isChassisPlatformId(discipline)) {
    return NextResponse.json({ error: "That isn't a discipline we know." }, { status: 400 });
  }

  if (!derive && !isAdmin) {
    return NextResponse.json(
      { error: "Only an admin can map a chassis type by hand." },
      { status: 403 }
    );
  }

  // The admin door still refuses a name that already exists, because he is authoring the curated
  // row and a second one would be his own duplicate. An unreviewed driver row does not block him:
  // that is the case the ordering below exists for, and the two are merged afterwards.
  if (!derive) {
    const norm = normalizeSetupSheetModelName(name);
    const existingRows = await prisma.setupSheetModel.findMany({
      orderBy: [{ isAuthorized: "desc" }, { createdAt: "asc" }],
      select: { id: true, name: true, defaultCalibrationId: true, isAuthorized: true },
    });
    const clash = existingRows.find((m) => normalizeSetupSheetModelName(m.name) === norm);
    if (clash?.isAuthorized) {
      return NextResponse.json(
        {
          error: `"${clash.name}" already exists. Open it from Chassis types and keep mapping there.`,
          existingModelId: clash.id,
          existingCalibrationId: clash.defaultCalibrationId,
        },
        { status: 409 }
      );
    }
  }

  let result;
  try {
    result = await createModelFromBlank({
      user: { id: user.id, email: user.email },
      name,
      discipline: discipline || null,
      upload,
      derive,
      source: derive && !isAdmin ? "driver" : "admin",
    });
  } catch (e) {
    // The storage hint names an environment variable and is written for the founder. A driver who
    // sees it learns nothing and assumes they did something wrong.
    if (e instanceof StorageConfigurationError) {
      console.error("[blank-upload] storage not configured", e);
      return NextResponse.json(
        { error: isAdmin ? e.message : "We couldn't store that file. Try again in a moment." },
        { status: 500 }
      );
    }
    console.error("[blank-upload] failed", e);
    return NextResponse.json({ error: "We couldn't read that PDF. Try again." }, { status: 500 });
  }

  if (!result.ok) {
    // A sheet we could not use still means a chassis the catalog is missing, so the founder hears
    // about it through the same channel as an explicit request.
    if (result.refusal.status) {
      await recordChassisTypeRequest({
        userId: user.id,
        userEmail: user.email,
        requestedName: name,
      });
    }
    return NextResponse.json(
      {
        error: result.refusal.message,
        refusalCode: result.refusal.code,
        offerCarWithoutSheet: result.refusal.offerCarWithoutSheet,
      },
      { status: 422 }
    );
  }

  revalidatePath("/cars");
  revalidatePath("/setup-sheet-models");
  return NextResponse.json(
    {
      model: { ...result.model, isAuthorized: false },
      calibrationId: result.calibrationId,
      blankId: result.blankId,
      stats: result.stats,
      merged: result.merged,
      // Whatever the file already had in its boxes. Handed back rather than saved here, because
      // there is no car to hang a setup off until the driver finishes adding one.
      values: result.values,
      filledCount: result.filledCount,
    },
    { status: result.merged ? 200 : 201 }
  );
}
