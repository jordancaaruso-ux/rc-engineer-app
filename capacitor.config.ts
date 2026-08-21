import type { CapacitorConfig } from "@capacitor/cli";

/**
 * iOS shell loads the hosted Next.js app (Vercel). Set CAPACITOR_SERVER_URL to your
 * production or preview origin before `npx cap sync ios`.
 *
 * Local device testing against dev server (same LAN):
 *   CAPACITOR_SERVER_URL=http://192.168.x.x:3000 npx cap sync ios
 * (iOS may require `cleartext: true` for http — we set it automatically for non-https URLs.)
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.rcengineer.app",
  // Keep in sync with PRODUCT_NAME in src/lib/brand/brandNames.ts — the Capacitor CLI reads
  // this outside the app's module graph, so it cannot import the constant. Changing it renames
  // the installed native app on the device home screen.
  appName: "JRC Trackside",
  webDir: "capacitor-www",
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith("http://"),
      }
    : undefined,
  ios: {
    /**
     * `automatic` insets the WKWebView scroll view so the first paint often shows
     * native chrome above the page; scrolling then reveals the document background
     * under the island. `never` keeps the web layer edge-to-edge; we pad with
     * `env(safe-area-inset-top)` in CSS (see `.page` and the mobile menu button).
     */
    contentInset: "never",
    /** Match the page background (ash paper) so rubber-band overscroll is not a dark band. */
    backgroundColor: "#EAE7E0",
  },
  plugins: {
    /**
     * The native splash HOLDS until the web app says it is ready (2026-08-19).
     *
     * It was `launchShowDuration: 0` — hide immediately — which uncovered the web
     * view while it was still fetching the hosted app, so the launch read as JRC →
     * a flash of a half-built app → the web TRACKSIDE splash → the app. `PwaSplashDismiss`
     * now calls `SplashScreen.hide()` on the same readiness signal (window load +
     * fonts), and the web splash is suppressed in the shell entirely, so there is one
     * splash from the icon tap to the dashboard.
     *
     * `launchAutoHide` stays TRUE deliberately: it is the backstop. If the app never
     * loads — no signal, dead network, JS that never runs — the duration below still
     * ends it. A splash with no way out is worse than a blank screen.
     */
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 4000,
      launchFadeOutDuration: 220,
      backgroundColor: "#EAE7E0",
    },
  },
};

export default config;
