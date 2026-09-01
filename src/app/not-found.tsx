import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/ButtonLink";

/**
 * The app's 404 — one page for every way of not finding something.
 *
 * There was none at all until 2026-08-24, so a deleted run, a link a driver may not open, or a
 * bookmark that outlived its row all served Next's built-in developer default ("404 — This page
 * could not be found.") on bare paper, with the dock as the only way out.
 *
 * ============================== ONE PAGE, AND ALMOST NO WORDS ==============================
 *
 * The first build was a card with a headline, a paragraph and two doors, and a second copy of it
 * under `runs/[id]/` naming the noun. Founder call, same day: too much text, and it should sit in
 * the middle of the screen. Both were deleted for this. A dead end is not a place to explain
 * things — the driver needs to know it is not their fault and get out.
 *
 * ============================== WHY THE ONE LINE HEDGES ==============================
 *
 * `runs/[id]/page.tsx` calls `notFound()` twice — once for a row that is gone, once when
 * `viewerMayAccessRun` says no. The second is deliberate: refusing with a 403 would let a stranger
 * prove a run exists by being refused it. So the line has to cover both endings without claiming
 * either. Do not sharpen it into a definite statement; it would lie half the time, or give away
 * the thing the 404 exists to protect.
 *
 * Centring: `.page` is `flex flex-1 flex-col` and 100dvh on the phone, so `flex-1` fills it. The
 * `min-h` is for the desktop, where `.page` drops to `min-height: 0` and flex has nothing to fill.
 */
export default function NotFound(): ReactNode {
  return (
    <section className="flex min-h-[70svh] flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold text-foreground">Page not available</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        It may have been deleted, or it isn’t shared with you.
      </p>
      <ButtonLink href="/" className="mt-1">
        Go to dashboard
      </ButtonLink>
    </section>
  );
}
