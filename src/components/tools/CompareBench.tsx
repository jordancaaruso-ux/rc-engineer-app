import { CardPanel } from "@/components/ui/CardPanel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import type { ToolsCompare } from "@/lib/tools/toolsModel";

/**
 * The compare band: your last two setups on one car, already in the slots.
 *
 * The bench's cost has never been the comparison, it is the picking — two taps into a modal,
 * two searches, two rows chosen out of forty. For the common case those four choices have one
 * obvious answer, so this band makes them and leaves "Pick others" for the rest.
 *
 * `A` and `B` are the bench's own slot names, deliberately. A driver who lands there sees the
 * same two letters on the same two setups, so the band reads as the bench already set up rather
 * than as a different feature that happens to link to it.
 *
 * The difference count is the reason to tap. Two names are just two names; "6 boxes differ" is
 * whether the comparison is worth opening — and **0** is the most useful reading of all, because
 * two setups you believed were different turning out identical is a finding, not an empty state.
 */
export function CompareBench({ compare }: { compare: ToolsCompare | null }) {
  if (!compare) {
    return (
      <CardPanel contentClassName="space-y-3">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Log two runs on the same car and they land here, ready to put side by side.
        </p>
        <ButtonLink href="/setup/comparison" variant="outline">
          Open the bench
        </ButtonLink>
      </CardPanel>
    );
  }

  const href = `/setup/comparison?a=${encodeURIComponent(compare.a.entryId)}&b=${encodeURIComponent(compare.b.entryId)}`;

  return (
    <CardPanel contentClassName="p-0">
      <Slot mark="A" side={compare.a} />
      <Slot mark="B" side={compare.b} />
      <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2.5">
        <span className="type-timestamp min-w-0 truncate">
          {compare.differingBoxes === 0
            ? "identical on paper"
            : `${compare.differingBoxes} ${compare.differingBoxes === 1 ? "box differs" : "boxes differ"}`}
        </span>
        <ButtonLink href={href}>Put them side by side</ButtonLink>
      </div>
    </CardPanel>
  );
}

/**
 * One slot, on a hairline inside the same card.
 *
 * Depth by rule, not by box — the same call the Paddock car cards make. Two cards would read as
 * two things when this is one pair with two halves.
 */
function Slot({ mark, side }: { mark: "A" | "B"; side: ToolsCompare["a"] }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0">
      <span className="grid size-5 shrink-0 place-items-center rounded border border-border bg-secondary text-[10px] font-semibold text-muted-foreground">
        {mark}
      </span>
      <span className="min-w-0 flex-1">
        <span className="ui-title block truncate text-[13px] font-semibold text-foreground">
          {side.label}
        </span>
        {side.detail ? <span className="ui-caption mt-0.5 block truncate">{side.detail}</span> : null}
      </span>
    </div>
  );
}
