import Link from "next/link";
import type { NavHubLink } from "@/components/layout/navConfig";
import { ChevronRight } from "lucide-react";
import { PanelTitle } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
export function NavHubPage({
  title,
  subtitle,
  links,
}: {
  title: string;
  subtitle: string;
  links: NavHubLink[];
}) {
  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle mt-0.5">{subtitle}</p>
        </div>
      </header>
      <section className="page-body flex max-w-2xl flex-col gap-2">
        <ul className="flex flex-col gap-2.5">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <li key={link.href}>
                <Link href={link.href} prefetch className="tap-active block">
                  <SurfaceCard variant="panel" contentClassName="flex items-center gap-3 px-4 py-3.5">
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/50 text-muted-foreground transition-colors group-hover:text-foreground">
                      <Icon className="size-[15px]" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <PanelTitle
                        as="span"
                        className="block font-normal text-[18px] uppercase italic tracking-wide sm:text-[20px]"
                      >
                        {link.label}
                      </PanelTitle>
                    </span>                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                      aria-hidden
                    />
                  </SurfaceCard>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
