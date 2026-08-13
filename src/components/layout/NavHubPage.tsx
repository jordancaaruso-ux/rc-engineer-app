import type { NavHubLink, NavHubSection } from "@/components/layout/navConfig";
import { HubNavLink } from "@/components/layout/HubNavLink";
import { Eyebrow } from "@/components/ui/panel";

function HubLinkList({ links }: { links: NavHubLink[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {links.map((link) => (
        <HubNavLink key={link.href} link={link} />
      ))}
    </ul>
  );
}

export function NavHubPage({
  title,
  subtitle,
  links,
  sections,
  echoesNav = false,
}: {
  title: string;
  subtitle: string;
  links?: NavHubLink[];
  sections?: NavHubSection[];
  /**
   * True when `title` is a word the desktop top rail already shows as a tab, so
   * the `<h1>` goes screen-reader-only from md up (globals.css, `is-echo`).
   * Opt-in per hub rather than always-on: `/tools` is a rail tab, `/more` is the
   * phone's overflow door and has no tab to duplicate.
   */
  echoesNav?: boolean;
}) {
  return (
    <>
      <header className={`page-header${echoesNav ? " is-echo" : ""}`}>
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
                    <HubNavLink key={link.href} link={link} />
                  ))}
                </ul>
              </div>
            ))
          : null}
        {links ? <HubLinkList links={links} /> : null}
      </section>
    </>
  );
}
