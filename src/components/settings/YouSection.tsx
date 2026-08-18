"use client";

import { useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Camera, Pencil } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { avatarSrc } from "@/lib/profileImage/avatarSrc";
import { postSetting, SaveNote, type SaveState } from "@/components/settings/saveState";

/**
 * Who you are: photo, display name, email, sign out — one card.
 *
 * These were three separate things on this page (display name first, profile picture
 * second-last, email + sign out last) with notifications and a catalog list in between.
 * They are one idea, so they read as one card now (founder call, 2026-08-18).
 *
 * The photo is not a section any more — it is the avatar, and you tap it. Downscales
 * client-side to a square WebP before POSTing so we stay well under the serverless body
 * limit, then refreshes the JWT session via `update({ image })` so the top-right
 * `AccountMenu` avatar changes live (no reload).
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

export function YouSection({
  initialImage,
  initialName,
  name,
  email,
}: {
  initialImage: string | null;
  /** The `myName` app setting — what the app calls you. */
  initialName: string;
  /** The auth account name, used only for initials when there's no photo. */
  name: string | null;
  email: string | null;
}) {
  const { update } = useSession();
  const [image, setImage] = useState<string | null>(initialImage);
  const [myName, setMyName] = useState(initialName);
  const [savingName, setSavingName] = useState<SaveState>({ kind: "idle" });
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedName = useRef(initialName);

  async function commitName() {
    if (myName.trim() === committedName.current.trim()) return;
    const ok = await postSetting(
      "/api/settings/my-name",
      { myName: myName.trim() || null },
      setSavingName
    );
    if (ok) committedName.current = myName;
  }

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

  async function onRemovePhoto() {
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
    <CardPanel contentClassName="p-0">
      {/* The section label lives IN the card (2026-08-18). Settings was the last page
          holding its headings out in the page ground; every other surface in the app
          names itself from inside, so a card can be read — or lifted somewhere else —
          without the page around it explaining what it is. */}
      <div className="px-4 pt-3.5">
        <Eyebrow>You</Eyebrow>
      </div>
      <div className="flex items-center gap-3 px-4 pb-4 pt-1">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => inputRef.current?.click()}
          aria-label={image ? "Change photo" : "Add a photo"}
          title={image ? "Change photo" : "Add a photo"}
          className="tap-active group relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-secondary text-base font-bold text-foreground disabled:opacity-50"
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarSrc(image) ?? undefined} alt="" className="size-full object-cover" />
          ) : (
            <span aria-hidden>{initials(name, email)}</span>
          )}
          {/* Always visible, not hover-revealed: there is no hover on a phone, and this is
              the only thing saying the avatar is a control rather than a picture. */}
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-foreground/45 py-0.5 text-primary-foreground transition-colors group-hover:bg-foreground/70">
            <Camera className="size-3" strokeWidth={2.5} aria-hidden />
          </span>
        </button>

        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor="my-name" className="sr-only">
            Your display name
          </label>
          {/* Borderless until touched, so the card reads as a profile header rather than a form —
              but the pencil stays put. Without it the name is indistinguishable from static text,
              and a phone has no hover to reveal the box. */}
          <div className="relative">
            <input
              id="my-name"
              type="text"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              onBlur={() => void commitName()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder="Your name"
              className="ui-title w-full rounded-md border border-transparent bg-transparent py-1 pl-2 pr-8 text-[15px] text-foreground outline-none transition-colors hover:border-border focus:border-border focus:bg-card"
            />
            <Pencil
              className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint"
              strokeWidth={2.25}
              aria-hidden
            />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 px-2 text-xs text-muted-foreground">
            <span className="truncate">{email || "—"}</span>
            <SaveNote state={savingName} />
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
          onClick={() => void signOut({ callbackUrl: "/login" })}
        >
          Sign out
        </button>
        {image ? (
          <button
            type="button"
            disabled={busy !== null}
            className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            onClick={() => void onRemovePhoto()}
          >
            {busy === "remove" ? "Removing…" : "Remove photo"}
          </button>
        ) : null}
        {busy === "upload" ? (
          <span className="ui-caption text-muted-foreground">Uploading…</span>
        ) : null}
        {error ? (
          <span className="ui-caption text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPick(e)}
      />
    </CardPanel>
  );
}
