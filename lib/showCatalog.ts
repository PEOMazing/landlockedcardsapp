// The card show directory: every in-stock single, searchable by set or by
// Pokemon, with its picture, sticker number and asking price.
//
// Everything here is pure so the page can do all its filtering in the browser.
// The whole in-stock list is a few hundred rows, small enough to ship once with
// the page, and after that every keystroke is instant because nothing waits on
// a network round trip.

/** One physical card, cut down to what a buyer at the table needs to see.
 *  Buy prices, notes and owners never make it into this shape, which is what
 *  makes it safe to put on a public page. */
export type ShowCard = {
  id: string;
  no: number | null; // sticker number
  name: string;
  set: string;
  num: string; // number printed on the card, e.g. 161/131
  cond: string;
  variant: string;
  price: number | null;
  img: string;
  qty: number; // a record can hold several identical copies under one sticker
  lang: string; // blank for English, so only the exceptions get a badge
};

/** Identical copies shown as one tile: 14 Charmanders are one picture with
 *  "x14" and their sticker range, not 14 of the same picture in a row. */
export type ShowGroup = {
  key: string;
  first: ShowCard;
  count: number;
  nos: number[];
};

const GRADED_RE = /\b(PSA|CGC|BGS|SGC|TAG|ACE)\b/i;
export const isGraded = (cond: string) => GRADED_RE.test(cond || "");

/** "Charmander - 020/217 (Cosmos Holo)" reads as "Charmander (Cosmos Holo)"
 *  on a tile, since the number is already shown on the line below. */
export function displayName(name: string): string {
  return (name || "")
    .replace(/\s*-\s*[A-Za-z]*\s?\d+[a-z]?\/\d+\s*/, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function groupCards(cards: ShowCard[]): ShowGroup[] {
  const by = new Map<string, ShowGroup>();
  for (const c of cards) {
    // Price is part of the key on purpose: two copies priced differently are
    // not interchangeable to a buyer, so they stay separate tiles.
    const key = [c.name, c.set, c.num, c.cond, c.variant, c.lang, c.price ?? ""].join("|").toLowerCase();
    const qty = Math.max(1, Math.floor(c.qty || 1));
    const g = by.get(key);
    if (g) {
      g.count += qty;
      if (c.no !== null) g.nos.push(c.no);
    } else {
      by.set(key, { key, first: c, count: qty, nos: c.no !== null ? [c.no] : [] });
    }
  }
  const out = Array.from(by.values());
  for (const g of out) {
    g.nos.sort((a, b) => a - b);
    // the tile opens the lowest-numbered copy
    if (g.nos.length) {
      const lowest = cards.find((c) => c.no === g.nos[0]);
      if (lowest) g.first = lowest;
    }
  }
  return out;
}

export const pad4 = (n: number) => String(n).padStart(4, "0");

/** Sticker numbers as a buyer reads them: runs collapse to a range, so
 *  0579 to 0592 is one short line instead of fourteen numbers. */
export function formatNos(nos: number[], max = 3): string {
  if (!nos.length) return "";
  const runs: [number, number][] = [];
  for (const n of nos) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  const parts = runs.map(([a, b]) => (a === b ? pad4(a) : b === a + 1 ? `${pad4(a)}, ${pad4(b)}` : `${pad4(a)}-${pad4(b)}`));
  if (parts.length <= max) return parts.join(", ");
  return parts.slice(0, max).join(", ") + ` +${parts.length - max} more`;
}

/** Search rules. A bare number is a sticker being read off a card in hand, so
 *  it means that exact card. Anything else is words, and every word has to
 *  match somewhere, so "umbreon prismatic" finds Umbreons in Prismatic
 *  Evolutions rather than every Umbreon plus every Prismatic card. */
export function matchesQuery(g: ShowGroup, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const asNo = /^#?\d{1,5}$/.test(t) ? parseInt(t.replace("#", ""), 10) : null;
  if (asNo !== null && g.nos.includes(asNo)) return true;
  const hay = `${g.first.name} ${g.first.set} ${g.first.num} ${g.first.cond} ${g.first.variant} ${g.first.lang}`.toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  return words.every((w) => hay.includes(w));
}

export type ShowSort = "az" | "priceDesc" | "priceAsc" | "no";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function sortGroups(list: ShowGroup[], sort: ShowSort): ShowGroup[] {
  const out = [...list];
  const byName = (a: ShowGroup, b: ShowGroup) =>
    collator.compare(a.first.name, b.first.name) || collator.compare(a.first.set, b.first.set) || collator.compare(a.first.num, b.first.num);
  if (sort === "az") out.sort(byName);
  // Unpriced cards sink to the bottom whichever way price is sorted.
  else if (sort === "priceDesc") out.sort((a, b) => (b.first.price ?? -1) - (a.first.price ?? -1) || byName(a, b));
  else if (sort === "priceAsc") out.sort((a, b) => (a.first.price ?? Infinity) - (b.first.price ?? Infinity) || byName(a, b));
  else out.sort((a, b) => (a.nos[0] ?? Infinity) - (b.nos[0] ?? Infinity));
  return out;
}

/** Whole dollars read cleaner across a table; cents only when there are some. */
export function formatPrice(p: number | null): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "Ask";
  return Number.isInteger(p) ? `$${p.toLocaleString("en-US")}` : `$${p.toFixed(2)}`;
}
