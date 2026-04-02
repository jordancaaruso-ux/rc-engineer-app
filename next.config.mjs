/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Belt-and-suspenders: never trace dev PDF folders into serverless bundles (production uses Blob).
  outputFileTracingExcludes: {
    "*": ["./public/uploads/**/*", "./.local-uploads/**/*"],
  },
};

export default nextConfig;

