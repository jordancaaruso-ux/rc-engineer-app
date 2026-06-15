"use client";

import { useId } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sparkles nav icon with a chrome-style rainbow gradient stroke (shape unchanged).
 */
export function EngineerNavIcon({ className }: { className?: string }) {
  const gradientId = useId().replace(/:/g, "");

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b6914" />
            <stop offset="18%" stopColor="#ffd700" />
            <stop offset="38%" stopColor="#fff8dc" />
            <stop offset="50%" stopColor="#ffffff" />
            <stop offset="62%" stopColor="#a8a8a8" />
            <stop offset="78%" stopColor="#4a5568" />
            <stop offset="92%" stopColor="#e2e8f0" />
            <stop offset="100%" stopColor="#c9a227" />
          </linearGradient>
        </defs>
      </svg>
      <Sparkles className="h-5 w-5" stroke={`url(#${gradientId})`} aria-hidden />
    </span>
  );
}
