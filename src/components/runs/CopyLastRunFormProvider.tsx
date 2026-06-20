"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CopyPreviewRunRecord } from "@/lib/runs/copyPreviewRunTypes";
import { CopyLastRunFormContext, type CopyBridge } from "@/components/runs/CopyLastRunFormContext";

/** Client-only provider — import from this file in server pages, not the context module. */
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
