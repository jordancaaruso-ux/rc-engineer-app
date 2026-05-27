"use client";

import { useCallback, useEffect, useState } from "react";

const BODY_CLASS = "video-overlay-fullscreen-active";

export function useVideoOverlayFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRotateHint, setShowRotateHint] = useState(false);

  const exitFullscreen = useCallback(() => {
    setIsFullscreen(false);
    setShowRotateHint(false);
    document.documentElement.classList.remove(BODY_CLASS);
    const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
    orientation?.unlock?.();
  }, []);

  const enterFullscreen = useCallback(async () => {
    setIsFullscreen(true);
    document.documentElement.classList.add(BODY_CLASS);
    setShowRotateHint(false);

    try {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (mode: string) => Promise<void>;
      };
      if (orientation?.lock) {
        await orientation.lock("landscape");
      }
    } catch {
      setShowRotateHint(true);
    }
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen, exitFullscreen]);

  useEffect(() => {
    return () => {
      document.documentElement.classList.remove(BODY_CLASS);
    };
  }, []);

  return { isFullscreen, enterFullscreen, exitFullscreen, showRotateHint };
}
