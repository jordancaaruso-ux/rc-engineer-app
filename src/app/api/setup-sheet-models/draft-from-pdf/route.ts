import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { draftCalibrationFromBlankSheet } from "@/lib/setupExtractAi/draftCalibrationFromBlankSheet";
import type { ImageRegion } from "@/lib/setupCalibrations/types";

// Vision drafting over batches of AcroForm fields runs tens of seconds — give it room on Vercel.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * AcroForm-anchored parameter drafting (SETUP_UPLOAD_NORTH_STAR.md — template creation is
 * AcroForm-first). The client renders the AcroForm PDF's first page to a PNG and posts both;
 * the AcroForm supplies exact box geometry and the vision model only reads labels/purpose at
 * those known locations. Returns the drafted fields for review (never persists) — a PDF with
 * no form fields is rejected, since there is no geometry to anchor to.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data (pdf, png, name)." }, { status: 400 });
  }

  const pdf = form.get("pdf");
  const png = form.get("png");
  const name = (typeof form.get("name") === "string" ? (form.get("name") as string) : "").trim();
  if (!(pdf instanceof File)) return NextResponse.json({ error: "An AcroForm PDF file is required." }, { status: 400 });
  if (!(png instanceof File)) {
    return NextResponse.json({ error: "The rendered page image (png) is required." }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "A sheet model name is required." }, { status: 400 });

  const editablePdfBytes = Buffer.from(await pdf.arrayBuffer());
  const blankImageBytes = Buffer.from(await png.arrayBuffer());

  try {
    const result = await draftCalibrationFromBlankSheet({
      apiKey,
      editablePdfBytes,
      blankImageBytes,
      blankImageMime: "image/png",
      carName: name,
    });
    // draftCalibrationFromBlankSheet pushes exactly one drafted field per geometry field, in
    // order, so fields[i] and geometry.fields[i] describe the same box(es).
    const geoFields = result.geometry.fields;
    const fields = result.draftedSchema.fields.map((f, i) => ({
      ...f,
      regions: (geoFields[i]?.widgets ?? []).map((w) => w.region) as ImageRegion[],
    }));
    return NextResponse.json({
      fields,
      universalMappedCount: result.draftedSchema.universalMappedCount,
      warnings: result.warnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Drafting failed.";
    // The engine throws a specific message when the PDF carries no AcroForm fields — that is a
    // rejected input (flat/scanned PDF), not a server fault.
    const rejected = /AcroForm fields|editable blank/i.test(msg);
    return NextResponse.json(
      {
        error: rejected
          ? "This PDF has no editable form fields. Template creation needs an editable AcroForm setup sheet."
          : msg,
      },
      { status: rejected ? 400 : 500 }
    );
  }
}
