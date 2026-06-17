/** True when `storagePath` is a private Vercel Blob URL under our setup-documents prefix. */
export function isAllowedSetupDocumentBlobUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return (
      u.protocol === "https:" &&
      u.hostname.endsWith(".blob.vercel-storage.com") &&
      u.pathname.includes("/setup-documents/")
    );
  } catch {
    return false;
  }
}
