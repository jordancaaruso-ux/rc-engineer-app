"use client";

import dynamic from "next/dynamic";
import { CardPanel } from "@/components/ui/CardPanel";

const ModalSkeleton = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <CardPanel className="text-sm text-muted-foreground">Loading…</CardPanel>
  </div>
);

export const SetupSheetModal = dynamic(
  () => import("@/components/setup-sheet/SetupSheetModal").then((m) => ({ default: m.SetupSheetModal })),
  { loading: () => <ModalSkeleton />, ssr: false }
);

export type { SetupSheetModalRun } from "@/components/setup-sheet/SetupSheetModal";

export const RunLapAnalysisModal = dynamic(
  () => import("@/components/runs/RunLapAnalysisModal").then((m) => ({ default: m.RunLapAnalysisModal })),
  { loading: () => <ModalSkeleton />, ssr: false }
);
