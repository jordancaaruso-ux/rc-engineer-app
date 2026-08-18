"use client";

/**
 * Dev preview for the demo walkthrough (`src/components/demo/tour/*`).
 *
 * The tour only runs for the shared demo session, so judging a copy tweak or a placement
 * otherwise means seeding a demo account and signing into it. This drives the REAL
 * `TourOverlay` against fabricated anchors, so what you are looking at is the shipped popover,
 * cutout and progress rail — not a mock-up.
 *
 * What this canNOT cover, and still needs a drive on the real app with `?tour=1`:
 *   · anchors that settle late, because `.rc-reveal` animates `.page-body > *` up 14px from
 *     zero opacity and this page has no `.page-body` at all — the single most likely thing to
 *     ship broken;
 *   · route pushes, the wedge heal, and resuming from `sessionStorage`;
 *   · the handover actually reaching the model.
 *
 * `data-tour-preview` attributes mirror `data-onboarding-state` on the onboarding preview so
 * the Playwright suite can select blocks by name.
 */

import { notFound } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TourOverlay } from "@/components/demo/tour/TourOverlay";
import type { TourGeometry } from "@/components/demo/tour/useTourPlacement";
import {
  DEMO_TOUR_STEPS,
  stepsForViewport,
  type TourPlacement,
  type TourViewport,
} from "@/lib/demo/tourSteps";

const PLACEMENTS: TourPlacement[] = ["top", "bottom", "left", "right"];

/** Fabricated anchors at the positions that actually cause trouble. */
const TARGETS: { id: string; label: string; className: string; note: string }[] = [
  {
    id: "corner",
    label: "Top-left",
    className: "h-24 w-56",
    note: "clamps against two edges at once",
  },
  {
    id: "wide",
    label: "Full-width card",
    className: "h-28 w-full",
    note: "top/bottom placement only",
  },
  {
    id: "tall",
    label: "Taller than the viewport",
    className: "h-[120vh] w-full max-w-md",
    note: "stop 4 on a phone — top-aligned, popover overlaps",
  },
  {
    id: "narrow",
    label: "Narrow, right side",
    className: "ml-auto h-20 w-40",
    note: "left placement flips when it would fall off",
  },
];

export default function DemoTourPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const [viewport, setViewport] = useState<TourViewport>("desktop");
  const [stepIndex, setStepIndex] = useState(0);
  const [placement, setPlacement] = useState<TourPlacement>("bottom");
  const [targetId, setTargetId] = useState("wide");
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  const [geometry, setGeometry] = useState<TourGeometry>({ hole: null, popover: null });
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // The onboarding preview learned this the hard way — Playwright can screenshot before
  // hydration, which catches the overlay mid-mount.
  useEffect(() => setReady(true), []);

  const steps = stepsForViewport(viewport);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  // Measure the chosen fake anchor and place the overlay against it. This mirrors what
  // `useTourPlacement` does, deliberately kept simple: the point of this page is to judge the
  // popover, and the real placement maths has its own home.
  useEffect(() => {
    if (!ready || !live) return;
    const place = () => {
      const el = document.querySelector<HTMLElement>(`[data-preview-target="${targetId}"]`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pad = 8;
      const hole = {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        radius: window.getComputedStyle(el).borderRadius || "14px",
      };
      const width = viewport === "mobile" ? Math.min(window.innerWidth - 16, 340) : 320;
      const height = popoverRef.current?.offsetHeight ?? 170;
      let top: number;
      let left: number;
      if (placement === "left") {
        left = hole.left - 14 - width;
        top = hole.top + hole.height / 2 - height / 2;
      } else if (placement === "right") {
        left = hole.left + hole.width + 14;
        top = hole.top + hole.height / 2 - height / 2;
      } else if (placement === "top") {
        left = hole.left + hole.width / 2 - width / 2;
        top = hole.top - 14 - height;
      } else {
        left = hole.left + hole.width / 2 - width / 2;
        top = hole.top + hole.height + 14;
      }
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
      setGeometry({ hole, popover: { top: Math.round(top), left: Math.round(left), width } });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [ready, live, targetId, placement, viewport, stepIndex]);

  if (!ready) return null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-2">
        <p className="eyebrow-label">Demo walkthrough preview</p>
        <h1 className="page-title">Tour overlay</h1>
        <p className="text-sm text-muted-foreground">
          Dev only. The real overlay against fabricated anchors — route pushes, late-settling
          anchors and the handover are not covered here. Drive those on the real app with{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 type-machine text-xs">?tour=1</code>.
        </p>
      </header>

      <section className="flex flex-wrap items-center gap-2" data-tour-preview="controls">
        <button
          type="button"
          onClick={() => setLive((value) => !value)}
          className="rounded-md primary-face bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground"
        >
          {live ? "Hide overlay" : "Show overlay"}
        </button>
        <select
          aria-label="Viewport"
          value={viewport}
          onChange={(event) => setViewport(event.target.value as TourViewport)}
          className="form-control rounded-md px-2 py-1.5 text-[12px]"
        >
          <option value="desktop">desktop ({stepsForViewport("desktop").length} stops)</option>
          <option value="mobile">mobile ({stepsForViewport("mobile").length} stops)</option>
        </select>
        <select
          aria-label="Placement"
          value={placement}
          onChange={(event) => setPlacement(event.target.value as TourPlacement)}
          className="form-control rounded-md px-2 py-1.5 text-[12px]"
        >
          {PLACEMENTS.map((side) => (
            <option key={side} value={side}>
              placement: {side}
            </option>
          ))}
        </select>
        <select
          aria-label="Anchor"
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
          className="form-control rounded-md px-2 py-1.5 text-[12px]"
        >
          {TARGETS.map((target) => (
            <option key={target.id} value={target.id}>
              anchor: {target.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Step"
          value={stepIndex}
          onChange={(event) => setStepIndex(Number(event.target.value))}
          className="form-control rounded-md px-2 py-1.5 text-[12px]"
        >
          {steps.map((entry, index) => (
            <option key={entry.id} value={index}>
              {index + 1}. {entry.title}
            </option>
          ))}
        </select>
      </section>

      {/* Every stop's real copy, readable without a database. A body that wraps past three
          lines at 390px is the thing to catch here. */}
      <section className="flex flex-col gap-3" data-tour-preview="copy">
        <h2 className="section-title">Every stop, as written</h2>
        {DEMO_TOUR_STEPS.map((entry, index) => (
          <article
            key={entry.id}
            data-tour-preview-step={entry.id}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="mb-1 flex items-baseline gap-2">
              <span className="type-machine text-[11px] text-faint">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-[15px] font-bold">{entry.title}</h3>
              {entry.viewports ? (
                <span className="ui-label-caps text-faint">{entry.viewports.join(" + ")} only</span>
              ) : null}
              {entry.handover ? (
                <span className="ui-label-caps text-primary">hands over</span>
              ) : null}
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{entry.body}</p>
          </article>
        ))}
      </section>

      <section className="flex flex-col gap-4" data-tour-preview="anchors">
        <h2 className="section-title">Fabricated anchors</h2>
        {TARGETS.map((target) => (
          <div key={target.id} className="flex flex-col gap-1">
            <p className="ui-label-caps text-faint">
              {target.label} — {target.note}
            </p>
            <div
              data-preview-target={target.id}
              className={`grid place-items-center rounded-xl border border-border bg-secondary text-[12px] text-muted-foreground ${target.className}`}
            >
              {target.label}
            </div>
          </div>
        ))}
      </section>

      {live && step ? (
        <TourOverlay
          phase="placed"
          geometry={geometry}
          centred={false}
          title={step.title}
          body={step.body}
          stepIndex={Math.min(stepIndex, steps.length - 1)}
          stepCount={steps.length}
          handover={Boolean(step.handover)}
          nextLabel={stepIndex === steps.length - 1 ? "Done" : "Next"}
          onNext={() => setStepIndex((value) => Math.min(value + 1, steps.length - 1))}
          onBack={() => setStepIndex((value) => Math.max(value - 1, 0))}
          onSkip={() => setLive(false)}
          popoverRef={popoverRef}
        />
      ) : null}
    </div>
  );
}
