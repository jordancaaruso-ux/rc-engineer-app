"use client";

import dynamic from "next/dynamic";

/**
 * The sheet surfaces, loaded only when a driver actually opens a Setup face.
 *
 * `SheetFillSurface` and everything hanging off it is the biggest client component in the app,
 * and the Setup face is one of three tabs on a row that a day view can render a dozen of. Static
 * imports would put the whole fill machinery into the bundle for `/analysis` and the session day
 * — pages whose first paint is a chart and a list — so these come across the wire on the tap that
 * needs them.
 *
 * `ssr: false` for the same reason the modals use it: these measure their own container and read
 * the pointer type before they can draw anything, so a server render is a blank box either way.
 */

const SheetSkeleton = () => (
  <div
    className="grid place-items-center rounded-lg border border-border bg-card text-[12px] text-muted-foreground"
    style={{ height: "40vh" }}
  >
    Opening the sheet…
  </div>
);

export const ReadOnlySheetSurface = dynamic(
  () =>
    import("@/components/setup/ReadOnlySheetSurface").then((m) => ({
      default: m.ReadOnlySheetSurface,
    })),
  { loading: SheetSkeleton, ssr: false }
);

export const SheetSetupEditorClient = dynamic(
  () =>
    import("@/components/setup/SheetSetupEditorClient").then((m) => ({
      default: m.SheetSetupEditorClient,
    })),
  { loading: SheetSkeleton, ssr: false }
);

export const LibrarySetupEditorClient = dynamic(
  () =>
    import("@/components/setup/LibrarySetupEditorClient").then((m) => ({
      default: m.LibrarySetupEditorClient,
    })),
  { loading: SheetSkeleton, ssr: false }
);

export const SetupSheetView = dynamic(
  () => import("@/components/runs/SetupSheetView").then((m) => ({ default: m.SetupSheetView })),
  { loading: SheetSkeleton, ssr: false }
);
