import type { ReactNode } from "react";
import { RollCenterLabClient } from "@/components/rollCenter/RollCenterLabClient";

/**
 * Roll Center Lab — interactive what-if geometry (docs/ROLL_CENTER_NORTH_STAR.md
 * Phase 3). Purely client-side: seeds from the `s` URL param (a sheet's geometry
 * slice, base64url), `g` seeds a ghost overlay. No server data.
 */
export default async function RollCenterLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const seed = typeof sp.s === "string" && sp.s.length > 0 ? sp.s : null;
  const ghostSeed = typeof sp.g === "string" && sp.g.length > 0 ? sp.g : null;

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Roll Center Lab</h1>
          <p className="page-subtitle">
            Move shims, watch the roll center. Deltas are exact; try it, then log it.
          </p>
        </div>
      </header>
      <section className="page-body max-w-2xl">
        <RollCenterLabClient seed={seed} ghostSeed={ghostSeed} />
      </section>
    </>
  );
}
