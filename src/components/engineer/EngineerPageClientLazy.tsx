"use client";

import dynamic from "next/dynamic";
import { CardPanel } from "@/components/ui/CardPanel";

function EngineerClientSkeleton() {
  return (
    <CardPanel className="max-w-4xl mx-auto w-full" contentClassName="p-0">
      <div className="animate-pulse border-b border-border px-4 py-3">
        <div className="h-4 w-32 rounded-md bg-muted/60" />
      </div>
      <div className="space-y-3 p-4">
        <div className="h-10 w-full rounded-lg bg-muted/60" />
        <div className="h-48 w-full rounded-lg bg-muted/60" />
      </div>
    </CardPanel>
  );
}

export const EngineerPageClient = dynamic(
  () =>
    import("@/components/engineer/EngineerPageClient").then((m) => ({
      default: m.EngineerPageClient,
    })),
  { loading: () => <EngineerClientSkeleton /> }
);
