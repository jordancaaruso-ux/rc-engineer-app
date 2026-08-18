import type { MetadataRoute } from "next";

import { PRODUCT_NAME } from "@/lib/brand/brandNames";

/**
 * PWA web app manifest. Next serves this at `/manifest.webmanifest` and auto-injects
 * `<link rel="manifest">`, so no manual head wiring is needed.
 *
 * NOTE: iOS ignores these `icons` for the home-screen tile — it uses `apple-touch-icon`
 * (wired via `metadata.icons.apple` in `layout.tsx`). The icons here are for Android /
 * desktop installs and the install-prompt preview. Icon PNGs live in `public/icons/`
 * (see `docs/PWA_NORTH_STAR.md` for the required sizes — drop the art in when ready).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    // Deliberately the house brand, not the product name: the home-screen label truncates
    // around 12 characters, and "JRC" survives the next rename untouched while the product
    // name is still provisional.
    short_name: "JRC",
    description:
      "Track runs, setups, and engineering-style guidance for competitive RC drivers.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // FOUNDER DECISION PENDING (raised 2026-08-07 during the desktop pass): this letterboxes a
    // desktop PWA install into a phone-shaped portrait window, so the desktop layouts never appear
    // for anyone who installs the app. The fix is `"any"`, but a manifest has no media queries —
    // it is one value for every device, so relaxing it ALSO lets a phone rotate into landscape,
    // where the >=768px breakpoints would swap the bottom dock for the desktop sidebar mid-race.
    // That is a product call about the trackside experience, not a layout fix, so it stays as-is.
    orientation: "portrait",
    // Ash paper — the one app background (matches `--page-bg-rgb` under
    // `[data-theme="light"]` in globals.css / viewport themeColor) so the Android splash
    // + status chrome never flash off-palette. Was charcoal until 2026-08-18, when light
    // stopped being a per-device choice and became the app; a manifest has no media
    // queries, so it could not follow the old cookie and always flashed the wrong colour.
    background_color: "#EAE7E0",
    theme_color: "#EAE7E0",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
