// Where a sealed product actually is: on the shelf, or out on a show.
//
// "Qty On Hand" has been carrying both meanings at once. Building a set takes
// the units off it, so the number means the storage room - but nothing records
// that those units still exist and are sitting on a wheel until the show
// closes. You cannot answer "how many Pitch Black ETBs do I own" without
// opening every open show and adding them back by hand, and a count that
// cannot be checked is a count that quietly drifts.
//
// Splitting it makes the two questions separate and both answerable:
//
//   onHand   what is in the storage room right now
//   onShows  committed to shows that have not been closed out yet
//   total    what the business owns, which is the number to inventory against
//
// Derived, not stored. A second stored column is a second thing to keep in
// step with the first, and the whole reason this exists is that one stored
// column already drifted. The lines are the source of truth: they are written
// when a set is built and settled when it closes, so adding them up can never
// disagree with them.

export type OpenLine = {
  productId: string;
  qty: number;
  qtyHit: number;
  /** The show this line belongs to has had its items returned. */
  returned: boolean;
  /** Store purchases were bought off the shelf, never committed to a wheel. */
  isStore?: boolean;
};

export type StockSplit = { onHand: number; onShows: number; total: number };

const n = (v: unknown) => {
  const x = Math.floor(Number(v));
  return Number.isFinite(x) ? x : 0;
};

/** Units of one product sitting on shows that have not been closed out.
 *
 *  Hit units are gone - someone won them - so only the unhit remainder is
 *  still yours. A closed show has already put its remainder back on the shelf,
 *  so counting it here would count those units twice. */
export function committed(lines: OpenLine[]): number {
  let out = 0;
  for (const l of lines || []) {
    if (l.returned || l.isStore) continue;
    const left = n(l.qty) - n(l.qtyHit);
    if (left > 0) out += left;
  }
  return out;
}

/** Group committed units by product, for a whole-table view in one pass. */
export function committedByProduct(lines: OpenLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines || []) {
    const id = String(l.productId || "");
    if (!id || l.returned || l.isStore) continue;
    const left = n(l.qty) - n(l.qtyHit);
    if (left > 0) out.set(id, (out.get(id) || 0) + left);
  }
  return out;
}

/** The three numbers for one product.
 *
 *  onHand is clamped because a negative shelf count is not a real state and
 *  would make total read lower than what is demonstrably out on a show. */
export function splitFor(onHandRaw: unknown, onShows: number): StockSplit {
  const onHand = Math.max(0, n(onHandRaw));
  const shows = Math.max(0, n(onShows));
  return { onHand, onShows: shows, total: onHand + shows };
}

/** Totals across the table, for the header tiles. */
export function totalSplit(
  products: { id: string; onHand: unknown }[],
  byProduct: Map<string, number>,
): StockSplit {
  let onHand = 0;
  let onShows = 0;
  for (const p of products || []) {
    const s = splitFor(p.onHand, byProduct.get(p.id) || 0);
    onHand += s.onHand;
    onShows += s.onShows;
  }
  return { onHand, onShows, total: onHand + onShows };
}
