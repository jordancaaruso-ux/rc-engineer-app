import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { ThemePreviewSwitcher } from "@/components/layout/ThemePreviewSwitcher";

export function SettingsNavSection() {
  return (
    <div className="mt-8 space-y-6 border-t border-border pt-8">
      <div>
        <h2 className="ui-title text-sm text-foreground">Workspace</h2>
        <ul className="mt-2 flex flex-col gap-2">
          <li>
            <Link
              href="/teams"
              className="group flex items-center gap-3 rounded-xl border border-border bg-card/80 px-4 py-3 transition hover:border-accent/30 hover:bg-card"
            >
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
            </Link>
          </li>
        </ul>
      </div>

      <div>
        <h2 className="ui-title text-sm text-foreground">Appearance</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Theme previews are stored locally on this device.
        </p>
        <div className="mt-3 rounded-xl border border-border bg-card/80 p-3">
          <ThemePreviewSwitcher placement="sidebar" />
        </div>
      </div>
    </div>
  );
}
