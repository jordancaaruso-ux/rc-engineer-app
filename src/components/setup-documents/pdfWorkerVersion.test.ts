import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * There must be exactly ONE `pdfjs-dist` in the browser's half of the tree.
 *
 * `PdfPreviewClient.tsx` builds the worker URL from a bare specifier resolved next to itself, which
 * finds the hoisted top-level `pdfjs-dist`. The pdf.js *library* it drives comes from `react-pdf`,
 * which pins `pdfjs-dist` to an exact version. If npm nests a second copy because our range floated
 * past that pin, pdf.js refuses to render anything — "The API version X does not match the Worker
 * version Y" — and every driver looking at a setup sheet sees "Failed to load PDF file.", which
 * reads like their upload is broken. Nothing else in the repo catches it: it typechecks, it builds,
 * and it only shows up in a browser.
 *
 * Fix when this fails: set `pdfjs-dist` in package.json to the EXACT version printed below, then
 * `npm install`.
 */
const require = createRequire(import.meta.url);

function versionResolvedFrom(fromDir: string): string {
  const pkgPath = require.resolve("pdfjs-dist/package.json", { paths: [fromDir] });
  return require(pkgPath).version as string;
}

test("the pdf.js worker and the pdf.js library are the same copy", () => {
  // What the bundler hands the worker URL: resolved from PdfPreviewClient's directory, which is
  // this test file's directory.
  const workerVersion = versionResolvedFrom(path.dirname(fileURLToPath(import.meta.url)));

  // What react-pdf actually runs in the browser.
  const reactPdfDir = path.dirname(require.resolve("react-pdf/package.json"));
  const libraryVersion = versionResolvedFrom(reactPdfDir);

  assert.equal(
    workerVersion,
    libraryVersion,
    `pdfjs-dist is installed twice: worker ${workerVersion}, react-pdf's library ${libraryVersion}. ` +
      `Pin "pdfjs-dist" in package.json to exactly "${libraryVersion}" and re-run npm install.`
  );
});

test("our pdfjs-dist pin matches the version react-pdf depends on", () => {
  const declared = (require("react-pdf/package.json").dependencies as Record<string, string>)["pdfjs-dist"];
  const ours = (require("../../../package.json").dependencies as Record<string, string>)["pdfjs-dist"];
  assert.equal(
    ours,
    declared,
    `package.json pins pdfjs-dist "${ours}" but react-pdf depends on "${declared}". ` +
      `A range that floats past react-pdf's pin gives npm a reason to install a second copy.`
  );
});
