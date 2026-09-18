import { createRequire } from "module";

const require = createRequire(import.meta.url);
/** @type {import("eslint").Linter.Config[]} */
const nextConfig = require("eslint-config-next");

const config = [
  {
    /*
     * Generated output and other checkouts — never source we author.
     *
     * `public/landing/**` is the landing page, a built artifact served verbatim (see the
     * `/welcome` rewrite in next.config.mjs). Linting it reports on its bundler's choices
     * (`ReactDOM.render`, a `module` assignment), none of which we can act on without
     * hand-editing a generated file.
     *
     * `.next/**` and `.claude/worktrees/**` are the reason `npm run lint` took minutes and
     * reported 1627 errors while `src/` had 23 (2026-09-18). ESLint lints the whole folder and
     * does NOT read `.gitignore`, so every parallel session's worktree build was being linted
     * as hand-written code — 14 GB of compiled bundles across three of them. A lint that cannot
     * usefully fail is worse than no lint.
     */
    ignores: [
      "public/landing/**",
      "**/.next/**",
      ".claude/worktrees/**",
      "**/node_modules/**",
    ],
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
