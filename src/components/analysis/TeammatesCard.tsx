import type { TeammateLastOut } from "@/lib/analysis/analysisHomeModel";
import { TeammatesLastOutList } from "@/components/analysis/TeammatesLastOutList";
import { CardPanel } from "@/components/ui/CardPanel";

/**
 * **Your team** — every teammate you have, the ones out with you today first, then the ones out
 * today somewhere else, then everyone by how recently they last ran. Added 2026-08-20 on founder
 * instruction — *"the list below should be expansive, every teammate you have."*
 *
 * ── The card that used to sit above this one (deleted 2026-09-14) ────────────────────────────
 * "Out with you": the other drivers who had logged a run at your meeting, or at your track that
 * day, and their best lap — scoped by co-presence, so a stranger at the same club round was a
 * row. It was built that way on purpose (2026-08-19, teams had been rejected as the denominator
 * because most accounts are in none) and it was wrong: a driver opened Analysis and saw a lap
 * time belonging to someone he had never agreed to share anything with. Founder ruling:
 * *"nobody outside my team ever sees anything I logged."* Nothing on this page reads another
 * driver's runs without a shared `TeamMembership` now, and that is a standing rule, not a
 * setting — see `docs/TEAMS_PILOT.md`.
 *
 * What survived is the ORDER. The old card's one good idea was "who is here with me right now",
 * and that question is answered inside this list instead: the tiers are decided in
 * `sortTeammatesByLastOut`, the "here" and "today" facts in `loadTeammatesLastOut`.
 *
 * ── Why every row is a door ──────────────────────────────────────────────────────────────────
 * Membership is mutual and retroactive, so a teammate's row opens Sessions in that team's scope
 * narrowed to them — a shortcut to a page that was always theirs to open, not a new grant.
 *
 * No empty state. With no teammates the list is empty, the page drops the card, and nothing
 * explains that — a box saying "nobody on your team" is a card about the app's adoption rather
 * than about the driving.
 */
export function TeammatesCard({ rows }: { rows: TeammateLastOut[] }) {
  if (rows.length === 0) return null;
  // The scope line says what the order IS, because the order changes with the day: on a day
  // you have run, the teammates at your track lead; on any other day it is plainly newest first.
  const scope = rows.some((row) => row.isHere)
    ? "with you today first"
    : rows.some((row) => row.isToday)
      ? "out today first"
      : "any track · newest first";

  return (
    <CardPanel contentClassName="flex flex-col gap-0 p-0">
      <CardHead title="Your team" scope={scope} />
      <TeammatesLastOutList rows={rows} />
    </CardPanel>
  );
}

/**
 * The heading the card wears — its band (2026-09-15): name left, scope right, one full-bleed
 * hairline under both. It is the card's first child, so `.eyebrow-root` makes it the band on its
 * own; `px-4`, not the old `mx-4 mt-3`, because a top margin leaves a white strip above the tint.
 *
 * Composed by hand rather than through `<Eyebrow>` so the scope can ride the label's row — the
 * same shape `OutingHeading` uses at the top of this page, deliberately, so the cards on
 * `/analysis` head themselves identically.
 */
function CardHead({ title, scope }: { title: string; scope: string }) {
  return (
    <div className="eyebrow-root mb-1 flex items-baseline gap-2 px-4">
      <h2 className="eyebrow-label min-w-0">
        <span className="min-w-0 truncate">{title}</span>
      </h2>
      <span className="ml-auto min-w-0 truncate text-[11px] leading-[1.25] text-muted-foreground">{scope}</span>
    </div>
  );
}
