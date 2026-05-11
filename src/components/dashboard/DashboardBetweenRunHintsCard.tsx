import { BetweenRunRecentSessionsThings } from "@/components/betweenRunHints/BetweenRunRecentSessionsThings";
import type { BetweenRunHintPayload } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { HeroPanel } from "@/components/ui/HeroPanel";
import { SectionMetaInline, SectionTitle } from "@/components/ui/SectionTitle";
import { cn } from "@/lib/utils";

function scopeLine(h: BetweenRunHintPayload): string {
  const bits = [h.scope.carLabel];
  if (h.scope.trackLabel) bits.push(h.scope.trackLabel);
  if (h.scope.eventLabel) bits.push(h.scope.eventLabel);
  return bits.join(" · ");
}

export function DashboardBetweenRunHintsCard({
  hint,
  className,
}: {
  hint: BetweenRunHintPayload | null;
  className?: string;
}) {
  if (!hint) return null;

  return (
    <HeroPanel className={cn(className)}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <SectionTitle>Things to try — Engineer</SectionTitle>
          <SectionMetaInline>{scopeLine(hint)}</SectionMetaInline>
        </div>
        <BetweenRunRecentSessionsThings sessions={hint.recentSessions ?? []} className="mt-2" />
        <div>
          <ButtonLink href={hint.engineerHref} variant="primary">
            Open Engineer
          </ButtonLink>
        </div>
      </div>
    </HeroPanel>
  );
}
