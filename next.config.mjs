/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Belt-and-suspenders: never trace dev PDF folders into serverless bundles (production uses Blob).
  outputFileTracingExcludes: {
    "*": ["./public/uploads/**/*", "./.local-uploads/**/*"],
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

