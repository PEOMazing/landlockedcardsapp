import { CONDITION_NAMES, floorKey } from "./tcgListings";

// TCGplayer's market price per printing AND condition.
//
// This is the "Market Price" in the Price Points panel on a product page once
// the condition filter is set, and it is the right number to compare anybody
// else's valuation against, because a valuation is a claim about market price.
//
// Three different numbers get called "the price" and they answer different
// questions. Keeping them straight is the whole point of this file:
//
//   tcgcsv marketPrice   per printing, condition-blind. Effectively NM.
//   listing floor        the cheapest live ask. One seller, not a market.
//   price guide          market price for this printing in this condition.
//   sold median          what copies actually changed hands for recently.
//
// The last two both belong in a comparison. Market price is what a valuation
// is claiming, so it is the like-for-like check on somebody's Collectr export.
// The sold median is what a copy will move for today, which is the number that
// matters when the card is going on a stream. Neither replaces the other.
//
// Sourced from the price-guide endpoint rather than /pricepoints, which looks
// like the obvious candidate and is not: /pricepoints breaks out by printing
// only and reports the Near Mint price for every condition. The per-set guide
// is also cheaper - one call covers every card in a set, so a 260-card list
// spanning 80 sets costs 80 requests instead of 260.

const GUIDE = "https://infinite-api.tcgplayer.com/priceguide/set";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; LandLockedCards/1.0; +https://landlockedcards.app)",
  "Accept": "application/json",
};
const TTL = 1000 * 60 * 60 * 6;

export type PricePoint = {
  /** market price for this printing in this condition */
  market: number;
  /** cheapest live ask on the product, for context. Not condition-specific. */
  low: number;
  /** recorded sales behind the market price, often 0 on vintage */
  sales: number;
};
/** keyed "<productId>|<Printing>|<Condition>" */
export type GuideMap = Map<string, PricePoint>;

const cache = new Map<number, { at: number; data: GuideMap }>();

export const guideKey = (productId: number, printing: string, condition: string) =>
  `${productId}|${floorKey(printing, condition)}`;

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

// The guide writes condition and printing joined into one field - "Moderately
// Played Reverse Holofoil" - and repeats the printing on its own. Splitting on
// the printing suffix is what recovers the condition, and it has to be the
// suffix rather than a word list: "Holofoil" appears in both halves of
// "Near Mint Holofoil" and a naive replace eats the wrong one.
export function splitGuideCondition(condition: string, printing: string): string {
  const c = String(condition || "").trim();
  const p = String(printing || "").trim();
  if (p && c.length > p.length && c.slice(-p.length) === p) return c.slice(0, -p.length).trim();
  return c;
}

// Pure, so the shapes this endpoint really returns can be tested without
// calling it.
export function bucketPriceGuide(rows: any[]): GuideMap {
  const data: GuideMap = new Map();
  for (const x of rows || []) {
    const productId = Number(x?.productID ?? x?.productId);
    if (!Number.isFinite(productId) || productId <= 0) continue;
    const printing = String(x?.printing || "").trim();
    const condition = splitGuideCondition(x?.condition, printing);
    if (!printing || !condition) continue;
    const market = num(x?.marketPrice);
    if (market === 0) continue;
    data.set(guideKey(productId, printing, condition), {
      market,
      low: num(x?.lowPrice),
      sales: Math.max(0, Number(x?.sales) || 0),
    });
  }
  return data;
}

async function loadGuide(groupId: number, fresh = false): Promise<GuideMap | null> {
  const hit = cache.get(groupId);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.data;

  try {
    const res = await fetch(`${GUIDE}/${groupId}/cards/?rows=5000`, {
      cache: "no-store",
      headers: HEADERS,
    });
    if (!res.ok) return null;
    const d = await res.json();
    const data = bucketPriceGuide(d?.result || []);
    if (data.size === 0) return null;
    cache.set(groupId, { at: Date.now(), data });
    return data;
  } catch {
    // Someone else's undocumented endpoint. A miss leaves the caller with the
    // sold median rather than failing the whole quote.
    return null;
  }
}

/** Market price for exactly the printing and condition asked about. No
 *  cross-condition fallback: standing a Near Mint price in for a Damaged card
 *  is the mistake this module exists to stop. */
export async function conditionMarket(
  groupId: number, productId: number, printing: string, condition: string, fresh = false
): Promise<PricePoint | null> {
  const name = CONDITION_NAMES[condition];
  if (!name) return null;
  const map = await loadGuide(groupId, fresh);
  if (!map) return null;
  return map.get(guideKey(productId, printing, name)) || null;
}
