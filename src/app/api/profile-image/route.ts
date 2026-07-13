import { NextResponse } from "next/server";

import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  PROFILE_IMAGE_ALLOWED_MIME,
  PROFILE_IMAGE_MAX_UPLOAD_BYTES,
  ProfileImageStorageError,
  deleteProfileImage,
  readProfileImageBytes,
  storeProfileImage,
} from "@/lib/profileImage/storage";
import { isPrivateAvatarBlobUrl } from "@/lib/profileImage/avatarSrc";

/**
 * Stream the signed-in user's own avatar. Avatars are stored in a private blob store, so
 * the `<img>` in `AccountMenu` / settings points here (via `avatarSrc`) instead of at the
 * blob URL directly. Scoped to the requester's own image — no URL param — so this can't be
 * used to read other private blobs (videos, setup docs) in the store.
 */
export async function GET(): Promise<Response> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const image = user.image;
  if (!isPrivateAvatarBlobUrl(image)) {
    return NextResponse.json({ error: "No image" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readProfileImageBytes(image as string);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/** Upload / replace the signed-in user's profile picture. Returns the new `image` URL. */
export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No image provided." }, { status: 400 });
  if (file.size > PROFILE_IMAGE_MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Image too large (max 8 MB)." }, { status: 400 });
  }
  const mime = file.type?.trim().toLowerCase() ?? "";
  if (mime && !(PROFILE_IMAGE_ALLOWED_MIME as readonly string[]).includes(mime)) {
    return NextResponse.json(
      { error: "Unsupported image type. Use PNG, JPEG, or WebP." },
      { status: 400 }
    );
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { url } = await storeProfileImage(bytes);
    const previous = user.image;
    await prisma.user.update({ where: { id: user.id }, data: { image: url } });
    // Only prune blobs we own — leave external provider avatars (e.g. Google) alone.
    if (previous && previous !== url && previous.includes(".blob.vercel-storage.com")) {
      await deleteProfileImage(previous);
    }
    return NextResponse.json({ image: url });
  } catch (e) {
    const message =
      e instanceof ProfileImageStorageError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Remove the signed-in user's profile picture. */
export async function DELETE(): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const previous = user.image;
  await prisma.user.update({ where: { id: user.id }, data: { image: null } });
  if (previous && previous.includes(".blob.vercel-storage.com")) {
    await deleteProfileImage(previous);
  }
  return NextResponse.json({ image: null });
}
