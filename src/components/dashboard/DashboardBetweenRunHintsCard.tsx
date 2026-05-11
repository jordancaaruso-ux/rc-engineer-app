import { BetweenRunHintSummary } from "@/components/betweenRunHints/BetweenRunHintSummary";
import type { BetweenRunHintPayload } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { HeroPanel } from "@/components/ui/HeroPanel";
import { cn } from "@/lib/utils";

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
      <BetweenRunHintSummary
        hint={hint}
        title="Suggested next steps"
        actions={
          <ButtonLink href={hint.engineerHref} variant="primary">
            Open Engineer
          </ButtonLink>
        }
      />
    </HeroPanel>
  );
}
