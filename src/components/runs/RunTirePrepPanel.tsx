"use client";

import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";
import { getBoolFromSetupString } from "@/lib/a800rrSetupRead";
import type { TirePrepGroup } from "@/lib/tires/tirePrepFields";

type Props = {
  prepGroups: TirePrepGroup[];
  setupData: Record<string, unknown>;
  onToggle: (key: string, checked: boolean) => void;
  prefillFieldClass?: string;
};

function sideChipClass(selected: boolean) {
  return cn(
    "rounded-md border px-2.5 py-1.5 text-xs font-medium transition",
    selected
      ? "border-accent bg-accent/15 text-foreground"
      : "border-border bg-secondary text-foreground hover:bg-muted"
  );
}

export function RunTirePrepPanel({ prepGroups, setupData, onToggle, prefillFieldClass }: Props) {
  if (prepGroups.length === 0) return null;

  return (
    <div className={cn("space-y-3 text-sm", prefillFieldClass)}>
      <Eyebrow dot="muted">Tire prep</Eyebrow>
      <div className="space-y-2">
        {prepGroups.map((g) => {
          const frontOn = getBoolFromSetupString(String(setupData[g.frontKey] ?? ""));
          const rearOn = getBoolFromSetupString(String(setupData[g.rearKey] ?? ""));
          return (
            <div key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-xs font-medium text-foreground min-w-[4.5rem]">{g.label}</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${g.label} tire prep`}>
                <button
                  type="button"
                  className={sideChipClass(frontOn)}
                  aria-pressed={frontOn}
                  onClick={() => onToggle(g.frontKey, !frontOn)}
                >
                  Front
                </button>
                <button
                  type="button"
                  className={sideChipClass(rearOn)}
                  aria-pressed={rearOn}
                  onClick={() => onToggle(g.rearKey, !rearOn)}
                >
                  Rear
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
