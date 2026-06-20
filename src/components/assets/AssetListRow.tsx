"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { HubRowTitle } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { AssetDeleteButton } from "@/components/assets/AssetDeleteButton";

export function AssetListRow({
  href,
  title,
  meta,
  onDelete,
  runCount = 0,
}: {
  href: string;
  title: string;
  meta: string;
  onDelete?: () => Promise<void>;
  runCount?: number;
}) {
  return (
    <SurfaceCard variant="panel" contentClassName="flex items-center gap-2 px-4 py-3">
      <Link href={href} prefetch className="tap-active min-w-0 flex-1 flex items-center gap-3">
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
      </Link>
      {onDelete ? (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <AssetDeleteButton label={title} runCount={runCount} onDelete={onDelete} />
        </div>
      ) : null}
    </SurfaceCard>
  );
}
