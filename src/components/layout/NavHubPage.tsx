import Link from "next/link";
import type { NavHubLink, NavHubSection } from "@/components/layout/navConfig";
import { ChevronRight } from "lucide-react";
import { Eyebrow, HubRowTitle } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

function HubLinkRow({ link }: { link: NavHubLink }) {
  const Icon = link.icon;
  return (
    <li>
      <Link href={link.href} prefetch className="tap-active block">
        <SurfaceCard variant="panel" contentClassName="flex items-center gap-3 px-4 py-3">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/50 text-muted-foreground transition-colors group-hover:text-foreground">
            <Icon className="size-[15px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <HubRowTitle as="span" className="block">
              {link.label}
            </HubRowTitle>
          </span>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
            aria-hidden
          />
        </SurfaceCard>
      </Link>
    </li>
  );
}

export function NavHubPage({
  title,
  subtitle,
  links,
  sections,
}: {
  title: string;
  subtitle: string;
  links?: NavHubLink[];
  sections?: NavHubSection[];
}) {
  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
      </header>
      <section className="page-body max-w-2xl flex flex-col gap-3">
        {sections
          ? sections.map((section) => (
              <div key={section.eyebrow} className="space-y-2.5">
                <Eyebrow dot="muted">{section.eyebrow}</Eyebrow>
                <ul className="flex flex-col gap-2.5">
                  {section.links.map((link) => (
                    <HubLinkRow key={link.href} link={link} />
                  ))}
                </ul>
              </div>
            ))
          : null}
        {links ? (
          <ul className="flex flex-col gap-2.5">
            {links.map((link) => (
              <HubLinkRow key={link.href} link={link} />
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}
