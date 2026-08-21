import type { ReactNode } from "react";
import { RollCenterLabClient } from "@/components/rollCenter/RollCenterLabClient";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { LAB_BACK_PARAM, safeLabBackHref } from "@/lib/rollCenter/labReturn";

/**
 * Geometry Lab — interactive what-if geometry (docs/ROLL_CENTER_NORTH_STAR.md
 * Phase 3). Purely client-side: seeds from the `s` URL param (a sheet's geometry
 * slice, base64url) into slot A, `g` into slot B; `sl`/`gl` carry optional
 * display labels for the slots. No server data.
 */
export default async function RollCenterLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined, max = 4096): string | null =>
    typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
  const seed = str(sp.s);
  const ghostSeed = str(sp.g);
  const seedLabel = str(sp.sl, 60);
  const ghostSeedLabel = str(sp.gl, 60);
  /*
    Where the arrow goes — the sender's page, or Tools (see `labReturn.ts`). The Lab is two taps
    deep from wherever you were and had no way out at all until 2026-08-19: the fixed mobile pill
    stayed the JRC mark, which is the dashboard, so leaving meant abandoning the trip.

    Read on the SERVER and rendered as a real href, which is what lets `PageBackLink` hand it to
    the mobile chrome (`MobileBackContext`) — the pill becomes the arrow, and the header's own
    copy hides itself on the phone so there aren't two. `syncUrl` in the Lab client rewrites only
    `s`/`g`/`sl`/`gl`, and by `replaceState`, so this stays put while you load setups into slots.
  */
  const backHref = safeLabBackHref(sp[LAB_BACK_PARAM]);

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href={backHref} />
          <div className="min-w-0">
            <h1 className="page-title">Geometry Lab</h1>
            <p className="page-subtitle">
              Move shims, watch the roll center. Load any run or downloaded setup to see its
              geometry.
            </p>
          </div>
        </div>
      </header>
      {/* `lab-wide` raises the cap to 1760px at xl+ (globals.css); `max-w-2xl`
          still governs below that, so the phone column is untouched. */}
      <section className="page-body lab-wide max-w-2xl">
        <RollCenterLabClient
          seed={seed}
          seedLabel={seedLabel}
          ghostSeed={ghostSeed}
          ghostSeedLabel={ghostSeedLabel}
        />
      </section>
    </>
  );
}
