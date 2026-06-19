"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CopyPreviewRunRecord } from "@/lib/runs/getLastRunForCopyPreview";

type CopyBridge = {
  apply: () => void;
  applied: boolean;
};

type CopyLastRunFormContextValue = {
  previewRun: CopyPreviewRunRecord | null;
  bridge: CopyBridge | null;
  setBridge: (bridge: CopyBridge | null) => void;
};

const CopyLastRunFormContext = createContext<CopyLastRunFormContextValue | null>(null);

export function CopyLastRunFormProvider({
  previewRun,
  children,
}: {
  previewRun: CopyPreviewRunRecord | null;
  children: ReactNode;
}) {
  const [bridge, setBridgeState] = useState<CopyBridge | null>(null);
  const bridgeRef = useRef<CopyBridge | null>(null);

  const setBridge = useCallback((next: CopyBridge | null) => {
    const prev = bridgeRef.current;
    if (prev === next) return;
    if (prev == null || next == null) {
      bridgeRef.current = next;
      setBridgeState(next);
      return;
    }
    if (prev.applied === next.applied && prev.apply === next.apply) return;
    bridgeRef.current = next;
    setBridgeState(next);
  }, []);

  const value = useMemo(
    () => ({ previewRun, bridge, setBridge }),
    [previewRun, bridge, setBridge]
  );

  return (
    <CopyLastRunFormContext.Provider value={value}>{children}</CopyLastRunFormContext.Provider>
  );
}

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
