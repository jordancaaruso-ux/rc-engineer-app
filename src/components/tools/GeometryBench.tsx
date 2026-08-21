import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { BandHeader } from "@/components/ui/BandHeader";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { AxleSchematic } from "@/components/rollCenter/AxleSchematic";
import type { ToolsGeometry } from "@/lib/tools/toolsModel";

/**
 * The top of Tools: where the car you last ran actually sits.
 *
 * This band is why the page can be a destination at all. The Lab is a blank calculator — you
 * arrive and have to feed it a setup before it says anything — and for the question a driver
 * has at a pit table ("where am I now?") the numbers ARE the answer. Nothing needs opening.
 *
 * `+0.6` on the rake and a bare `−9.1` on the heights, matching `fmtMm` on the sheet strip:
 * a rake is a direction and its sign is the whole reading, while a roll centre below ground is
 * the ordinary case and a `−` in front of it is just where it sits.
 *
 * ── The car leads, 2026-08-19 ────────────────────────────────────────────────────────────────
 * Founder call: the three stat tiles became the front-view drawing with the numbers on one line
 * under it. The tiles answered the question and gave nobody a reason to open the Lab; the picture
 * is the invitation. What the picture is NOT is a readout — measured on a real solve, 1.5mm of
 * shim under both lower arms (a bigger change than most drivers make at once) moves the marker
 * about five pixels at card width. Two ordinary setups draw the same car. That is exactly why the
 * numbers stayed, and why "drawing only" was the option that lost.
 *
 * Nothing here is Space Grotesk. The display face is `.page-title` only (VISUAL_NORTH_STAR), so
 * the car name is Sora 700 at hero size — the same voice as the Paddock hero it sits level with.
 *
 * ── It is called the Geometry Lab, 2026-08-19 ────────────────────────────────────────────────
 * Founder call from a `.markup` pin on `/tools`. Video carried a band label and this one did not,
 * so the words "Geometry Lab" appeared nowhere on the page that leads to it — the card opened with
 * "Your car" and closed with a button reading "Open the lab", and you had to already know what the
 * lab was to connect the two. The label names the bench; "Your car" underneath still says whose
 * numbers these are. No `+` here: geometry is computed from the car you already own, so there is
 * nothing on this band to add.
 */
export function GeometryBench({ geometry }: { geometry: ToolsGeometry }) {
  const rc = geometry.rollCentre;

  return (
    <SurfaceCard variant="hero" contentClassName="p-0" className="rounded-2xl">
      <BandHeader label="Geometry Lab" />

      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <p className="micro-caps text-primary-ink">Your car</p>
          <p className="ui-title mt-1.5 truncate text-[19px] font-bold leading-tight tracking-tight text-foreground">
            {geometry.carName}
          </p>
          {geometry.chassisName ? (
            <p className="micro-caps mt-0.5 truncate text-faint">{geometry.chassisName}</p>
          ) : null}
        </div>
        {rc ? (
          /* Which setup the numbers came from. Without it the strip is three figures with no
             provenance, and a driver who changed the car since that run would read them as now. */
          <span className="type-timestamp min-w-0 shrink truncate text-right">
            {rc.sourceLabel}
          </span>
        ) : null}
      </div>

      {rc ? (
        <>
          {/*
            The car, at the top of the card.

            `AxleSchematic` is a client component and this band is a server one, which is fine and
            deliberate: the solve happens in `loadToolsModel` and only its solved points cross the
            boundary, so the drawing arrives in the first HTML with no data fetch of its own. It
            is the SAME component the Lab and every A800RR sheet draw, from the same solve that
            produced the three numbers underneath — so tapping through to the Lab lands on the
            picture you were just looking at, larger.

            No `fitBox`: the Lab pins the drawing in a fixed-aspect box because roll and bump
            change the pose live and a resizing car would reflow the page under a moving finger.
            Nothing moves here, so the schematic keeps its own 12:5-ish height off the extents and
            the card is exactly as tall as the drawing needs.
          */}
          {/*
            Capped, and left on the same axis as everything else in the card.

            The schematic is `w-full` on a 360-unit viewBox, so its annotation type scales with
            it: at the full width of this card on a 1440 desktop it rendered ~1100px across, which
            put "ride 5.0mm" at 28px and ran it into the "RC" label. 460 keeps the arm angles near
            the ~9px they are on a phone — the size the drawing was drawn for. It costs an empty
            right half on a wide screen, which is the same shape the Video band below already has.
          */}
          <div className="px-3 pb-1 pt-2.5">
            <div className="max-w-[460px]">
              <AxleSchematic
                solved={rc.frontSolve}
                chassis={rc.frontPlate}
                axleLabel="front"
                className="text-foreground"
              />
            </div>
          </div>

          {/*
            One line, not three tiles (founder pick "A", 2026-08-19).

            The drawing already writes the front roll centre beside its own marker, so this row
            exists for the two readings it can't carry: the rear height, and the rake that is the
            difference between them. Dropping it — the pure-picture option — turned the one band
            on this page that answers a pit-table question without a tap into a poster.

            The front number is deliberately repeated here rather than left to the drawing alone:
            it reads as a set with the other two, and a line that skipped from "Rear" to "Rake"
            would ask the driver to go find the third value in the picture.
          */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 pb-2.5">
            <Reading label="Front" value={mm(rc.frontMm)} />
            <Reading label="Rear" value={mm(rc.rearMm)} />
            <Reading label="Rake" value={signedMm(rc.rakeMm)} accent />
          </div>
          {/*
            Two doors, and the yellow one is still the car's.

            The rake sentence used to sit at the left of this row (founder pin, 2026-08-19: cut
            it). The signed Rake tile above already says which way the axis tips, so the words
            were the same fact twice — and on a 390px phone they truncated to "Roll axis rakes
            do…" while crowding the two doors. The row is only the doors now.
          */}
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-4 py-2.5">
            {/*
              The blank calculator (founder pin, 2026-08-19). Every door into the Lab carried a
              setup with it except the two empty-state links, which only a driver with no car or
              no geometry pack ever sees — so the one person who wanted the bare calculator was
              the one person who couldn't reach it. "Blank car" is the Lab's own name for the
              slot you land in, not a description of it.
            */}
            <ButtonLink href="/analysis/roll-center" variant="outline">
              Blank car
            </ButtonLink>
            {/* Says what the yellow door does: it carries THIS car's setup into the Lab with you. */}
            <ButtonLink href={rc.labHref}>Open this setup</ButtonLink>
          </div>
        </>
      ) : (
        <>
          {/*
            No numbers, said plainly.

            Only one roll-centre pack exists (Awesomatix A800R/RR), because hardpoints have to be
            measured per chassis before the calculator can say anything true about one. Sniffing
            the sheet's field names would produce a readout — and it would be another car's
            geometry wearing this car's name, which is the single failure this app refuses. So
            the band says why it is empty and still opens the door.
          */}
          <p className="px-4 pb-1 pt-2.5 text-[13px] leading-relaxed text-muted-foreground">
            {geometry.reason === "no-setup"
              ? "This car's latest setup doesn't fill in enough of the suspension to solve. The Lab still opens, and you can move the shims by hand."
              : "No geometry model for this chassis yet — those get measured one car at a time. The Lab still opens, and you can load any setup into it."}
          </p>
          {/*
            One door here, not two. It goes to the same blank calculator the "Blank car" chip
            does above — but there is no second, setup-carrying door to tell it apart from, so it
            keeps the lab's own name and takes the yellow: the only action on a band is never a
            quiet one.
          */}
          <div className="mt-2 flex items-center justify-end border-t border-border bg-muted/40 px-4 py-2.5">
            <ButtonLink href="/analysis/roll-center">Open the lab</ButtonLink>
          </div>
        </>
      )}
    </SurfaceCard>
  );
}

/**
 * One reading on the line under the drawing: a faint micro-label and its figure, on one baseline.
 *
 * `.fig-stat`, not `.fig-tile`. The drawing is the loud object on this card now — the numbers are
 * the caption that keeps it honest, and at tile size they competed with it for the same glance.
 */
function Reading({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="micro-caps text-faint">{label}</span>
      <span className={`fig-stat ${accent ? "font-semibold text-primary-ink" : "text-foreground"}`}>
        {value}
      </span>
    </span>
  );
}

/** A roll-centre height: unsigned on paper, because below ground is the ordinary place for it. */
function mm(v: number): string {
  return v.toFixed(1);
}

/** A rake: always signed, because the sign IS the reading. Matches `fmtMm` on the sheet strip. */
function signedMm(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}
