import type { MetadataRoute } from "next";

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
    name: "JRC Race Engineer",
    short_name: "JRC",
    description:
      "Track runs, setups, and engineering-style guidance for competitive RC drivers.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Charcoal graphite base (matches `--page-top-theme` / viewport themeColor) so the
    // Android splash + status chrome never flash off-palette.
    background_color: "#121110",
    theme_color: "#121110",
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
