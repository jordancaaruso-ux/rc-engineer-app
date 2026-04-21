import { createRequire } from "module";

const require = createRequire(import.meta.url);
/** @type {import("eslint").Linter.Config[]} */
const nextConfig = require("eslint-config-next");

const config = [
  ...nextConfig,
  {
    rules: {
      // React 19 / Compiler rules are stricter than patterns used across this app; keep lint usable without blocking builds.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  {
    files: ["src/lib/setupDocuments/storage.ts"],
    rules: {
      // `useBlobStorage` is a module helper name, not a React hook.
      "react-hooks/rules-of-hooks": "off",
    },
  },
];

export default config;
