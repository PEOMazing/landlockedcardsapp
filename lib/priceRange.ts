// Price range filtering for singles, shared by the inventory table and the
// show picker so a range typed in either place means the same thing.

// A typed bound. "$25", "25.50" and " 25 " all mean 25. An empty box, a stray
// "$" on its own, or anything that is not a number means no bound at all, so
// the filter stays off until there is a real number to filter on.
export function priceBound(s: string): number | null {
  const t = (s || "").replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Both ends are inclusive: 5 to 20 keeps a card comped at exactly 20.
//
// A card with no comp is not free, so it drops out of any range rather than
// sliding under every max. The page says how many are being held back that
// way, since an unpriced card is usually one that still needs a comp, not one
// that belongs in the cheap box.
export function inPriceRange(
  comp: number | null | undefined,
  lo: number | null,
  hi: number | null,
): boolean {
  if (lo === null && hi === null) return true;
  if (comp === null || comp === undefined) return false;
  if (lo !== null && comp < lo) return false;
  if (hi !== null && comp > hi) return false;
  return true;
}

// A range typed backwards, like 50 to 10, can never match anything. Worth
// saying out loud rather than showing an empty table and letting someone hunt
// for the card that "disappeared".
export function rangeBackwards(lo: number | null, hi: number | null): boolean {
  return lo !== null && hi !== null && lo > hi;
}
