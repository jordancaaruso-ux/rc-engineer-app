import Link from "next/link";
import {
  ChevronRight,
  CircleDot,
  FlaskConical,
  Layers,
  MapPin,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { catalogLinksForUser, type NavHubIconKey } from "@/components/layout/navConfig";

const CATALOG_ICONS: Partial<Record<NavHubIconKey, LucideIcon>> = {
  layers: Layers,
  "map-pin": MapPin,
  "circle-dot": CircleDot,
  flask: FlaskConical,
  wrench: Wrench,
};

function NavRow({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <li className="border-t border-border first:border-t-0">
      <Link href={href} className="tap-active group flex items-center gap-3 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground group-hover:text-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="ui-title block text-sm text-foreground">{title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
          aria-hidden
        />
      </Link>
    </li>
  );
}

/**
 * Browse — everything on this page that is a link away from it.
 *
 * The catalogs moved here from the old Garage hub (founder call 2026-07-29): they're shared
 * reference data, not yours — you meet tires, tracks and additives in the run-form pickers, so
 * these pages exist for browsing and cleanup and don't belong on a daily-loop tab.
 *
 * They were split under two labels, "Workspace" and "Catalogs", the first of which named a group
 * of exactly one row. One list now (2026-08-18); Teams leads it because it's the only one that is
 * actually yours.
 */
export function SettingsNavSection({ isAdmin = false }: { isAdmin?: boolean }) {
  const catalogs = catalogLinksForUser(isAdmin);

  return (
    <CardPanel contentClassName="p-0">
      {/* Heading in the card (2026-08-18) — see the note in YouSection. */}
      <div className="px-4 pt-3.5">
        <Eyebrow>Browse</Eyebrow>
      </div>
      <ul className="flex flex-col pb-1">
        <NavRow
          href="/teams"
          icon={Users}
          title="Teams"
          /* Was "Shared setups and team garage", which described neither the feature nor
             anything that exists: teams share runs, not setups, and there is no team garage.
             A team is who can see your sessions — which is a setting, and why this row is now
             the only door to it (nav restructure 2026-08-18). */
          description="Who you share sessions with, and who shares theirs with you."
        />
        {catalogs.map((link) => {
          const Icon = CATALOG_ICONS[link.icon] ?? Layers;
          return (
            <NavRow
              key={link.href}
              href={link.href}
              icon={Icon}
              title={link.label}
              description={link.description}
            />
          );
        })}
      </ul>
    </CardPanel>
  );
}
