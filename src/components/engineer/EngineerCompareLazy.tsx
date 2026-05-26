"use client";

import dynamic from "next/dynamic";
import { CardPanel } from "@/components/ui/CardPanel";

const CompareSkeleton = () => (
  <CardPanel className="text-sm text-muted-foreground">Loading compare tools…</CardPanel>
);

export const EngineerCompareAndPattern = dynamic(
  () =>
    import("@/components/engineer/EngineerCompareAndPattern").then((m) => ({
      default: m.EngineerCompareAndPattern,
    })),
  { loading: () => <CompareSkeleton /> }
);
