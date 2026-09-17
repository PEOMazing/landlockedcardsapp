// Live TCGplayer listing prices, per printing AND per condition.
//
// This is the number you get on tcgplayer.com when you look a card up and pick
// a condition, and it is the only price in this codebase that is actually
// specific to the card we hold.
//
// Everything else we had was condition-blind. tcgcsv, the nightly mirror,
// publishes lowPrice/midPrice/marketPrice broken out by printing only, and the
// gap that leaves is not small. Measured against live listings on 2026-09-17:
//
//   Leafeon 7/100 Majestic Dawn, Reverse Holofoil
//     tcgcsv marketPrice  $44.05
//     NM Reverse floor    $98.01   <- the card we actually hold
//
//   Charizard G Lv.X, Supreme Victors #143, Holofoil
//     tcgcsv marketPrice  $450.72  (happens to equal the NM floor)
//     LP floor            $250.00  <- the card we actually hold
//     DM floor            $49.99
//
// A single blended number cannot stand in for that spread, which is why comps
// built off it were wrong in both directions.

const LISTINGS = "https://mp-search-api.tcgplayer.com/v1/product";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; LandLockedCards/1.0; +https://landlockedcards.app)",
  "Content-Type": "application/json",
  "Accept": "application/json",
};
const TTL = 1000 * 60 * 60 * 6;

// Our condition codes to the strings TCGplayer puts on a listing.
export const CONDITION_NAMES: Record<string, string> = {
  NM: "Near Mint", Raw: "Near Mint", LP: "Lightly Played",
  MP: "Moderately Played", HP: "Heavily Played", DM: "Damaged",
};

export type Floor = {
  low: number;
  count: number;
  /** the cheapest few asks, kept so a screen can show the spread.
   *  A graded slab filed against the raw card is invisible to this feed - no
   *  grade field, no listing title - and price alone cannot separate one from
   *  a genuine bargain. Measured across the whole collection, dropping a
   *  suspiciously cheap listing moved 14 of 98 cards, some by 10x, because on
   *  thin vintage cards the cheapest ask is often the only real one. So the
   *  spread is shown rather than filtered: a human spots $70 sitting under
   *  four asks at $95-$100 instantly. */
  prices: number[];
};
// keyed "<Printing>|<Condition>", e.g. "Reverse Holofoil|Near Mint"
export type FloorMap = Map<string, Floor>;

// How far under the next ask the cheapest one has to sit before it is worth a
// second look.
export const ODD_LOW_GAP = 0.75;

// Is the cheapest ask out of step with the rest of the board?
//
// This only flags. It deliberately does not price, and that distinction is the
// whole lesson of the Blissey Prime: its cheapest "Near Mint" ask was a CGC 7.5
// slab filed against the raw card, and nothing in the feed says so. Acting on
// this signal was tested and thrown out - dropping the flagged ask moved 14 of
// 98 cards, one of them 10x, because on thin vintage cards the cheapest ask is
// often the only honest one. Flagging costs nothing when it is wrong.
export function oddLowAsk(prices: number[]): boolean {
  const p = (prices || []).filter((n) => Number(n) > 0).sort((a, b) => a - b);
  return p.length > 1 && p[0] < p[1] * ODD_LOW_GAP;
}

const cache = new Map<number, { at: number; data: FloorMap }>();

export const floorKey = (printing: string, condition: string) => `${printing}|${condition}`;

// Bucket raw listing rows into a floor per printing+condition. Pure, so the
// shapes this endpoint really returns can be tested without calling it.
export function bucketListings(rows: any[]): FloorMap {
  const data: FloorMap = new Map();
  for (const x of rows || []) {
    const price = Number(x?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const printing = String(x?.printing || "");
    const condition = String(x?.condition || "");
    if (!printing || !condition) continue;
    const k = floorKey(printing, condition);
    const cur = data.get(k);
    if (!cur) data.set(k, { low: price, count: 1, prices: [price] });
    else data.set(k, { low: Math.min(cur.low, price), count: cur.count + 1, prices: [...cur.prices, price] });
  }
  // cheapest first, capped: past the first handful it is noise
  for (const [k, v] of data) data.set(k, { ...v, prices: v.prices.sort((a, b) => a - b).slice(0, 6) });
  return data;
}

// One request per product rather than one per condition. The server-side
// conditionNames filter on this endpoint silently returns zero results when
// the key is not exactly what it expects, and a filter that fails closed would
// look identical to a card with no listings. Pulling the page and bucketing
// here cannot fail that way, and it costs one call instead of five.
// `fresh` skips the cache. It exists because the cache and the word "live"
// cannot both be true: a sticker scanned at the table was reading a floor that
// could be six hours old while the screen said live. The background rotation
// still takes the cached path - it is refetching everything on a loop anyway,
// and hammering the endpoint 40 times every 15 minutes for data it already has
// is how we lose access to it.
export async function conditionFloors(productId: number, fresh = false): Promise<FloorMap | null> {
  const hit = cache.get(productId);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.data;

  try {
    const res = await fetch(`${LISTINGS}/${productId}/listings`, {
      method: "POST",
      cache: "no-store",
      headers: HEADERS,
      body: JSON.stringify({
        filters: { term: { sellerStatus: "Live", channelId: 0 }, range: { quantity: { gte: 1 } } },
        from: 0,
        size: 50, // sorted cheapest first, so the floor of every condition is in here
        sort: { field: "price+shipping", order: "asc" },
        context: { shippingCountry: "US", cart: {} },
      }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const rows: any[] = d?.results?.[0]?.results || [];
    if (rows.length === 0) return null;

    const data = bucketListings(rows);
    if (data.size === 0) return null;
    cache.set(productId, { at: Date.now(), data });
    return data;
  } catch {
    // Someone else's undocumented endpoint. If it moves or rate-limits, the
    // caller falls back to the mirror rather than the whole refresh failing.
    return null;
  }
}

// The floor for exactly what we hold. No cross-condition or cross-printing
// fallback on purpose: a Damaged price standing in for a Near Mint card is
// worse than admitting we do not know, and this whole module exists because
// substituting a near-enough number is how the comps went wrong.
export async function conditionFloor(
  productId: number, printing: string, condition: string, fresh = false
): Promise<Floor | null> {
  const name = CONDITION_NAMES[condition];
  if (!name) return null;
  const map = await conditionFloors(productId, fresh);
  if (!map) return null;
  return map.get(floorKey(printing, name)) || null;
}
