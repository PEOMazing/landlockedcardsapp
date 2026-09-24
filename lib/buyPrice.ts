// What a single is carried at on the cost side.
//
// Most of these cards did not arrive one at a time with a receipt. They came in
// collections, garage lots and trades, so there is no per-card number to look
// up, and leaving Buy Price blank means every margin the app works out on a
// single is against a cost of nothing. A flat percentage of the card's own comp
// is a cost basis that at least moves with what the card is: a $200 card gets a
// bigger share of the lot than a $1 bulk rare, which is roughly how the lot was
// priced in the first place.
//
// It is an estimate and it should stay easy to overwrite by hand on any card
// where the real number is known.

export const DEFAULT_BUY_PCT = 0.8;

// Money, so two decimals. A card with no comp gets nothing rather than a zero:
// zero is a real cost basis that reads as "this was free", and that is a worse
// lie than an empty cell.
export function buyPriceFrom(comp: number | null | undefined, pct: number): number | null {
  const c = Number(comp);
  const p = Number(pct);
  if (!Number.isFinite(c) || c <= 0) return null;
  if (!Number.isFinite(p) || p <= 0) return null;
  return Math.round(c * p * 100) / 100;
}

// Already right, to the cent. Worth checking before writing, because a backfill
// over a whole collection is mostly cards that have not moved and every skipped
// write is a write the run does not have to find time for.
export function buyPriceIsCurrent(existing: number | null | undefined, want: number | null): boolean {
  if (want === null) return true;
  const e = Number(existing);
  return Number.isFinite(e) && Math.round(e * 100) === Math.round(want * 100);
}
