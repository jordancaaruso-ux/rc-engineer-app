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
    <li>
      <Link href={href} className="tap-active block">
        <CardPanel contentClassName="flex items-center gap-3 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground group-hover:text-foreground">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="ui-title block text-sm text-foreground">{title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
          </span>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground"
            aria-hidden
          />
        </CardPanel>
      </Link>
    </li>
  );
}

/**
 * Workspace + Catalogs.
 *
 * The catalogs moved here from the old Garage hub (founder call 2026-07-29). They're shared
 * reference data, not yours: you meet tires, tracks and additives in the run-form pickers, so these
 * pages exist for browsing and cleanup — they don't belong on a daily-loop tab.
 */
export function SettingsNavSection({ isAdmin = false }: { isAdmin?: boolean }) {
  const catalogs = catalogLinksForUser(isAdmin);

  return (
    <div className="mt-8 space-y-6 border-t border-border pt-8">
      <div>
        <Eyebrow>Workspace</Eyebrow>
        <ul className="mt-2 flex flex-col gap-2">
          <NavRow
            href="/teams"
            icon={Users}
            title="Teams"
            description="Shared setups and team garage."
          />
        </ul>
      </div>

      <div>
        <Eyebrow>Catalogs</Eyebrow>
        <ul className="mt-2 flex flex-col gap-2">
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
      </div>
    </div>
  );
}
