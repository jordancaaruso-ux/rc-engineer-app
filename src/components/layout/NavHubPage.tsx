import Link from "next/link";
import type { NavHubLink } from "@/components/layout/navConfig";
import { ChevronRight } from "lucide-react";

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
          <h1 className="page-title text-base">{title}</h1>
          <p className="page-subtitle mt-0.5">{subtitle}</p>
        </div>
      </header>
      <section className="page-body flex max-w-2xl flex-col gap-2">
        <ul className="flex flex-col gap-2">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="group tap-active flex items-center gap-3 rounded-xl border border-border bg-card/80 px-4 py-3.5 transition hover:border-accent/30 hover:bg-card"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground group-hover:text-foreground">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="ui-title block text-sm text-foreground">{link.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{link.description}</span>
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
