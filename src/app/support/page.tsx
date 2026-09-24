import Link from "next/link";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal/legalMeta";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";

export const metadata = {
  title: `Support — ${PRODUCT_NAME}`,
  description: `Help with ${PRODUCT_NAME}`,
};

/**
 * The App Store listing's "App Support" address: Apple requires one that reaches a person
 * (2026-09-24). Public, like /privacy and /terms, and laid out the same way.
 */
export default function SupportPage() {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-foreground">
      <h1 className="page-title">Support</h1>
      <p className="mt-4 text-muted-foreground">
        Questions, problems or ideas: email{" "}
        <a className="underline underline-offset-4" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
          {LEGAL_CONTACT_EMAIL}
        </a>
        .
      </p>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Deleting your account</h2>
        <p className="mt-2 text-muted-foreground">
          <span className="text-foreground">Settings → Delete account</span> removes your account,
          your runs, setups and uploads, and cancels your plan. It can&apos;t be undone.
        </p>
      </section>

      <p className="mt-10 text-muted-foreground">
        <Link className="underline underline-offset-4" href="/privacy">
          Privacy policy
        </Link>
        {" · "}
        <Link className="underline underline-offset-4" href="/terms">
          Terms
        </Link>
      </p>
    </div>
  );
}
