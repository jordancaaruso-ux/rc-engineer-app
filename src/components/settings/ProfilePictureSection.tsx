"use client";

import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { CardPanel } from "@/components/ui/CardPanel";
import { avatarSrc } from "@/lib/profileImage/avatarSrc";

/**
 * Profile picture upload. Downscales client-side to a square WebP before POSTing so we
 * stay well under the serverless body limit, then refreshes the JWT session via
 * `update({ image })` so the top-right `AccountMenu` avatar changes live (no reload).
 */

function initials(name?: string | null, email?: string | null): string {
  const src = (name && name.trim()) || (email && email.trim()) || "";
  if (!src) return "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && !src.includes("@")) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return src.split("@")[0].slice(0, 1).toUpperCase();
}

/** Center-crop to a square and downscale to `size`px, exported as a small WebP blob. */
async function fileToSquareWebp(file: File, size = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unsupported");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", 0.9)
    );
    if (!blob) throw new Error("Could not process image");
    return blob;
  } finally {
    bitmap.close?.();
  }
}

export function ProfilePictureSection({
  initialImage,
  name,
  email,
}: {
  initialImage: string | null;
  name: string | null;
  email: string | null;
}) {
  const { update } = useSession();
  const [image, setImage] = useState<string | null>(initialImage);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow re-selecting the same file later.
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy("upload");
    try {
      const blob = await fileToSquareWebp(file);
      const form = new FormData();
      form.append("file", blob, "avatar.webp");
      const res = await fetch("/api/profile-image", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { image?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const next = body.image ?? null;
      setImage(next);
      await update({ image: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    setError(null);
    setBusy("remove");
    try {
      const res = await fetch("/api/profile-image", { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setImage(null);
      await update({ image: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <CardPanel className="mt-10">
      <h2 className="text-sm font-semibold text-foreground">Profile picture</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Shown on your account menu. PNG, JPEG, or WebP.
      </p>
      <div className="mt-4 flex items-center gap-4">
        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-white/[0.15] bg-secondary text-lg font-bold text-foreground">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarSrc(image) ?? undefined} alt="" className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden>{initials(name, email)}</span>
          )}
        </span>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy !== null}
            className="rounded-md border border-primary-ink/50 bg-primary/10 px-3 py-1.5 text-sm text-primary-ink hover:bg-primary/20 disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
          >
            {busy === "upload" ? "Uploading…" : image ? "Change photo" : "Upload photo"}
          </button>
          {image ? (
            <button
              type="button"
              disabled={busy !== null}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
              onClick={() => void onRemove()}
            >
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPick(e)}
      />
      {error ? <p className="mt-3 text-xs text-primary-ink">{error}</p> : null}
    </CardPanel>
  );
}
