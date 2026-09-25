import { CONDITION_NAMES, floorKey } from "./tcgListings";

// TCGplayer's market price for a specific printing AND condition.
//
// This is the number on the product page once you pick a condition from the
// filter, and it is the right thing to compare anybody else's valuation
// against, because a valuation is a claim about market price.
//
// It is not the same as either number we already had:
//
//   tcgcsv marketPrice   per printing, condition-blind. Effectively NM.
//   listing floor        the cheapest live ask. One seller, not a market.
//   pricepoints          what copies in this condition have been changing
//                        hands at. This file.
//
// Sold medians remain the better answer to "what will this actually sell for
// today", because a market price is a trailing average and lags a card that is
// moving. Both are worth having and they answer different questions, so this
// sits alongside conditionSoldComp rather than replacing it.

const PRICEPOINTS = "https://mpapi.tcgplayer.com/v2/product";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; LandLockedCards/1.0; +https://landlockedcards.app)",
  "Accept": "application/json",
};
const TTL = 1000 * 60 * 60 * 6;

export type PricePoint = {
  /** the condition-specific market price, 0 when TCGplayer has none */
  market: number;
  /** the median of what is currently listed, for context */
  listedMedian: number;
};
/** keyed "<Printing>|<Condition>", the same key shape as the listing floors */
export type PricePointMap = Map<string, PricePoint>;

const cache = new Map<number, { at: number; data: PricePointMap }>();

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

// Pure, so the shapes this endpoint really returns can be tested without
// calling it. Field names are read defensively: this is an undocumented
// endpoint and the only contract we have is what it happened to send back.
export function bucketPricePoints(rows: any[]): PricePointMap {
  const data: PricePointMap = new Map();
  for (const x of rows || []) {
    const printing = String(x?.printingType ?? x?.printing ?? "").trim();
    const condition = String(x?.conditionType ?? x?.condition ?? "").trim();
    if (!printing || !condition) continue;
    const market = num(x?.marketPrice ?? x?.market);
    const listedMedian = num(x?.listedMedianPrice ?? x?.listedMedian);
    if (market === 0 && listedMedian === 0) continue;
    data.set(floorKey(printing, condition), { market, listedMedian });
  }
  return data;
}

export async function pricePoints(productId: number, fresh = false): Promise<PricePointMap | null> {
  const hit = cache.get(productId);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.data;

  try {
    const res = await fetch(`${PRICEPOINTS}/${productId}/pricepoints`, {
      cache: "no-store",
      headers: HEADERS,
    });
    if (!res.ok) return null;
    const d = await res.json();
    const rows: any[] = Array.isArray(d) ? d : d?.results || d?.result || [];
    const data = bucketPricePoints(rows);
    if (data.size === 0) return null;
    cache.set(productId, { at: Date.now(), data });
    return data;
  } catch {
    // Someone else's undocumented endpoint. A miss falls back to the sold
    // median rather than failing the whole quote.
    return null;
  }
}

/** Market price for exactly the printing and condition we are asking about.
 *  No cross-condition fallback: standing in a Near Mint price for a Damaged
 *  card is the mistake this whole module exists to stop. */
export async function conditionMarket(
  productId: number, printing: string, condition: string, fresh = false
): Promise<PricePoint | null> {
  const name = CONDITION_NAMES[condition];
  if (!name) return null;
  const map = await pricePoints(productId, fresh);
  if (!map) return null;
  return map.get(floorKey(printing, name)) || null;
}
