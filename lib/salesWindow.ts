// Which sales count toward a comp, and why.
//
// Deliberately free of imports so the server pricing path and the client
// screens can both use it. That is the whole point: the scan page explains a
// price to someone about to say it out loud, and an explanation computed from
// a second copy of these rules would drift from the price it claims to
// justify. This module is the only copy.

export type Sale = { date: string; price: number; qty?: number };

// How recent a sale has to be to count as evidence of what the card is worth
// now. Past this, the sale describes a market that has since moved on and the
// live asking prices are the better answer.
export const FRESH_DAYS = 30;

// Sales this far below the strongest recent sale are thrown out before the
// median is taken. Sold data can be pushed down on purpose: list a card far
// under value, have it bought immediately, and the recorded sale drags the
// published average with it. Nothing legitimate sells at a fifth of what the
// same card in the same condition sold for days earlier.
export const WASH_FRACTION = 0.2;

export function dropWashSales<T extends { price: number }>(sales: T[]): T[] {
  const real = (sales || []).filter((s) => Number(s?.price) > 0);
  if (real.length < 2) return real;
  const high = Math.max(...real.map((s) => s.price));
  const kept = real.filter((s) => s.price >= high * WASH_FRACTION);
  // Never discard everything: if the whole window looks like an outlier the
  // problem is the comparison, not the sales.
  return kept.length > 0 ? kept : real;
}

export function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// What a card is listed at, as a whole dollar.
//
// A comp is a number somebody says out loud across a table, and the cents on
// it are noise that nobody collects: $94.24 is $95. Always up, never down, so
// the asking price is never below what the evidence actually supports, and
// rounding to cents first so a float landing on $95.0000001 does not walk up
// to $96.
export const roundUpDollar = (n: number): number => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return v;
  return Math.ceil(round2(v));
};

export const windowCutoff = (now: Date = new Date()): string =>
  new Date(now.getTime() - FRESH_DAYS * 86400000).toISOString().slice(0, 10);

export type JudgedSale = Sale & {
  /** counted toward the comp */
  used: boolean;
  /** why it did not count, when it did not */
  excluded?: "old" | "outlier";
  /** this is the sale the median landed on */
  isMedian?: boolean;
};

// Tag every sale with whether it counted and why, so a screen can show the
// working rather than asserting a number. Same filters, same order, same
// module as the pricing.
export function judgeSales(detail: Sale[], now: Date = new Date()): JudgedSale[] {
  const all = (detail || []).filter((s) => Number(s?.price) > 0);
  if (all.length === 0) return [];
  const kept = new Set(dropWashSales(all));
  const cutoff = windowCutoff(now);

  const judged: JudgedSale[] = all.map((s) => {
    if (!kept.has(s)) return { ...s, used: false, excluded: "outlier" };
    if (String(s.date) < cutoff) return { ...s, used: false, excluded: "old" };
    return { ...s, used: true };
  });

  // Mark the sale the median actually landed on. With an even count the median
  // is between two sales and belongs to neither, so nothing is marked - better
  // than pointing at an arbitrary one of the pair.
  const used = judged.filter((j) => j.used);
  if (used.length % 2 === 1) {
    const mid = medianOf(used.map((u) => u.price));
    const hit = used.find((u) => u.price === mid);
    if (hit) hit.isMedian = true;
  }
  return judged.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
