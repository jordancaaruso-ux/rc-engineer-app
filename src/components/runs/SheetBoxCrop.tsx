"use client";

import { useEffect, useState } from "react";
import type { ChangedBoxCrop } from "@/lib/setupCompare/changedBoxRegion";

/**
 * One changed box, shown where it sits on the driver's own setup sheet.
 *
 * ============================== WHAT THIS IS FOR ==============================
 *
 * The list of changes is what a driver reads. This is what they open when the list is not enough —
 * "Box 47 · upper left" means nothing on a sheet read off a PDF, but a picture of the spot, with the
 * caption the sheet already prints beside it, does.
 *
 * It opens one row at a time, from that row, and stays small. An earlier version put every changed
 * box on screen at once as full-width pictures, which pushed the list itself off the phone.
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
 * the same way the fill surface draws values. What it was is NOT drawn: the row this opened from is
 * already showing it, in type big enough to read.
 */

/** How tall a crop is drawn. Its width follows the crop's own shape, so the sheet is never stretched. */
const CROP_HEIGHT_PX = 40;

/** Held until the page picture arrives and its real shape is known. */
const PLACEHOLDER_ASPECT = 2.4;

type CropsState =
  | { kind: "loading" }
  | { kind: "none" }
  | {
      kind: "ready";
      modelId: string;
      /** The EDITION the crops came from, when not the primary blank — see `sheet-boxes`. */
      editionBlankId: string | null;
      byKey: Map<string, ChangedBoxCrop>;
    };

/**
 * The crops for a set of changed keys, or nothing at all.
 *
 * Nothing is the ordinary case, not an error: most chassis fill as a plain form and have no sheet
 * to draw. The caller shows its list and offers no picture.
 */
export function useSheetBoxCrops(carId: string | null | undefined, keys: string[]): CropsState {
  const [state, setState] = useState<CropsState>({ kind: "loading" });
  const keyList = keys.join(",");

  useEffect(() => {
    if (!carId || !keyList) {
      setState({ kind: "none" });
      return;
    }
    let cancelled = false;
    fetch(`/api/cars/${encodeURIComponent(carId)}/sheet-boxes?keys=${encodeURIComponent(keyList)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            sheetMode?: boolean;
            setupSheetModelId?: string;
            editionBlankId?: string | null;
            crops?: ChangedBoxCrop[];
          } | null
        ) => {
          if (cancelled) return;
          if (!d?.sheetMode || !d.setupSheetModelId || !d.crops?.length) {
            setState({ kind: "none" });
            return;
          }
          setState({
            kind: "ready",
            modelId: d.setupSheetModelId,
            editionBlankId: d.editionBlankId ?? null,
            byKey: new Map(d.crops.map((c) => [c.key, c] as const)),
          });
        }
      )
      .catch(() => {
        // The list is still there. A sheet that will not load is not worth an error.
        if (!cancelled) setState({ kind: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [carId, keyList]);

  return state;
}

export function SheetBoxCrop({
  modelId,
  editionBlankId,
  crop,
  value,
  showPage,
}: {
  modelId: string;
  /** The EDITION whose page picture the crop indexes into. Absent = the primary blank. */
  editionBlankId?: string | null;
  crop: ChangedBoxCrop;
  /** What the box says now. Drawn into the ring, because the cached sheet is blank. */
  value?: string;
  /** Naming the page is only worth the room when the changes are not all on the same one. */
  showPage?: boolean;
}) {
  /*
   * The frame's shape is the crop's shape, so the sheet is never stretched.
   *
   * Which means the page's own proportions have to be known, and they are not: Mugen's sheet is
   * landscape and Xray's is portrait, and nothing stored with a chassis records which. So the
   * picture is measured when it arrives and the frame settles then. Until it does, the frame holds
   * a placeholder shape and the ring stays hidden — a ring drawn against a guessed shape would sit
   * next to the box rather than on it, which is worse than a moment with no ring.
   */
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const aspect = pageSize
    ? (crop.crop.width * pageSize.w) / (crop.crop.height * pageSize.h)
    : PLACEHOLDER_ASPECT;

  return (
    <figure className="m-0 flex min-w-0 items-center gap-2">
      {/*
        Height sets the size; the shape follows the crop. `maxWidth` is the phone guard — a box that
        runs half way across a sheet would otherwise make a picture wider than the screen, and with
        the aspect ratio fixed the frame gives up height rather than distorting the sheet.
      */}
      <div
        className="relative min-w-0 overflow-hidden rounded-[3px] border border-border bg-[#E8E4DC]"
        style={{ height: CROP_HEIGHT_PX, aspectRatio: aspect, maxWidth: "100%" }}
      >
        {/*
          Blown up so the crop fills the frame, then shifted so its corner is the frame's corner.
          Sizes are percentages of the frame, so this holds at any width without measuring.
          eslint-disable: sized entirely by the crop, so next/image has nothing to optimise.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/setup-sheet-models/${modelId}/sheet-page?page=${crop.pageNumber}${editionBlankId ? `&blank=${encodeURIComponent(editionBlankId)}` : ""}`}
          alt=""
          className="absolute max-w-none select-none"
          style={{
            width: `${(1 / crop.crop.width) * 100}%`,
            left: `${(-crop.crop.x / crop.crop.width) * 100}%`,
            top: `${(-crop.crop.y / crop.crop.height) * 100}%`,
            height: `${(1 / crop.crop.height) * 100}%`,
          }}
          onLoad={(e) =>
            setPageSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
          draggable={false}
        />

        {pageSize ? (
          <div
            className="absolute"
            style={{
              left: `${crop.box.x * 100}%`,
              top: `${crop.box.y * 100}%`,
              width: `${crop.box.width * 100}%`,
              height: `${crop.box.height * 100}%`,
              // Makes the box a size container, so the value inside can be sized from the box's own
              // height (`cqh`). A setup-sheet box is a few pixels tall even on a crop, and a fixed
              // font size either overflows it or is unreadable depending on the sheet.
              containerType: "size",
            }}
          >
            {/*
              The ring is drawn OUTSIDE the box, because a setup-sheet box is a few pixels tall even
              on a crop and a border inside it would swallow the value.
            */}
            <div
              className="absolute inset-0 rounded-[2px]"
              style={{
                boxShadow: "0 0 0 1.5px rgba(255, 214, 10, 0.95), 0 0 0 4px rgba(255, 214, 10, 0.22)",
                background: "rgba(255, 214, 10, 0.18)",
              }}
            />
            {value ? (
              <span
                className="absolute inset-0 flex items-center justify-center overflow-hidden whitespace-nowrap px-[1px] font-semibold leading-none text-black"
                style={{ fontSize: "75cqh" }}
              >
                {value}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {showPage ? (
        <figcaption className="micro-caps text-faint">
          Page {crop.pageNumber}
        </figcaption>
      ) : null}
    </figure>
  );
}
