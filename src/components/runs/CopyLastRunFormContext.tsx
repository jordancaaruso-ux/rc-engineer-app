"use client";

import { createContext, useContext } from "react";
import type { CopyPreviewRunRecord } from "@/lib/runs/copyPreviewRunTypes";

export type CopyBridge = {
  apply: () => void;
  applied: boolean;
};

type CopyLastRunFormContextValue = {
  previewRun: CopyPreviewRunRecord | null;
  bridge: CopyBridge | null;
  setBridge: (bridge: CopyBridge | null) => void;
};

export const CopyLastRunFormContext = createContext<CopyLastRunFormContextValue | null>(null);

export function useCopyLastRunForm() {
  const ctx = useContext(CopyLastRunFormContext);
  if (!ctx) {
    throw new Error("useCopyLastRunForm must be used within CopyLastRunFormProvider");
  }
  return ctx;
}

export function useCopyLastRunFormOptional() {
  return useContext(CopyLastRunFormContext);
}
