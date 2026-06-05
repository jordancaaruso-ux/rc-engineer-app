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
  appName: "JRC Race Engineer",
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
    /** Match `--color-background` so rubber-band overscroll is not true black. */
    backgroundColor: "#0c0c0e",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
