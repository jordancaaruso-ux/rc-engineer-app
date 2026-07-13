import type { ReactNode } from "react";
import { RollCenterLabClient } from "@/components/rollCenter/RollCenterLabClient";

/**
 * Roll Center Lab — interactive what-if geometry (docs/ROLL_CENTER_NORTH_STAR.md
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

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Roll Center Lab</h1>
          <p className="page-subtitle">
            Move shims, watch the roll center. Load any run or downloaded setup to see its geometry.
          </p>
        </div>
      </header>
      <section className="page-body max-w-2xl">
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
