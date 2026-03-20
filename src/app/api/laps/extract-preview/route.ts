import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { openaiVisionLapExtractor } from "@/lib/lapImageExtract/openaiVisionExtractor";

const MAX_BYTES = 6 * 1024 * 1024;

/** Image upload → OpenAI vision JSON extraction (requires OPENAI_API_KEY). */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  await getOrCreateLocalUser();

  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("image");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing image field" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large (max 6 MB)" }, { status: 400 });
  }

  const mime = file.type || "";
  if (!mime.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image" }, { status: 400 });
  }

  const result = await openaiVisionLapExtractor.extract(file);

  const meta = (result.meta ?? {}) as Record<string, unknown>;
  const confidence =
    typeof meta.confidence === "string" && ["high", "medium", "low"].includes(meta.confidence)
      ? (meta.confidence as "high" | "medium" | "low")
      : null;

  return NextResponse.json({
    extractorId: openaiVisionLapExtractor.id,
    laps: result.laps,
    note: result.note ?? null,
    confidence,
    meta,
    filename: file.name || null,
  });
}
