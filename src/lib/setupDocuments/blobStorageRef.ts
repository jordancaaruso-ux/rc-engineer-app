type BlobEnv = { BLOB_READ_WRITE_TOKEN?: string };

/** Store id embedded in the read-write token (`vercel_blob_rw_<ID>_…`); hostnames use it lowercased. */
function ownBlobStoreId(env: BlobEnv = process.env as BlobEnv): string | null {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) return null;
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token);
  return m ? m[1].toLowerCase() : null;
}

/**
 * True when `url` is a setup-sheet upload in OUR Blob store, under the `setup-documents/` prefix the
 * client-upload token route allows. Browsers hand this URL to the server after uploading straight
 * to Blob, so it is the only thing standing between a request body and a server-side download.
 *
 * Until the 2026-09-24 launch audit any `*.blob.vercel-storage.com` host passed: a caller could
 * point the server at a file of any size in some other store, and it was read whole into memory.
 */
export function isAllowedSetupDocumentBlobUrl(
  url: string,
  env: BlobEnv = process.env as BlobEnv
): boolean {
  const storeId = ownBlobStoreId(env);
  if (!storeId) return false;
  try {
    const u = new URL(url.trim());
    return (
      u.protocol === "https:" &&
      (u.hostname === `${storeId}.private.blob.vercel-storage.com` ||
        u.hostname === `${storeId}.public.blob.vercel-storage.com`) &&
      u.pathname.startsWith("/setup-documents/")
    );
  } catch {
    return false;
  }
}
