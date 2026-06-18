"use client";

import { useCallback, useRef, useState } from "react";
import {
  clampViewCropNorm,
  containerNormToVideoNorm,
  rectFromPoints,
  videoCropToContainerNorm,
  type VideoContentRect,
  type VideoViewCropNorm,
} from "@/lib/manualVideoAnalysis/videoViewCrop";

type Props = {
  value: VideoViewCropNorm | null;
  onChange: (crop: VideoViewCropNorm | null) => void;
  /** object-contain content area inside the 16:9 frame */
  contentRect?: VideoContentRect;
  disabled?: boolean;
};

type DragState = { ax: number; ay: number };

const FULL_CONTENT: VideoContentRect = { left: 0, top: 0, width: 1, height: 1 };

export function VideoCropSelector({
  value,
  onChange,
  contentRect = FULL_CONTENT,
  disabled,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const toVideoNorm = useCallback(
    (clientX: number, clientY: number) => {
      const el = wrapRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      const cx = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const cy = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
      return containerNormToVideoNorm(cx, cy, contentRect);
    },
    [contentRect]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const { x, y } = toVideoNorm(e.clientX, e.clientY);
    setDrag({ ax: x, ay: y });
    onChange(clampViewCropNorm({ x, y, w: 0.05, h: 0.05 }));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || disabled) return;
    const { x, y } = toVideoNorm(e.clientX, e.clientY);
    const next = rectFromPoints(drag.ax, drag.ay, x, y, e.shiftKey);
    if (next) onChange(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    setDrag(null);
  };

  const sel = value ? videoCropToContainerNorm(value, contentRect) : null;

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 z-30 touch-none cursor-crosshair"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {sel ? (
        <div
          className="absolute border-2 border-sky-400 bg-sky-400/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] pointer-events-none"
          style={{
            left: `${sel.x * 100}%`,
            top: `${sel.y * 100}%`,
            width: `${sel.w * 100}%`,
            height: `${sel.h * 100}%`,
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="rounded bg-black/70 px-2 py-1 text-[11px] text-white">
            Click and drag to select the track area · Hold Shift for square
          </p>
        </div>
      )}
    </div>
  );
}
