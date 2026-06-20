import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { HubRowTitle } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

export function AssetListRow({
  href,
  title,
  meta,
}: {
  href: string;
  title: string;
  meta: string;
}) {
  return (
    <Link href={href} prefetch className="tap-active block">
      <SurfaceCard variant="panel" contentClassName="flex items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <HubRowTitle as="span" className="block truncate">
            {title}
          </HubRowTitle>
          <span className="ui-caption mt-0.5 block font-mono tabular-nums">{meta}</span>
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
          aria-hidden
        />
      </SurfaceCard>
    </Link>
  );
}
