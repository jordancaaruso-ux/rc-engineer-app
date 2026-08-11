import Link from "next/link";
import { notFound } from "next/navigation";
import { DEBUG_SHEET_BLANKS, isDebugSheetBlankId, type DebugSheetBlankId } from "@/lib/setupSheetModels/debugSheetBlanks";
import { SheetFillSurface } from "@/components/setup/SheetFillSurface";
import { SheetExportButton } from "@/components/setup/SheetExportButton";

/**
 * Filling a real manufacturer setup sheet, on a phone.
 *
 * This is here to answer one question before anything is committed to the database: does tapping
 * box to box on an actual 200-box A4 sheet feel better than answering the same questions one at a
 * time? It cannot be answered from a desktop viewport or a mock — it needs a real sheet, a real
 * phone, and preferably a real pit table.
 *
 * The page itself is deliberately tiny. The box list and the page image are both fetched by the
 * browser, because passing a 200-box sheet through the page as a prop made the page fail to load
 * about one time in three. Nothing is written server-side: values live in the browser, so a
 * session survives a reload but touches no account, no car, and no setup.
 */
export default async function DebugSheetFillPage({
  searchParams,
}: {
  searchParams: Promise<{ blank?: string; mode?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { blank, mode } = await searchParams;
  const id: DebugSheetBlankId = isDebugSheetBlankId(blank ?? "") ? (blank as DebugSheetBlankId) : "xray-x4-2026";
  const chosen = DEBUG_SHEET_BLANKS[id];
  // `?mode=name` is the founder's side of the same surface — tapping a box types what the box IS
  // rather than what is in it. Here for the same reason as the rest of this page: to try it on a
  // real 200-box sheet before it writes to a schema every driver on that chassis reads.
  const naming = mode === "name";

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-3 p-3 pb-24">
      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{chosen.label}</h1>
        <p className="text-[13px] text-muted-foreground">{chosen.note}. Nothing is saved to your account.</p>
        <nav className="flex flex-wrap gap-1.5">
          {Object.entries(DEBUG_SHEET_BLANKS).map(([key, meta]) => (
            <Link
              key={key}
              href={`/debug/sheet-fill?blank=${key}${naming ? "&mode=name" : ""}`}
              className={`rounded-full border px-3 py-1.5 text-[13px] ${
                key === id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-secondary text-muted-foreground"
              }`}
            >
              {meta.label}
            </Link>
          ))}
        </nav>
        <nav className="flex flex-wrap gap-1.5">
          {[
            { key: "fill", label: "Fill it in", href: `/debug/sheet-fill?blank=${id}` },
            { key: "name", label: "Name the boxes", href: `/debug/sheet-fill?blank=${id}&mode=name` },
          ].map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={`rounded-full border px-3 py-1.5 text-[13px] ${
                (tab.key === "name") === naming
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-secondary text-muted-foreground"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>

      <SheetFillSurface
        key={`${id}:${naming ? "name" : "fill"}`}
        mode={naming ? "name" : "fill"}
        pageImageUrl={`/api/debug/sheet-blank?id=${id}`}
        planUrl={`/api/debug/sheet-plan?id=${id}`}
        storageKey={naming ? `debug-sheet-name:${id}` : `debug-sheet-fill:${id}`}
      />

      {naming ? null : (
        <SheetExportButton
          exportUrl={`/api/debug/sheet-export?id=${id}`}
          storageKey={`debug-sheet-fill:${id}`}
          filename={`${id}-filled.pdf`}
        />
      )}

      <p className="text-[12px] leading-relaxed text-faint">
        {naming ? (
          <>
            Tap a box to zoom to it, then type what that box is — the printed caption beside it is
            the whole point of naming on the sheet. A box turns green once it has a name. Nothing
            here is saved: this is the same surface the founder&rsquo;s naming page uses, on a
            fixture sheet, so it can be tried without writing to a chassis anyone is using.
          </>
        ) : (
          <>
            Tap a box to zoom to it, then use the arrows or the keyboard’s next key to step down the
            sheet in reading order — the aim is never having to pinch. The download is the same
            blank with your values written into it, drawn by your PDF reader rather than by us.
          </>
        )}
      </p>
    </main>
  );
}
