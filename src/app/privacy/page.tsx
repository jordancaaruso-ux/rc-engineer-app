export const metadata = {
  title: "Privacy — JRC Race Engineer",
  description: "Privacy policy for JRC Race Engineer",
};

export default function PrivacyPage() {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-foreground">
      <h1 className="text-xl font-semibold">Privacy policy</h1>
      <p className="mt-4 text-muted-foreground">
        JRC Race Engineer is a personal motorsports setup and run logging tool. This page summarizes what the hosted
        service processes so you can complete App Store Connect disclosures.
      </p>
      <h2 className="mt-8 text-base font-semibold">Account and authentication</h2>
      <p className="mt-2 text-muted-foreground">
        Sign-in uses email magic links. Your email address is stored to identify your account. Session cookies keep you
        signed in on devices you use.
      </p>
      <h2 className="mt-8 text-base font-semibold">Data you store</h2>
      <p className="mt-2 text-muted-foreground">
        You may upload setup sheets (PDFs), run notes, lap imports, and related metadata. This content is tied to your
        account and used only to provide the app&apos;s features to you.
      </p>
      <h2 className="mt-8 text-base font-semibold">Third-party services</h2>
      <p className="mt-2 text-muted-foreground">
        The production deployment uses a managed database, file storage for uploads, and HTTPS. If you use AI-assisted
        features, prompts and context may be sent to the configured model provider as described in the app.
      </p>
      <h2 className="mt-8 text-base font-semibold">Contact</h2>
      <p className="mt-2 text-muted-foreground">
        For privacy questions or account deletion, use the in-app account settings or contact the operator of your
        deployment.
      </p>
      <p className="mt-10 text-xs text-muted-foreground">Last updated April 2026.</p>
    </div>
  );
}
