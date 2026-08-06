import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { proposeSheetFromPdf } from "@/lib/chassisOnboarding/proposeSheet";

/**
 * Dev-only: run a blank AcroForm setup sheet through the chassis-onboarding proposal and hand
 * back the result, so `/debug/chassis-onboarding` can show what onboarding a new chassis would
 * actually leave a human to do. Nothing is written — the PDF is read in memory and dropped.
 *
 * The parse is the same code path the CLI eval uses (`npm run chassis-onboarding:eval`), so the
 * page and the script cannot disagree about what the pipeline proposes.
 */

// Text extraction plus geometry on a 200-box sheet runs past the default hobby ceiling.
export const maxDuration = 120;

/** Blank sheets are small; anything larger is not one of these. */
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") notFound();

  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a PDF as `file`." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB; the cap is 12MB.` },
      { status: 400 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // `%PDF` up front — an image dropped here otherwise fails deep inside pdfjs with a stack trace
  // instead of a sentence.
  if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
    return NextResponse.json(
      { error: "That isn't a PDF. This needs the manufacturer's blank, fillable sheet." },
      { status: 400 }
    );
  }

  try {
    const proposal = await proposeSheetFromPdf(bytes);
    return NextResponse.json({ fileName: file.name, proposal });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The sheet could not be parsed." },
      { status: 422 }
    );
  }
}
