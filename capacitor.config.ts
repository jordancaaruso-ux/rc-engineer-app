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
  appName: "RC Engineer",
  webDir: "capacitor-www",
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith("http://"),
      }
    : undefined,
  ios: {
    contentInset: "automatic",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
