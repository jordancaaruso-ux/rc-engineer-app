/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // LAN dev origin (phone testing + headless verification drive the app via this
  // IP). Next 16 blocks cross-origin /_next/* dev requests from unlisted origins,
  // which silently kills hydration — pages render but nothing is clickable.
  allowedDevOrigins: ["192.168.1.112", "192.168.50.248"],
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
    ],
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

