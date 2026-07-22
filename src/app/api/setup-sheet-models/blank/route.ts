import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import { slugifySetupSheetModelName, uniqueSlugCandidate } from "@/lib/setupSheetModels/slug";
import { storeSetupDocumentFile, StorageConfigurationError } from "@/lib/setupDocuments/storage";
import { verifiedAtForNewCalibration } from "@/lib/setupCalibrations/calibrationAccess";

export const dynamic = "force-dynamic";

/**
 * Create a chassis type the driver maps **by hand**: an empty schema plus an empty AcroForm
 * calibration anchored to the blank sheet he just uploaded, then straight into the mapping editor.
 * Every parameter comes into existence there by clicking its box — no AI naming to undo.
 *
 * Admin-only, like every other chassis-type creation: the catalog is curated ground truth.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json({ error: "Only an admin can create a chassis type." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data (name, pdf)." }, { status: 400 });
  }
  const name = (typeof form.get("name") === "string" ? (form.get("name") as string) : "").trim();
  const pdf = form.get("pdf");
  if (!name) return NextResponse.json({ error: "A chassis name is required." }, { status: 400 });
  if (!(pdf instanceof File)) {
    return NextResponse.json({ error: "The blank setup sheet PDF is required." }, { status: 400 });
  }
  if (pdf.type && pdf.type !== "application/pdf") {
    return NextResponse.json({ error: "Upload the blank sheet as a PDF." }, { status: 400 });
  }

  // Models are global — never mint a second row for a chassis that already exists.
  const norm = normalizeSetupSheetModelName(name);
  const existingRows = await prisma.setupSheetModel.findMany({
    orderBy: [{ isAuthorized: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, slug: true, defaultCalibrationId: true },
  });
  const clash = existingRows.find((m) => normalizeSetupSheetModelName(m.name) === norm);
  if (clash) {
    return NextResponse.json(
      {
        error: `“${clash.name}” already exists. Open it from Chassis types and keep mapping there.`,
        existingModelId: clash.id,
        existingCalibrationId: clash.defaultCalibrationId,
      },
      { status: 409 }
    );
  }

  // Store the blank first: it is what makes the model readable later, and it anchors the calibration.
  let storagePath: string;
  try {
    ({ storagePath } = await storeSetupDocumentFile(pdf));
  } catch (e) {
    const msg =
      e instanceof StorageConfigurationError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Could not store the PDF.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const document = await prisma.setupDocument.create({
    data: {
      originalFilename: `BLANK — ${name}`,
      storagePath,
      mimeType: "application/pdf",
      sourceType: "PDF",
      parseStatus: "PENDING",
      importStatus: "COMPLETED",
      userId: user.id,
    },
    select: { id: true },
  });

  const slug = uniqueSlugCandidate(
    slugifySetupSheetModelName(name),
    new Set(existingRows.map((r) => r.slug))
  );
  const model = await prisma.setupSheetModel.create({
    data: {
      userId: user.id,
      name,
      slug,
      // Deliberately empty: the parameter list is built box by box in the mapping editor.
      schemaJson: { version: 1, label: name, structuredSections: [], fields: [] } as object,
    },
    select: { id: true, name: true, slug: true },
  });

  const calibration = await prisma.setupSheetCalibration.create({
    data: {
      userId: user.id,
      name: `${name} calibration`,
      sourceType: "pdf",
      calibrationDataJson: {
        templateType: "pdf_form_fields",
        documentMeta: { lineGroupingEpsilon: 2.5 },
        formFieldMappings: {},
        fieldMappings: {},
        fields: {},
      } as object,
      exampleDocumentId: document.id,
      setupSheetModelId: model.id,
      verifiedAt: verifiedAtForNewCalibration({ id: user.id, email: user.email }),
    },
    select: { id: true },
  });

  await prisma.setupSheetModel.update({
    where: { id: model.id },
    data: { defaultCalibrationId: calibration.id },
  });
  await prisma.setupDocument.update({
    where: { id: document.id },
    data: { setupSheetModelId: model.id, calibrationProfileId: calibration.id },
  });

  revalidatePath("/cars");
  revalidatePath("/setup-sheet-models");
  return NextResponse.json({ model, calibrationId: calibration.id }, { status: 201 });
}
