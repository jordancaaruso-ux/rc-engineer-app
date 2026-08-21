import Link from "next/link";
import { MapPin, Star } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { BandHeader } from "@/components/ui/BandHeader";
import { BandFoot } from "@/components/paddock/BandFoot";
import { RowChevron } from "@/components/paddock/RowChevron";
import type { PaddockTrack } from "@/lib/paddock/paddockModel";

/**
 * The tracks band — yours, not the catalog. Five names and a door.
 *
 * `/tracks` is a search surface over hundreds of community rows, and it lived under Settings
 * because that is where the shared catalogs were swept. A track is not a preference: you pick
 * one every time you log a run or book a meeting, and it carries layouts, grip tags and timing
 * links. So the band shows the handful you have a relationship with — favourites first, then
 * the ones you actually run — and everything else stays one quiet line away.
 *
 * The star here is READ-ONLY by founder call (2026-08-19). Setting one is a catalog job and it
 * lives on the catalog row; a band of summary lines is somewhere you read, not somewhere you
 * administer. The empty state's whole job is therefore to name where the control IS —
 * "Nothing starred yet" named a noun the app does not use and pointed at nothing, which is
 * how a shipped feature came to look like it did not exist.
 *
 * ── Plain lists, 2026-08-19 ──────────────────────────────────────────────────────────────────
 * A name, and the star if it is a favourite. The run count, the venue-and-grip line and the
 * "last out" chip all came off with the rest of the page's figures (founder call), and so did the
 * expanded first row that carried them.
 *
 * "The run count is the point of the row — 'Southside · 31 runs' is why that track is yours; a
 * name on its own would be the catalog again, just shorter." That was the argument this file was
 * built on and it lost, deliberately: a name on its own is not the catalog, because the catalog
 * holds fifteen hundred of them and this holds the five that are yours. What it does cost is the
 * order — favourites lead, then most-run, and with the counts gone the star is the only part of
 * that the row still shows.
 *
 * `formatGripTagsForDisplay` was imported here and nowhere else on the page; the grip tags are
 * stored SHOUTING (`VERY_LOW`) and it was what stopped "Low · Medium grip" reading as part of the
 * street address. It stays in `trackMetaTags` for `/tracks`, which still draws them.
 */
export function PaddockTracks({
  tracks,
  catalogCount,
}: {
  tracks: PaddockTrack[];
  catalogCount: number;
}) {
  const remaining = Math.max(0, catalogCount - tracks.length);

  return (
    <CardPanel contentClassName="p-0">
      <BandHeader label="Tracks" addHref="/tracks" addLabel="Add a track" />

      {tracks.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">
          No favourites yet. Tap the star beside a track in the catalog below.
        </p>
      ) : (
        tracks.map((track, index) => (
          <Link
            key={track.id}
            href={`/tracks?trackId=${encodeURIComponent(track.id)}`}
            className={`tap-active group flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40 ${
              index > 0 ? "border-t border-border/60" : ""
            }`}
          >
            <span className="ui-title flex min-w-0 flex-1 items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
              {track.isFavourite ? (
                <Star
                  className="size-3 shrink-0 fill-primary-ink text-primary-ink"
                  aria-label="Favourite"
                />
              ) : null}
              <span className="truncate">{track.name}</span>
            </span>
            <RowChevron />
          </Link>
        ))
      )}

      <BandFoot
        href="/tracks"
        icon={MapPin}
        title="The track catalog"
        detail="Layouts, grip tags and timing links"
        /* The catalog is community-wide and runs to hundreds, so the count is nearly always
           the reason to press. `remaining` guards the new account that can already see all of
           the handful there are. */
        action={
          remaining > 0
            ? `Browse all ${catalogCount} tracks`
            : "Browse the catalog"
        }
      />
    </CardPanel>
  );
}
