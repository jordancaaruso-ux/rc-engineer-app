"use client";

/**
 * TelemetryBackground — full-bleed animated login backdrop (JRC Engineering).
 *
 * Sparse telemetry traces (THR / STR / RPM) drawing left→right with phosphor
 * decay over a faint oscilloscope grid, plus slow particle drift. One canvas,
 * no deps. Seamless 48s loop (all motion is periodic in LOOP). Honors
 * prefers-reduced-motion with a composed static frame. ~30fps cap, DPR ≤ 2.
 *
 * Colors are read from the globals.css RGB triplets (--color-background,
 * --color-foreground, --color-muted-foreground, --color-primary) so a palette
 * change carries through; hardcoded fallbacks match Technical v2. Vignette is
 * baked in (matches the login treatment).
 *
 * Usage — in src/app/login/page.tsx, replace the whole photo backdrop block
 * (login-bg-photo + scrim + vignette divs) with:
 *
 *   <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
 *     <TelemetryBackground />
 *   </div>
 *
 * Keep the yellow hero whisper + top hairline siblings as they are.
 */

import { useEffect, useRef } from "react";

type Props = {
  /** Multiplies trace/particle/grid opacity. 1 = shipped tuning. */
  intensity?: number;
  /** Playback rate. 1 = shipped tuning (48s loop). */
  speed?: number;
  className?: string;
};

const LOOP = 48; // seconds — everything is periodic in this
const DRAW = 0.42; // fraction of a trace cycle spent crossing

function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Trace = {
  kind: "thr" | "steer" | "rpm";
  samples: Float32Array;
  y: number;
  phase: number;
  accent: boolean;
  maxA: number;
  label: string;
};

function buildTraces(): Trace[] {
  const N = 256;
  const kinds: Trace["kind"][] = ["rpm", "steer", "thr", "steer", "rpm", "thr"];
  const yFr = [0.16, 0.31, 0.46, 0.6, 0.74, 0.87];
  return kinds.map((kind, i) => {
    const r = rng(1000 + i * 37);
    const s = new Float32Array(N + 1);
    if (kind === "steer") {
      const f1 = 1.2 + r() * 1.3, f2 = 2.6 + r() * 1.6, f3 = 5 + r() * 2;
      const p1 = r() * 6.28, p2 = r() * 6.28, p3 = r() * 6.28;
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        s[k] =
          0.62 * Math.sin(6.28 * f1 * u + p1) +
          0.3 * Math.sin(6.28 * f2 * u + p2) +
          0.14 * Math.sin(6.28 * f3 * u + p3);
      }
    } else if (kind === "thr") {
      let u = 0, hi = r() > 0.4;
      const segs: { u0: number; u1: number; v: number }[] = [];
      while (u < 1.02) {
        const plateau = 0.07 + r() * 0.09, ramp = 0.02 + r() * 0.03;
        const v = hi ? 0.84 + r() * 0.14 : 0.02 + r() * 0.12;
        segs.push({ u0: u, u1: u + plateau, v });
        u += plateau + ramp;
        hi = !hi;
      }
      const sample = (uu: number) => {
        for (let i2 = 0; i2 < segs.length; i2++) {
          const g = segs[i2];
          if (uu <= g.u1) {
            if (uu >= g.u0) return g.v;
            const prev = segs[i2 - 1];
            if (!prev) return g.v;
            const t = (uu - prev.u1) / (g.u0 - prev.u1);
            return prev.v + (g.v - prev.v) * Math.min(1, Math.max(0, t));
          }
        }
        return segs[segs.length - 1].v;
      };
      for (let k = 0; k <= N; k++) s[k] = sample(k / N);
    } else {
      let u = 0;
      const pts: { u: number; v: number }[] = [{ u: 0, v: 0.3 }];
      while (u < 1.05) {
        const rise = 0.07 + r() * 0.09;
        u += rise;
        pts.push({ u, v: 0.82 + r() * 0.14 });
        if (r() < 0.25) {
          const c = 0.05 + r() * 0.06;
          const top = pts[pts.length - 1].v;
          u += c;
          pts.push({ u, v: top - 0.08 });
        }
        pts.push({ u: u + 0.004, v: 0.36 + r() * 0.14 });
        u += 0.004;
      }
      const sample = (uu: number) => {
        for (let i2 = 1; i2 < pts.length; i2++) {
          if (uu <= pts[i2].u) {
            const a = pts[i2 - 1], b = pts[i2];
            const t = (uu - a.u) / Math.max(1e-6, b.u - a.u);
            return a.v + (b.v - a.v) * t;
          }
        }
        return pts[pts.length - 1].v;
      };
      for (let k = 0; k <= N; k++) s[k] = sample(k / N);
    }
    return {
      kind,
      samples: s,
      y: yFr[i] + (r() - 0.5) * 0.04,
      phase: i / kinds.length,
      accent: i === 2,
      maxA: i === 2 ? 0.34 : i % 2 === 0 ? 0.15 : 0.11,
      label: kind === "thr" ? "THR %" : kind === "steer" ? "STR °" : "RPM",
    };
  });
}

const PARTICLES = (() => {
  const pr = rng(777);
  return Array.from({ length: 26 }, (_, i) => ({
    u: pr(), y0: pr(),
    k: pr() < 0.7 ? 1 : 2, // integer crossings per loop — seamless wrap
    m: 1 + Math.floor(pr() * 3),
    ph: pr() * 6.28,
    size: 0.8 + pr() * 1.0,
    a: 0.04 + pr() * 0.06,
    accent: i % 9 === 0,
  }));
})();

function env(rel: number) {
  // phosphor decay behind the head: 0 at tail → 1 at head
  const st = [[0, 0], [0.35, 0.18], [0.75, 0.62], [1, 1]];
  if (rel <= 0) return 0;
  if (rel >= 1) return 1;
  for (let i = 1; i < st.length; i++) {
    if (rel <= st[i][0]) {
      const a = st[i - 1], b = st[i];
      return a[1] + (b[1] - a[1]) * ((rel - a[0]) / (b[0] - a[0]));
    }
  }
  return 1;
}

function readTriplet(el: Element, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return /^\d+\s+\d+\s+\d+$/.test(v) ? v.replace(/\s+/g, ",") : fallback;
}

export function TelemetryBackground({ intensity = 1, speed = 1, className }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const knobs = useRef({ intensity, speed });
  knobs.current = { intensity, speed };

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const traces = buildTraces();
    let w = 0, h = 0, dpr = 1, fadeLen = 320, bandH = 60;
    let raf = 0, last = 0;

    const bg = `rgb(${readTriplet(cv, "--color-background", "18,17,16")})`;
    const fgT = readTriplet(cv, "--color-foreground", "236,233,228");
    const mutedT = readTriplet(cv, "--color-muted-foreground", "160,157,150");
    const accentT = readTriplet(cv, "--color-primary", "255,214,10");
    // Sora since the one-voice pass (2026-08-14); `--font-mono-jb` no longer exists.
    // Canvas `fillText` has no font-variant-numeric, so these decorative ticker labels get
    // Sora's proportional digits. That is fine here — it is ambient background, not a
    // column — so don't "fix" it by reaching for a monospace.
    const uiVar = getComputedStyle(document.body).getPropertyValue("--font-ui").trim();
    const monoFont = `9px ${uiVar || "Sora"}, system-ui, sans-serif`;

    const measure = () => {
      const rect = cv.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      fadeLen = Math.max(320, w * 0.45);
      bandH = Math.min(h * 0.11, 84);
    };

    const yAt = (tr: Trace, u: number, yc: number) => {
      u = Math.min(1, Math.max(0, u));
      const N = 256, f = u * N, i = Math.floor(f), fr = f - i;
      const a = tr.samples[i], b = tr.samples[Math.min(N, i + 1)];
      const v = a + (b - a) * fr;
      if (tr.kind === "steer") return yc - v * bandH * 0.8;
      return yc + (0.5 - v) * bandH * 1.6;
    };

    const drawFrame = (t: number) => {
      const K = knobs.current.intensity;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // oscilloscope grid — centered so any aspect ratio stays symmetric
      const sp = 64, gA = 0.03 * (0.6 + 0.4 * K);
      ctx.lineWidth = 1;
      for (let x = (w / 2) % sp; x <= w; x += sp) {
        const k = Math.round((x - w / 2) / sp);
        ctx.strokeStyle = `rgba(${fgT},${k % 4 === 0 ? gA * 1.7 : gA})`;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = (h / 2) % sp; y <= h; y += sp) {
        const k = Math.round((y - h / 2) / sp);
        ctx.strokeStyle = `rgba(${fgT},${k % 4 === 0 ? gA * 1.7 : gA})`;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      const lf = t / LOOP;
      for (const p of PARTICLES) {
        const x = ((p.u + lf * p.k) % 1) * (w + 60) - 30;
        const y = p.y0 * h + Math.sin(6.28 * lf * p.m + p.ph) * 12;
        const a = Math.min(0.5, p.a * K);
        ctx.fillStyle = p.accent ? `rgba(${accentT},${a * 0.9})` : `rgba(${fgT},${a})`;
        ctx.beginPath(); ctx.arc(x, y, p.size, 0, 6.28); ctx.fill();
      }

      for (const tr of traces) {
        const tau = (lf + tr.phase) % 1;
        if (tau > DRAW) continue;
        const travel = w + fadeLen + 40;
        const head = -20 + (tau / DRAW) * travel;
        const tail = head - fadeLen;
        const x0 = Math.max(0, tail), x1 = Math.min(w, head);
        if (x1 <= x0) continue;
        const maxA = Math.min(0.85, tr.maxA * K);
        const rgb = tr.accent ? accentT : fgT;
        const grad = ctx.createLinearGradient(tail, 0, head, 0);
        grad.addColorStop(0, `rgba(${rgb},0)`);
        grad.addColorStop(0.35, `rgba(${rgb},${maxA * 0.18})`);
        grad.addColorStop(0.75, `rgba(${rgb},${maxA * 0.62})`);
        grad.addColorStop(1, `rgba(${rgb},${maxA})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.beginPath();
        const yc = tr.y * h;
        let first = true;
        for (let x = x0; x <= x1 + 5; x += 6) {
          const xx = Math.min(x, x1);
          const y = yAt(tr, xx / w, yc);
          if (first) { ctx.moveTo(xx, y); first = false; } else ctx.lineTo(xx, y);
          if (xx >= x1) break;
        }
        ctx.stroke();
        if (head >= 0 && head <= w) {
          const hy = yAt(tr, head / w, yc);
          if (tr.accent) {
            const g = ctx.createRadialGradient(head, hy, 0, head, hy, 7);
            g.addColorStop(0, `rgba(${accentT},${Math.min(0.5, maxA * 0.9)})`);
            g.addColorStop(1, `rgba(${accentT},0)`);
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(head, hy, 7, 0, 6.28); ctx.fill();
          }
          ctx.fillStyle = `rgba(${rgb},${Math.min(0.6, maxA * 2)})`;
          ctx.beginPath(); ctx.arc(head, hy, 1.4, 0, 6.28); ctx.fill();
        }
        const lx = 16;
        if (tail < lx && head > lx + 8) {
          const la = env((lx - tail) / fadeLen) * maxA;
          if (la > 0.01) {
            ctx.fillStyle = `rgba(${mutedT},${Math.min(0.45, la * 1.6)})`;
            ctx.font = monoFont;
            ctx.fillText(tr.label, lx, yc - bandH * 0.9);
          }
        }
      }

      // edge vignette — frames the card, matches the login treatment
      const R = 0.85 * Math.hypot(w, h);
      const vg = ctx.createRadialGradient(w / 2, h * 0.32, R * 0.32, w / 2, h * 0.4, R);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    };

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = () => {
      cancelAnimationFrame(raf);
      if (!w) return;
      if (mq.matches) {
        drawFrame(LOOP * 0.867); // composed still: ~3 traces mid-draw
        return;
      }
      last = 0;
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        if (now - last < 33) return; // ~30fps — ambient, half the battery cost
        last = now;
        drawFrame(((now / 1000) * knobs.current.speed) % LOOP);
      };
      raf = requestAnimationFrame(tick);
    };

    const ro = new ResizeObserver(() => { measure(); start(); });
    ro.observe(cv);
    const onMq = () => start();
    mq.addEventListener("change", onMq);
    measure();
    start();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={className}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
    />
  );
}
