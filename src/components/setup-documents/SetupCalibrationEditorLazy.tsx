"use client";

import dynamic from "next/dynamic";
import { CardPanel } from "@/components/ui/CardPanel";

const CalibrationEditorSkeleton = () => (
  <CardPanel className="text-sm text-muted-foreground">Loading calibration editor…</CardPanel>
);

export const SetupCalibrationEditorClient = dynamic(
  () =>
    import("@/components/setup-documents/SetupCalibrationEditorClient").then((m) => ({
      default: m.SetupCalibrationEditorClient,
    })),
  { loading: () => <CalibrationEditorSkeleton /> }
);
