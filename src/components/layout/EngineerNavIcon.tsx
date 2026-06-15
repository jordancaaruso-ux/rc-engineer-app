"use client";

import { useId } from "react";
import { Sparkles } from "lucide-react";

/**
 * Bottom-nav Engineer tab: stock Lucide Sparkles paths/size; rainbow gradient stroke only.
 */
export function EngineerNavIcon() {
  const gradientId = useId().replace(/:/g, "");

  return (
    <>
      <svg width="0" height="0" className="pointer-events-none absolute" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="20%" stopColor="#f97316" />
            <stop offset="40%" stopColor="#eab308" />
            <stop offset="55%" stopColor="#22c55e" />
            <stop offset="70%" stopColor="#3b82f6" />
            <stop offset="85%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
      </svg>
      <Sparkles className="h-5 w-5" stroke={`url(#${gradientId})`} aria-hidden />
    </>
  );
}
