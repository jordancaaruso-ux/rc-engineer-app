"use client";

import { useEffect } from "react";

/**
 * "I'm at this track" — tells the timing sweep to watch today's track and look once now. Fires
 * after the dashboard has painted, once per tab per track per day, and never blocks anything:
 * the response is discarded and the poll itself runs after the server has replied.
 */
export function SweepArmBeacon({ trackId }: { trackId: string | null }) {
  useEffect(() => {
    if (!trackId) return;
    const day = new Date().toISOString().slice(0, 10);
    const flag = `rc_sweep_armed:${trackId}:${day}`;
    try {
      if (sessionStorage.getItem(flag)) return;
    } catch {
      // Private-mode storage refusal: fall through and just post.
    }
    void fetch("/api/sweep/arm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId }),
      keepalive: true,
    })
      .then((r) => {
        if (!r.ok) return;
        try {
          sessionStorage.setItem(flag, "1");
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // ignore
      });
  }, [trackId]);
  return null;
}
