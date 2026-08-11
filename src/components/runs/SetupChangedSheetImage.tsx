"use client";

import { useEffect, useState } from "react";
import type { ChangedBoxRegion } from "@/lib/setupCompare/changedBoxRegion";
import type { SetupChangedRow } from "@/lib/setupCompare/changedSincePrevious";

/**
 * What changed since the last run, drawn on the driver's own setup sheet.
 *
 * ============================== WHAT THIS REPLACES ==============================
 *
 * A list. On a chassis read off a PDF that list says "Box 47 · page 1, upper left: 4.5 → 5.0",
 * which is unusable — you would have to count boxes on the paper to find box 47. The sheet already
 * has the caption printed beside every box, so putting a ring round the box says what changed
 * without anybody having to name it first.
 *
 * ============================== HOW THE CROP IS DONE ==============================
 *
 * The page picture is the whole page, already rendered and cached for the fill surface. Cropping it
 * is CSS: the image is blown up so the crop fills the frame, then shifted so the crop's corner
 * lands at the frame's corner. Nothing is rendered per run, and the same picture is reused by every
 * driver on that chassis.
 *
 * The picture is the BLANK sheet — every driver's copy is cleared before it is cached, or one
 * uploader's setup would print under everyone else's. So the new value is drawn into the ring here,
 * the same way the fill surface draws values, and the old one sits under it struck through.
 */
export function SetupChangedSheetImage({
  carId,
  rows,
}: {
  carId: string;
  /** The rows already computed for the list. Their keys are the boxes to ring. */
  rows: SetupChangedRow[];
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "none" }
    | { kind: "ready"; modelId: string; regions: ChangedBoxRegion[] }
  >({ kind: "loading" });

  const keys = rows.map((r) => r.key).join(",");

  useEffect(() => {
    if (!carId || !keys) {
      setState({ kind: "none" });
      return;
    }
    let cancelled = false;
    fetch(`/api/cars/${encodeURIComponent(carId)}/sheet-boxes?keys=${encodeURIComponent(keys)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { sheetMode?: boolean; setupSheetModelId?: string; regions?: ChangedBoxRegion[] } | null) => {
        if (cancelled) return;
        if (!d?.sheetMode || !d.setupSheetModelId || !d.regions?.length) {
          setState({ kind: "none" });
          return;
        }
        setState({ kind: "ready", modelId: d.setupSheetModelId, regions: d.regions });
      })
      .catch(() => {
        // The list is still there underneath. A sheet that will not load is not worth an error.
        if (!cancelled) setState({ kind: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [carId, keys]);

  if (state.kind !== "ready") return null;

  const valueByKey = new Map(rows.map((r) => [r.key, r] as const));
  // One page can be cut into several pictures, so the page number alone is not a key — and the
  // caption naming the page is only worth showing when there is more than one page in play.
  const spansPages = new Set(state.regions.map((r) => r.pageNumber)).size > 1;

  return (
    <div className="space-y-2">
      {state.regions.map((region) => (
        <SheetCrop
          key={`${region.pageNumber}:${region.crop.x},${region.crop.y}`}
          modelId={state.modelId}
          region={region}
          valueByKey={valueByKey}
          showPage={spansPages}
        />
      ))}
    </div>
  );
}

function SheetCrop({
  modelId,
  region,
  valueByKey,
  showPage,
}: {
  modelId: string;
  region: ChangedBoxRegion;
  valueByKey: Map<string, SetupChangedRow>;
  showPage: boolean;
}) {
  /*
   * The frame's shape is the crop's shape, so the sheet is never stretched.
   *
   * Which means the page's own proportions have to be known, and they are not: Mugen's sheet is
   * landscape and Xray's is portrait, and nothing stored with a chassis records which. So the
   * picture is measured when it arrives and the frame settles then. Until it does, the frame holds
   * a placeholder shape and the rings stay hidden — a ring drawn against a guessed shape would sit
   * next to the box rather than on it, which is worse than a moment with no rings.
   */
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const framePaddingTop = pageSize
    ? ((region.crop.height * pageSize.h) / (region.crop.width * pageSize.w)) * 100
    : 42;

  return (
    <figure className="m-0 overflow-hidden rounded-md border border-border bg-[#E8E4DC]">
      <div className="relative w-full" style={{ paddingTop: `${framePaddingTop}%` }}>
        <div className="absolute inset-0 overflow-hidden">
          {/*
            Blown up so the crop fills the frame, then shifted so its corner is the frame's corner.
            Sizes are percentages of the frame, so this holds at any width without measuring.
            eslint-disable: sized entirely by the crop, so next/image has nothing to optimise.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/setup-sheet-models/${modelId}/sheet-page?page=${region.pageNumber}`}
            alt=""
            className="absolute max-w-none select-none"
            style={{
              width: `${(1 / region.crop.width) * 100}%`,
              left: `${(-region.crop.x / region.crop.width) * 100}%`,
              top: `${(-region.crop.y / region.crop.height) * 100}%`,
              height: `${(1 / region.crop.height) * 100}%`,
            }}
            onLoad={(e) =>
              setPageSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            draggable={false}
          />

          {(pageSize ? region.boxes : []).map((b) => {
            const row = valueByKey.get(b.key);
            return (
              <div
                key={b.key}
                className="absolute"
                style={{
                  left: `${b.x * 100}%`,
                  top: `${b.y * 100}%`,
                  width: `${b.width * 100}%`,
                  height: `${b.height * 100}%`,
                  // Makes the box a size container, so the value inside can be sized from the box's
                  // own height (`cqh`). A setup-sheet box is a few pixels tall even on a crop, and a
                  // fixed font size either overflows it or is unreadable depending on the sheet.
                  containerType: "size",
                }}
              >
                {/*
                  The ring is drawn OUTSIDE the box, because a setup-sheet box is a few pixels tall
                  even on a crop and a border inside it would swallow the value.
                */}
                <div
                  className="absolute inset-0 rounded-[2px]"
                  style={{
                    boxShadow:
                      "0 0 0 2px rgba(255, 214, 10, 0.95), 0 0 0 5px rgba(255, 214, 10, 0.22)",
                    background: "rgba(255, 214, 10, 0.18)",
                  }}
                />
                {row?.value ? (
                  <span
                    className="absolute inset-0 flex items-center justify-center overflow-hidden whitespace-nowrap px-[1px] font-semibold leading-none text-black"
                    style={{ fontSize: "70cqh" }}
                  >
                    {row.value}
                  </span>
                ) : null}
                {/*
                  What it was, as a sticker rather than loose text.
                  Below the ring is the only place with room, and that is where the sheet prints its
                  next caption — so bare text landed on top of "OUTSIDE TEMPERATURE°C:" and read as
                  a rendering fault. An opaque chip reads as something added to the paper.
                */}
                {row?.previousValue ? (
                  <span
                    className="absolute left-0 top-full mt-[2px] whitespace-nowrap rounded-[2px] px-[3px] py-[1px] leading-none text-neutral-700 line-through"
                    style={{
                      fontSize: "55cqh",
                      background: "rgba(255, 255, 255, 0.94)",
                      boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.14)",
                    }}
                  >
                    {row.previousValue}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {showPage ? (
        <figcaption className="border-t border-border bg-card px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          Page {region.pageNumber}
        </figcaption>
      ) : null}
    </figure>
  );
}
