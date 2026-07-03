"use client";

import { useEffect, useState } from "react";

/**
 * Dev-only appearance tuner — live sliders for the CSS knobs that drive the
 * photo wash + liquid glass (`--tune-*` vars in globals.css). Lets the founder
 * dial the look in the real app, then "Copy" the values to hand back so they
 * can be committed as the new defaults. Values persist in localStorage across
 * reloads while experimenting. Never rendered in production (see AppShell).
 */

type Knob = {
  id: string;
  label: string;
  cssVar: string;
  min: number;
  max: number;
  step: number;
  /** Appended when writing the CSS var (e.g. "px"). */
  unit: "" | "px";
  def: number;
};

const KNOBS: Knob[] = [
  { id: "bgBlur", label: "BG blur", cssVar: "--tune-bg-blur", min: 0, max: 30, step: 1, unit: "px", def: 8 },
  { id: "bgDark", label: "BG dark", cssVar: "--tune-bg-dark", min: 0.1, max: 0.85, step: 0.02, unit: "", def: 0.4 },
  { id: "bgYellow", label: "BG yellow", cssVar: "--tune-bg-yellow", min: 0, max: 0.9, step: 0.05, unit: "", def: 0.3 },
  { id: "glassAlpha", label: "Glass alpha", cssVar: "--tune-glass-alpha", min: 0.3, max: 0.95, step: 0.05, unit: "", def: 0.7 },
  { id: "glassBlur", label: "Glass blur", cssVar: "--tune-glass-blur", min: 0, max: 80, step: 2, unit: "px", def: 52 },
];

const STORE_KEY = "rc-appearance-tune";

function applyKnob(knob: Knob, value: number) {
  document.documentElement.style.setProperty(knob.cssVar, `${value}${knob.unit}`);
}

function defaults(): Record<string, number> {
  return Object.fromEntries(KNOBS.map((k) => [k.id, k.def]));
}

export function AppearanceTuner() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, number>>(defaults);
  const [copied, setCopied] = useState(false);

  /* Restore persisted experiment on mount. */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, number>;
      const next = { ...defaults(), ...saved };
      setValues(next);
      for (const k of KNOBS) applyKnob(k, next[k.id]);
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  function update(knob: Knob, value: number) {
    const next = { ...values, [knob.id]: value };
    setValues(next);
    applyKnob(knob, value);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* storage full/blocked — live tuning still works */
    }
  }

  function reset() {
    const next = defaults();
    setValues(next);
    for (const k of KNOBS) applyKnob(k, next[k.id]);
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }

  async function copy() {
    const text = KNOBS.map((k) => `${k.label}: ${values[k.id]}${k.unit}`).join(" · ");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — values remain visible in the panel */
    }
  }

  return (
    <div className="fixed right-3 z-[70] bottom-[calc(var(--mobile-tab-bar-height)+0.75rem)] md:bottom-6 md:right-6">
      {open ? (
        <div className="w-64 rounded-2xl border border-white/[0.14] bg-card/[0.55] p-4 shadow-[0_20px_45px_-18px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[30px] backdrop-saturate-[1.5]">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Tune</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
            aria-label="Collapse appearance tuner"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          {KNOBS.map((k) => (
            <label key={k.id} className="block">
              <span className="flex justify-between font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
                {k.label}
                <span className="text-primary tabular-nums">
                  {values[k.id]}
                  {k.unit}
                </span>
              </span>
              <input
                type="range"
                min={k.min}
                max={k.max}
                step={k.step}
                value={values[k.id]}
                onChange={(e) => update(k, Number(e.target.value))}
                className="mt-1 w-full accent-primary"
              />
            </label>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex-1 rounded-lg bg-primary px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-primary-foreground"
          >
            {copied ? "Copied ✓" : "Copy values"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-border px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open appearance tuner"
          className="rounded-full border border-white/[0.14] bg-card/[0.55] px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary shadow-[0_12px_30px_-12px_rgba(0,0,0,0.7)] backdrop-blur-[20px]"
        >
          ◐ Tune
        </button>
      )}
    </div>
  );
}
