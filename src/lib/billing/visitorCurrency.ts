import "server-only";
import { headers } from "next/headers";
import { priceCurrencyForCountry, type PriceCurrency } from "@/lib/billing/priceCurrencyLogic";

/**
 * The currency this request's visitor is priced in, from the country Vercel's edge stamps on every
 * request. No header (local dev, a request that never crossed Vercel's edge) means AUD.
 */
export async function getVisitorPriceCurrency(): Promise<PriceCurrency> {
  const h = await headers();
  return priceCurrencyForCountry(h.get("x-vercel-ip-country"));
}
