"use client";

import dynamic from "next/dynamic";
import { CardPanel } from "@/components/ui/CardPanel";

const NewRunFormSkeleton = () => (
  <CardPanel className="text-sm text-muted-foreground">Loading…</CardPanel>
);

/** Code-split the ~5k-line form; keep the route shell light until Log Run opens. */
export const NewRunForm = dynamic(
  () =>
    import("@/components/runs/NewRunForm").then((m) => ({
      default: m.NewRunForm,
    })),
  { loading: () => <NewRunFormSkeleton /> }
);
