import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { hasDatabaseUrl } from "@/lib/env";
import { requireApiFeature } from "@/lib/entitlementGuards";
import { VIDEO_ALLOWED_MIME, VIDEO_MAX_BYTES_DIRECT } from "@/lib/videos/storage";

/**
 * Token endpoint for client-direct video uploads (`upload()` from `@vercel/blob/client`).
 * The browser streams the file straight to Blob storage — the only other route in the
 * upload path is the JSON register call on `POST /api/videos`, so the 4.5MB serverless
 * body limit never applies. Real heat videos are 300MB–1GB; the old multipart-form path
 * choked on them locally (whole-body `formData()` parse) and 413'd in production.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return NextResponse.json(
      { error: "Video storage is not configured on this server." },
      { status: 501 }
    );
  }

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        // Upload is the Pro door for video work (same gate as the legacy form path).
        const gate = await requireApiFeature("video");
        if (gate.response) {
          throw new Error(
            gate.response.status === 401
              ? "Sign in to upload videos."
              : "Video upload needs an active subscription."
          );
        }
        // The client mints `videos/<uuid>.<ext>` — anything else is not ours.
        if (!/^videos\/[0-9a-fA-F-]{36}\.(mp4|webm|mov)$/.test(pathname)) {
          throw new Error("Unexpected upload path.");
        }
        return {
          allowedContentTypes: [...VIDEO_ALLOWED_MIME],
          maximumSizeInBytes: VIDEO_MAX_BYTES_DIRECT,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ userId: gate.user.id }),
        };
      },
      // The VideoAsset row is created by the client's register call, not here: this
      // callback is fired by Vercel's servers and can never reach a dev machine, so
      // nothing may depend on it.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 }
    );
  }
}
