import { notFound } from "next/navigation";
import { RollCenterStripPreview } from "@/components/rollCenter/RollCenterStripPreview";

/**
 * The computed-geometry strip, above a real page of paper.
 *
 * There is no A800RR blank checked into the repo — the debug blanks are Xray and Mugen — and the
 * only geometry pack that exists is the Awesomatix one. So this page pairs the two: an A800RR
 * snapshot drives the strip, and an Xray sheet supplies the paper underneath it. The numbers and
 * the composition are both real; only their pairing is fictional, which is the point of a page
 * that never touches an account.
 *
 * What it is here to answer: does the strip read as chrome above the sheet rather than a card
 * stacked on top of it, does the drawer fit on a phone, and does the roll centre visibly MOVE when
 * a shim value changes — the whole argument for putting it on an editable surface.
 */
export default async function DebugRollCenterStripPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <RollCenterStripPreview />;
}
