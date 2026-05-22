"use client";

import { useEffect, useState } from "react";

const DEFAULT_FPS = 60;

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  active?: boolean;
  fps?: number;
};

export function VideoFrameControls({ videoRef, active = false, fps = DEFAULT_FPS }: Props) {
  const [timeSec, setTimeSec] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setTimeSec(v.currentTime);
    const onMeta = () => setReady(true);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    if (v.readyState >= 1) setReady(true);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, [videoRef, active]);

  function stepFrame(dir: -1 | 1) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    const step = 1 / fps;
    v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + dir * step));
    setTimeSec(v.currentTime);
  }

  if (!active || !ready) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        className="rounded-md border border-border px-2 py-1 hover:bg-muted"
        onClick={() => stepFrame(-1)}
        title={`Back 1 frame (~${fps} fps)`}
      >
        ◀ Frame
      </button>
      <button
        type="button"
        className="rounded-md border border-border px-2 py-1 hover:bg-muted"
        onClick={() => stepFrame(1)}
        title={`Forward 1 frame (~${fps} fps)`}
      >
        Frame ▶
      </button>
      <span className="font-mono text-muted-foreground tabular-nums">
        {timeSec.toFixed(3)}s
      </span>
    </div>
  );
}
