import type { ReactNode } from "react";
import { headers } from "next/headers";

/**
 * Warn when AUTH_URL points at another host (e.g. Vercel) while the app is opened on localhost —
 * magic links and callbacks will use AUTH_URL, which feels like "localhost sends me to Vercel".
 */
export default async function LoginLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").trim();
  const authRaw = process.env.AUTH_URL?.trim();

  let mismatchBanner: string | null = null;
  if (authRaw && host) {
    try {
      const authOrigin = new URL(authRaw);
      if (authOrigin.host !== host) {
        mismatchBanner = `You are on ${host}, but AUTH_URL is ${authOrigin.origin}. Magic links and sign-in callbacks use AUTH_URL, so you will be sent to that site. For local development, set AUTH_URL=http://${host} in .env.local (use https only if your dev server uses TLS), then restart npm run dev and request a new link.`;
      }
    } catch {
      mismatchBanner =
        "AUTH_URL is set but could not be parsed. Fix it in .env.local so it matches the URL you use in the browser.";
    }
  }

  return (
    <>
      {mismatchBanner ? (
        <div
          className="mx-auto max-w-lg px-4 pt-6 text-left text-sm text-foreground"
          role="status"
        >
          <div className="rounded-lg border border-primary/50 bg-primary/10 px-4 py-3">
            <p className="font-semibold text-primary">Auth URL mismatch</p>
            <p className="mt-2 text-muted-foreground">{mismatchBanner}</p>
          </div>
        </div>
      ) : null}
      {children}
    </>
  );
}
