"use client";

import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import type { DashboardActionItemRow } from "@/lib/dashboardServer";

/** @deprecated prefer `ActionItemListPanel` with `list="try"` */
export function ThingsToTrySection({
  initialItems,
  embedded = false,
}: {
  initialItems: DashboardActionItemRow[];
  embedded?: boolean;
}) {
  return (
    <ActionItemListPanel
      list="try"
      title="Things to try"
      hint="From logged runs and manual adds. Remove archives the item."
      addPlaceholder="Add an idea…"
      initialItems={initialItems}
      embedded={embedded}
    />
  );
}
