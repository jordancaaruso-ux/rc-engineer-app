import { NextResponse } from "next/server";
import { getFoundingOfferView, type FoundingOfferView } from "@/lib/billing/foundingOffer";

export const dynamic = "force-dynamic";

/**
 * What the founding offer is doing right now, for the landing page (`public/landing/index.html`).
 * The landing is a static file, so it can't know the batch on sale or when seats run out; its
 * founding band stays hidden until this answers with an offer, and stays hidden if it fails.
 *
 * Public (middleware exempts it) and read-only. Memoised briefly per instance so a busy launch
 * morning costs one seat count every few seconds, not one per visitor.
 */
let memo: { at: number; offer: FoundingOfferView | null } | null = null;
const MEMO_MS = 15_000;

export async function GET(): Promise<Response> {
  const now = Date.now();
  if (!memo || now - memo.at > MEMO_MS) {
    const offer = await getFoundingOfferView().catch((error) => {
      console.error("[founding-status] could not read the offer", error);
      return null;
    });
    memo = { at: now, offer };
  }
  return NextResponse.json({ offer: memo.offer }, { headers: { "Cache-Control": "no-store" } });
}
