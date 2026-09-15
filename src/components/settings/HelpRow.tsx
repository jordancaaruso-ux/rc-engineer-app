import { PRODUCT_NAME } from "@/lib/brand/brandNames";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal/legalMeta";

/**
 * The one way to reach a human from inside the app.
 *
 * Until 2026-09-09 the only contact link lived on the privacy and terms pages — a paying
 * driver whose sign-in email never arrived, or whose run would not save, had nowhere to tap.
 * One quiet line at the foot of Settings, beside the other account-level action; the subject
 * is pre-filled so a one-word email still says which product it is about.
 */
export function HelpRow() {
  const subject = encodeURIComponent(`${PRODUCT_NAME} — something's wrong`);
  return (
    <div className="mt-10 border-t border-border pt-5">
      <a
        href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=${subject}`}
        className="text-xs font-medium text-foreground underline underline-offset-2 hover:opacity-80"
      >
        Something wrong? Email Jordan
      </a>
    </div>
  );
}
