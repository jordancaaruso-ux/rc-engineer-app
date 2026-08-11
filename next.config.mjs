/**
 * pdfjs-dist loads its Node canvas with a bare `require("@napi-rs/canvas")` inside a try/catch, and
 * that package hands off again to a per-platform binary package. Neither hop is a static import, so
 * the file tracer never sees them and they don't reach the lambda — pdfjs then falls back to "cannot
 * polyfill DOMMatrix" and importing the module throws. The platform glob is deliberately wide: only
 * the build machine's own platform package is ever installed, so it resolves to one directory.
 *
 * The standard fonts are read by path at runtime too (see `pdfServerRaster.standardFontDataUrl`).
 */
const RASTER_NATIVE_FILES = [
  "./node_modules/@napi-rs/canvas/**/*",
  "./node_modules/@napi-rs/canvas-*/**/*",
  "./node_modules/pdfjs-dist/standard_fonts/**/*",
  // `pdf-to-img` pins its OWN pdfjs-dist (nested, a different version to the top-level one) and
  // starts it "workerless" — which still `import()`s `legacy/build/pdf.worker.mjs` by computed
  // path at runtime. A dynamic import of a computed path is invisible to the file tracer, so the
  // worker never reached the lambda and every raster died on "Setting up fake worker failed:
  // Cannot find module …/pdf.worker.mjs" (prod 2026-08-11: an X4'25 sheet with 271 good boxes and
  // no picture behind them). The whole nested package, because pdfjs resolves siblings off it.
  "./node_modules/pdf-to-img/node_modules/**/*",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // LAN dev origin (phone testing + headless verification drive the app via this
  // IP). Next 16 blocks cross-origin /_next/* dev requests from unlisted origins,
  // which silently kills hydration — pages render but nothing is clickable.
  allowedDevOrigins: ["192.168.1.112", "192.168.50.248", "192.168.50.91"],
  // onnxruntime-node ships a native .node binary; keep it external so webpack doesn't try to
  // bundle it (local PP-OCR text reader, src/lib/setupCalibrations/localOcr.ts).
  // @napi-rs/canvas (pdfjs-dist's Node canvas) + pdf-to-img rasterize flattened-PDF setup sheets
  // server-side (src/lib/setupDocuments/pdfServerRaster.ts); @napi-rs/canvas also ships a native
  // .node binary and must stay external for its loader to resolve the platform package at runtime.
  // pdfjs-dist stays external so pdfServerRaster's runtime require.resolve("pdfjs-dist/package.json")
  // (used to locate standard_fonts) works in the serverless bundle.
  serverExternalPackages: ["onnxruntime-node", "@napi-rs/canvas", "pdf-to-img", "pdfjs-dist"],
  // Belt-and-suspenders: never trace dev PDF folders into serverless bundles (production uses Blob).
  outputFileTracingExcludes: {
    "*": ["./public/uploads/**/*", "./.local-uploads/**/*"],
  },
  // The PP-OCR recognition model + dict are read at runtime by path (not import), so the tracer
  // can't see them — include them explicitly in the setup-document functions that run extraction.
  outputFileTracingIncludes: {
    // PP-OCR models + pdfjs standard fonts are read at runtime by path (not import), so the tracer
    // can't see them — include them in the setup-document functions that rasterize/extract.
    "/api/setup-documents/**": [
      "./src/lib/setupCalibrations/models/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      ...RASTER_NATIVE_FILES,
    ],
    // Every other function that rasterizes a PDF page. Blank upload (`/blank`) and the sheet
    // picture (`/[id]/sheet-page`) are the driver-facing ones; derive-image-map is the
    // calibration workbench. Prod 2026-08-11: `/blank` 500'd on `DOMMatrix is not defined`,
    // which is what pdfjs reports when its canvas is missing from the bundle.
    "/api/setup-sheet-models/**": RASTER_NATIVE_FILES,
    "/api/setup-calibrations/**": RASTER_NATIVE_FILES,
    "/api/debug/**": RASTER_NATIVE_FILES,
  },
  // The landing page is the Claude Design artifact served verbatim from `public/landing/` —
  // founder call 2026-08-06, to keep the design exact rather than re-implement its scroll
  // reveals, video scrubber and card deck in React. `beforeFiles` is required: it runs ahead of
  // filesystem routes, which is the only way this wins over `src/app/welcome/page.tsx` (kept in
  // the tree, now unreachable — delete that file, or this rewrite, but never neither).
  //
  // Trade-off accepted with it: prices in that HTML are literals ($14.99/$27.99/$149.90/
  // $279.90), not Stripe reads. They match the live account today. If a price moves, it moves
  // in Stripe AND in public/landing/index.html.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/welcome", destination: "/landing/index.html" }],
    };
  },
  experimental: {
    // Reuse a recently-fetched RSC payload from the client Router Cache instead of
    // re-fetching every navigation (default is 0 for dynamic routes → grey re-flash
    // on every revisit). Renders cached content instantly, revalidates in background.
    staleTimes: { dynamic: 30, static: 180 },
    // Tree-shake barrel icon imports (Phosphor is on the always-loaded shell path via
    // BottomNav/LogRunFab/AccountMenu; Lucide is imported by ~36 files).
    optimizePackageImports: ["@phosphor-icons/react", "lucide-react"],
  },
};

export default nextConfig;

