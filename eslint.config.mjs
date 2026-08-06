import { createRequire } from "module";

const require = createRequire(import.meta.url);
/** @type {import("eslint").Linter.Config[]} */
const nextConfig = require("eslint-config-next");

const config = [
  {
    // The landing page is a built artifact served verbatim from `public/landing/` (see the
    // `/welcome` rewrite in next.config.mjs) — bundled React output, not source we author.
    // Linting it reports on its bundler's choices (`ReactDOM.render`, a `module` assignment),
    // none of which we can act on without hand-editing a generated file.
    ignores: ["public/landing/**"],
  },
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
