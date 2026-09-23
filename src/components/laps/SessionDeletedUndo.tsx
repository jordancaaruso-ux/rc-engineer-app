"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionToast } from "@/components/ui/ActionToast";
import {
  deletedSessionsMessage,
  setImportedSessionsHidden,
  takeRecentlyDeletedSessions,
} from "@/components/laps/sessionDeletion";

/**
 * The Undo for a session deleted on its own page, shown on the page the driver lands on after.
 *
 * Landing here by the back button restores this page from the router's cache — with the deleted
 * row still in it — so the first thing it does is refresh. `onChanged` stands in for that refresh
 * on a page that holds its own list (the library).
 */
export function SessionDeletedUndo({ onChanged }: { onChanged?: () => void }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    const deleted = takeRecentlyDeletedSessions();
    if (!deleted) return;
    setIds(deleted);
    if (onChanged) onChanged();
    else router.refresh();
  }, [onChanged, router]);

  return (
    <ActionToast
      message={ids ? deletedSessionsMessage(ids.length) : null}
      action={
        ids
          ? {
              label: "Undo",
              onClick: () => {
                void setImportedSessionsHidden(ids, false).then(() => {
                  if (onChanged) onChanged();
                  else router.refresh();
                });
              },
            }
          : null
      }
      onDismiss={() => setIds(null)}
    />
  );
}
