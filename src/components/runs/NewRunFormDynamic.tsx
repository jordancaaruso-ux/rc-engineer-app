"use client";

import dynamic from "next/dynamic";
import { CardPanel } from "@/components/ui/CardPanel";

function NewRunFormSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <CardPanel key={i}>
          <div className="animate-pulse space-y-2">
            <div className="h-4 w-28 rounded-md bg-muted/60" />
            <div className="h-10 w-full rounded-md bg-muted/60" />
          </div>
        </CardPanel>
      ))}
    </div>
  );
}

export const NewRunForm = dynamic(
  () => import("@/components/runs/NewRunForm").then((m) => ({ default: m.NewRunForm })),
  { loading: () => <NewRunFormSkeleton /> }
);
