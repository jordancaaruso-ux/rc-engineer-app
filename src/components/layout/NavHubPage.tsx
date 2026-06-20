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
