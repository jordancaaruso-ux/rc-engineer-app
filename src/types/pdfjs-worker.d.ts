/**
 * pdf.js ships types for its API build but not for the worker build, which we import directly on
 * the server so this copy of pdf.js can be bound to ITS OWN worker — see `loadPdfjs` in
 * `src/lib/lapUrlParsers/myRcmPdfText.ts`. The module's only export is the handler; importing it
 * also assigns `globalThis.pdfjsWorker` as a side effect.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
