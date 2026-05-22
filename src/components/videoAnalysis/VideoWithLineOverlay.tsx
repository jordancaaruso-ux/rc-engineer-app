"use client";

import { useEffect, useRef, useState } from "react";
import type { SectorLineNorm } from "./SectorLineCanvas";

type Props = {
  videoSrc: string | null;
  lines: SectorLineNorm[];
  activeLineKey?: string | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
};

export function VideoWithLineOverlay({ videoSrc, lines, activeLineKey, videoRef: externalRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef ?? internalRef;
  const [size, setSize] = useState({ w: 640, h: 360 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(320, r.width), h: Math.max(180, r.width * (9 / 16)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden rounded-lg border border-border bg-black"
      style={{ aspectRatio: "16 / 9" }}
    >
      {videoSrc ? (
        <video
          ref={videoRef}
          src={videoSrc}
          className="absolute inset-0 h-full w-full object-contain"
          controls
          playsInline
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Select a video file
        </div>
      )}
      <svg
        className="absolute inset-0 h-full w-full pointer-events-none"
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="none"
      >
        {lines.map((ln) => {
          const active = ln.lineKey === activeLineKey;
          const color = ln.lineKey === "sf" ? "#22c55e" : active ? "#f97316" : "#60a5fa";
          const x1 = ln.x1 * size.w;
          const y1 = ln.y1 * size.h;
          const x2 = ln.x2 * size.w;
          const y2 = ln.y2 * size.h;
          return (
            <line
              key={ln.lineKey}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={active ? 3 : 2}
              strokeDasharray={ln.lineKey === "sf" ? undefined : "6 4"}
            />
          );
        })}
      </svg>
    </div>
  );
}

export function useVideoCurrentTime(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setT(v.currentTime);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [videoRef]);
  return t;
}
