/** App max for setup sheet PDFs/images (see SETUP_DOCUMENT_MAX_BYTES). */
export { SETUP_DOCUMENT_MAX_BYTES } from "@/lib/setupDocuments/types";

/**
 * Vercel serverless request bodies are capped at ~4.5MB. Multipart uploads above this
 * return HTTP 413 before the route handler runs — use client Blob upload instead.
 */
export const SETUP_UPLOAD_SERVERLESS_SAFE_BYTES = 4 * 1024 * 1024;
