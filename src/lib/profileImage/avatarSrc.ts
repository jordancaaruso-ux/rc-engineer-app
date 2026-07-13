/**
 * Client-safe resolver from a `user.image` value to a directly-loadable `<img src>`.
 *
 * Our own uploaded avatars live in a **private** Vercel Blob store, so their
 * `*.blob.vercel-storage.com` URLs can't be fetched by the browser without the store
 * token — they're streamed back through the authenticated self-proxy at
 * `GET /api/profile-image` (same-origin, cookie-auth'd). External provider avatars
 * (e.g. Google) and local-dev `/uploads/...` paths load as-is.
 *
 * Keep this module free of `server-only` imports — it's used in client components.
 */

/** True for a private Vercel Blob avatar URL that must be proxied, not loaded directly. */
export function isPrivateAvatarBlobUrl(image: string | null | undefined): boolean {
  return Boolean(image && image.includes(".blob.vercel-storage.com"));
}

/** Stable non-crypto hash so the proxy src changes when the avatar changes (cache-bust). */
function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Resolve `user.image` to an `<img src>`; returns null when there's no image. */
export function avatarSrc(image: string | null | undefined): string | null {
  if (!image) return null;
  if (isPrivateAvatarBlobUrl(image)) return `/api/profile-image?v=${hash(image)}`;
  return image;
}
