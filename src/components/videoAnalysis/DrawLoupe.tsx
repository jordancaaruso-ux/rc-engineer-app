"use client";

import { useEffect, useRef } from "react";

/**
 * A magnifying glass on the end you are dragging.
 *
 * Placing a sector line is pixel work done with a thumb sitting on top of the very pixel you
 * are aiming at. The loupe lifts that patch of track off the picture and blows it up beside
 * your finger, with the line drawn through it exactly as it will be saved, so the point can be
 * put on the edge of a kerb rather than near it.
 */

const ZOOM = 3.2; // times the size the picture is painted at
const GAP = 44; // clearance between the point and the glass, so a thumb never covers it

type Line = { x1: number; y1: number; x2: number; y2: number };

/** Big enough to read, never so big it swallows a phone-sized picture. */
function loupeSize(boxH: number): number {
  if (boxH <= 0) return 132;
  return Math.round(Math.max(88, Math.min(132, boxH * 0.52)));
}

export function DrawLoupe({
  videoRef,
  boxW,
  boxH,
  cx,
  cy,
  line,
  sf = false,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Painted picture size in css px — the fractions below are normalised to it. */
  boxW: number;
  boxH: number;
  cx: number;
  cy: number;
  line: Line | null;
  sf?: boolean;
}) {
  const D = loupeSize(boxH);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The glass repaints every frame off this, so the drag can move the point without the paint
  // loop being torn down and rebuilt on each pointer move.
  const stateRef = useRef({ boxW, boxH, cx, cy, line, sf, D });
  useEffect(() => {
    stateRef.current = { boxW, boxH, cx, cy, line, sf, D };
  }, [boxW, boxH, cx, cy, line, sf, D]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = D * dpr;
    canvas.height = D * dpr;
    let raf = 0;

    const paint = () => {
      raf = requestAnimationFrame(paint);
      const ctx = canvas.getContext("2d");
      const v = videoRef.current;
      if (!ctx) return;
      const st = stateRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, D, D);
      ctx.save();
      ctx.beginPath();
      ctx.arc(D / 2, D / 2, D / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, D, D);

      const vw = v?.videoWidth ?? 0;
      const vh = v?.videoHeight ?? 0;
      if (v && vw > 0 && vh > 0 && st.boxW > 0 && st.boxH > 0) {
        // Half the window the glass shows, as a fraction of the picture.
        const hx = D / 2 / (ZOOM * st.boxW);
        const hy = D / 2 / (ZOOM * st.boxH);
        try {
          ctx.drawImage(v, (st.cx - hx) * vw, (st.cy - hy) * vh, 2 * hx * vw, 2 * hy * vh, 0, 0, D, D);
        } catch {
          // A frame that isn't decodable yet — the glass just stays black this tick.
        }
        if (st.line) {
          const px = (nx: number) => ((nx - (st.cx - hx)) / (2 * hx)) * D;
          const py = (ny: number) => ((ny - (st.cy - hy)) / (2 * hy)) * D;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(px(st.line.x1), py(st.line.y1));
          ctx.lineTo(px(st.line.x2), py(st.line.y2));
          ctx.strokeStyle = "rgba(0,0,0,0.6)";
          ctx.lineWidth = 4;
          ctx.stroke();
          ctx.strokeStyle = st.sf ? "#ffffff" : "#ffd60a";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Crosshair on the exact point, broken at the middle so the pixel itself stays visible.
      const c = D / 2;
      const arm = 16;
      const gap = 5;
      ctx.lineCap = "butt";
      for (const [w, colour] of [
        [3, "rgba(0,0,0,0.55)"],
        [1, "rgba(255,255,255,0.95)"],
      ] as const) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(c - arm, c);
        ctx.lineTo(c - gap, c);
        ctx.moveTo(c + gap, c);
        ctx.lineTo(c + arm, c);
        ctx.moveTo(c, c - arm);
        ctx.lineTo(c, c - gap);
        ctx.moveTo(c, c + gap);
        ctx.lineTo(c, c + arm);
        ctx.stroke();
      }
      ctx.restore();

      // Rim, drawn outside the clip so it reads as a lens sitting on the picture.
      ctx.beginPath();
      ctx.arc(D / 2, D / 2, D / 2 - 1, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(D / 2, D / 2, D / 2 - 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    paint();
    return () => cancelAnimationFrame(raf);
  }, [videoRef, D]);

  if (boxW <= 0 || boxH <= 0) return null;

  // Floats just above the finger. With no room above — the point is near the top of the
  // picture — it goes out to the side rather than below, because below the point is exactly
  // where the hand is; and if neither fits it parks in the far corner.
  const pointX = cx * boxW;
  const pointY = cy * boxH;
  let left: number;
  let top: number;
  if (pointY - GAP - D >= 4) {
    left = pointX - D / 2;
    top = pointY - GAP - D;
  } else if (cx <= 0.5 ? pointX + GAP + D <= boxW - 4 : pointX - GAP - D >= 4) {
    left = cx <= 0.5 ? pointX + GAP : pointX - GAP - D;
    top = pointY - D / 2;
  } else {
    left = cx > 0.5 ? 6 : boxW - D - 6;
    top = cy > 0.5 ? 6 : boxH - D - 6;
  }
  top = Math.max(4, Math.min(top, Math.max(4, boxH - D - 4)));
  left = Math.max(4, Math.min(left, Math.max(4, boxW - D - 4)));

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 drop-shadow-[0_6px_16px_rgba(0,0,0,0.45)]"
      style={{ left, top, width: D, height: D }}
    >
      <canvas ref={canvasRef} className="h-full w-full rounded-full" />
    </div>
  );
}
