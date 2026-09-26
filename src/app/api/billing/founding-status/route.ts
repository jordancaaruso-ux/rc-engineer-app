import { NextResponse } from "next/server";
import { getFoundingOfferView, type FoundingOfferView } from "@/lib/billing/foundingOffer";
import { getVisitorPriceCurrency } from "@/lib/billing/visitorCurrency";

export const dynamic = "force-dynamic";

/**
 * What the founding offer is doing right now, for the landing page (`public/landing/index.html`).
 * The landing is a static file, so it can't know the batch on sale, when seats run out, or which
 * currency this visitor is priced in; its founding band stays hidden until this answers with an
 * offer, and stays hidden if it fails. Priced like the landing's plan cards: US$ in the US, € in the
 * euro area, A$ elsewhere, and only once the plans themselves are.
 *
 * Public (middleware exempts it) and read-only. Memoised briefly per instance and currency, so a
 * busy launch morning costs one seat count every few seconds, not one per visitor.
 */
const memo = new Map<string, { at: number; offer: FoundingOfferView | null }>();
const MEMO_MS = 15_000;

export async function GET(): Promise<Response> {
  const currency = await getVisitorPriceCurrency();
  const now = Date.now();
  let hit = memo.get(currency);
  if (!hit || now - hit.at > MEMO_MS) {
    const offer = await getFoundingOfferView(currency).catch((error) => {
      console.error("[founding-status] could not read the offer", error);
      return null;
    });
    hit = { at: now, offer };
    memo.set(currency, hit);
  }
  return NextResponse.json({ offer: hit.offer }, { headers: { "Cache-Control": "no-store" } });
}
