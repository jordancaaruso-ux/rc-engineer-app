import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";

export function SettingsNavSection() {
  return (
    <div className="mt-8 space-y-6 border-t border-border pt-8">
      <div>
        <h2 className="ui-title text-sm text-foreground">Workspace</h2>
        <ul className="mt-2 flex flex-col gap-2">
          <li>
            <Link href="/teams" className="tap-active block">
              <CardPanel contentClassName="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground group-hover:text-foreground">
                  <Users className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="ui-title block text-sm text-foreground">Teams</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Shared setups and team garage.
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
              </CardPanel>
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
