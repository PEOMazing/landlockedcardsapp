// Checking a Whatnot sales export against a stream's set.
//
// Export the sales for a show from Whatnot, drop the CSV on the audit page, and
// every line of it is matched to the products in inventory:
//
//   - on the set: it was sold and it was on this stream's set - as it should be
//   - NOT on the set: it matches a product we stock, but that product was never
//     added to this stream. This is the Darkness Ablaze case: packs sold and
//     ripped, stock never came off, so the shelf count is now wrong.
//   - no match: a spin, a single, or a title too vague to tie to a product.
//     Listed so nothing silently disappears.
//
// Whatnot's column names have changed over time and differ between reports,
// so columns are found by what they are called, not where they sit. Parsing
// happens in the browser: the file never leaves the computer it was opened on.

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { f += '"'; i++; }
        else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(f); f = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else f += c;
  }
  row.push(f);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// First header that matches wins, so the most specific names come first.
const COLS = {
  name: ["product name", "listing title", "item name", "listing name", "title", "product title", "product", "item", "name"],
  desc: ["product description", "listing description", "description", "item description"],
  qty: ["product quantity", "quantity sold", "quantity", "qty", "units"],
  price: ["sold price", "sale price", "original item price", "item price", "price", "subtotal"],
  date: ["processed date", "order date", "order placed at utc", "sold date", "date", "created at", "placed at"],
  buyer: ["buyer username", "buyer name", "buyer", "username", "customer"],
  status: ["order status", "cancelled or failed", "status"],
  // the weekly earnings report mixes tips, shipping charges and orders, and
  // covers every show that week, so it also says which show each order was in
  type: ["transaction type"],
  format: ["buy format"],
  showId: ["livestream id"],
  showTitle: ["livestream title"],
  // the numeric id is the one both the show export and the earnings report carry
  orderId: ["order numeric id", "order id"],
};

export type WhatnotSale = {
  row: number; // line in the file, for pointing back at it
  title: string;
  description: string;
  qty: number;
  price: number;
  date: string;
  buyer: string;
  status: string;
  giveaway: boolean;
  showId: string;
  showTitle: string;
  orderId?: string; // Whatnot's order id, so a file uploaded twice books nothing twice
  format?: string; // AUCTION, BUY_IT_NOW or GIVEAWAY on the earnings report; blank elsewhere
};

export function findColumns(header: string[]): Record<keyof typeof COLS, number> {
  const h = header.map(norm);
  const out = {} as Record<keyof typeof COLS, number>;
  for (const k of Object.keys(COLS) as (keyof typeof COLS)[]) {
    out[k] = -1;
    for (const want of COLS[k]) {
      const i = h.indexOf(want);
      if (i >= 0) { out[k] = i; break; }
    }
  }
  return out;
}

const money = (v: string) => {
  const n = parseFloat(String(v || "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Cancelled and refunded orders never shipped, so they are not a sale to audit.
const DEAD = /cancel|refund|void|fail/i;

export function readWhatnotCsv(text: string): { sales: WhatnotSale[]; skipped: number; error: string | null } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { sales: [], skipped: 0, error: "That file has no rows in it." };
  const c = findColumns(rows[0]);
  if (c.name < 0) {
    return { sales: [], skipped: 0, error: "Could not find a product name or title column in that file. Is it the Whatnot sales export?" };
  }
  const sales: WhatnotSale[] = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (k: keyof typeof COLS) => (c[k] >= 0 ? String(r[c[k]] ?? "").trim() : "");
    const title = get("name");
    if (!title) { skipped++; continue; }
    const status = get("status");
    if (status && DEAD.test(status)) { skipped++; continue; }
    const type = get("type");
    // tips and shipping charges are money, not product
    if (type && !/order/i.test(type)) { skipped++; continue; }
    const qty = c.qty >= 0 ? Math.max(1, parseInt(get("qty")) || 1) : 1;
    sales.push({
      row: i + 1,
      title,
      description: get("desc"),
      qty,
      price: money(get("price")),
      date: get("date"),
      buyer: get("buyer"),
      status,
      giveaway: /giveaway/i.test(get("format")),
      showId: get("showId"),
      showTitle: get("showTitle"),
      orderId: get("orderId"),
      format: get("format"),
    });
  }
  return { sales, skipped, error: null };
}

// Words that appear on nearly every listing and say nothing about which product it is.
const FILLER = new Set(["pokemon", "tcg", "the", "and", "of", "a", "an", "english", "new", "sealed", "card", "cards", "x"]);

export function tokens(s: string): string[] {
  return String(s || "")
    // Whatnot titles are full of emoji; keycap digits (3️⃣0️⃣) would otherwise
    // glue onto the words next to them and turn "PACK3️⃣" into "pack3"
    .replace(/[0-9#*]\uFE0F?\u20E3/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, " ")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .flatMap((w) => ABBR[w] || [w])
    .map(singular)
    // "10x", "225x": how many, not what. A set line is stored with its count
    // in front of it ("225x Brilliant Fantasy pack"), and no listing will ever
    // contain the word "225x", so leaving it in made that line unmatchable.
    .filter((w) => w && !FILLER.has(w) && !/^\d{1,3}x$/.test(w));
}

// Shorthand used in listing titles, spelled out so they match product names.
const ABBR: Record<string, string[]> = {
  etb: ["elite", "trainer", "box"],
  bb: ["booster", "bundle"],
  spc: ["super", "premium", "collection"],
  upc: ["ultra", "premium", "collection"],
  pc: ["pokemon", "center"],
  pkc: ["pokemon", "center"],
  vol: ["volume"],
  cn: ["chinese"],
  jp: ["japanese"],
  bp: ["booster", "pack"],
};

// "packs" and "pack" are the same thing to a buyer
const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

export type Product = { id: string; name: string };

/** The permanent card number a single carries, as a plain number string.
 *
 *  A set line writes it at the front of the name ("[0236] NM Leafeon ..."),
 *  and the Whatnot listing carries it wherever the person typing the title
 *  put it, usually after the show's own prefix. So the line is read anchored
 *  and the listing is read loose. Compared as a number, which makes [0236]
 *  and [236] the same card. */
export const cardNoInListing = (s: string): string | null => {
  const m = /\[(\d{3,5})\]/.exec(String(s || ""));
  return m ? String(Number(m[1])) : null;
};

export const cardNoOnLine = (s: string): string | null => {
  const m = /^\s*\[(\d{3,5})\]/.exec(String(s || ""));
  return m ? String(Number(m[1])) : null;
};

/** The stocked product a sale is for, or null. Every meaningful word of the
 *  product's name has to appear in the listing, and the longest name that
 *  fits wins - so "Darkness Ablaze Booster Pack" beats plain "Darkness Ablaze"
 *  when the title says booster pack.
 *
 *  Listings rarely spell out the variant in brackets ("Enhanced 2-Pack
 *  Blister Pack [Latios, Zekrom & Palkia]" is listed as just "Enhanced 2-Pack
 *  Blister Pack"), so a name also counts when everything outside its brackets
 *  matches. A full match of the same length still wins, which keeps
 *  "Series 2" and "Series 3" apart. */
export function matchProduct(
  sale: Pick<WhatnotSale, "title" | "description">,
  products: Product[],
  prefer: Set<string> = new Set()
): Product | null {
  // A card number settles it on its own, and has to be checked before the
  // token match rather than after, because for a single the token match can
  // never succeed. The line carries the full catalogue name and the listing
  // carries the short one a person typed at 11pm:
  //
  //   line     [0236] NM Leafeon - 170 (Cosmos Holo) #170 SV: Scarlet & Violet Promo Cards
  //   listing  GREAT ODDS!!! - [0236] LEAFEON - 170 COSMOS HOLO #170
  //
  // Requiring every word of the line to appear in the listing fails on "nm",
  // "sv", "scarlet", "violet", "promo" and "cards" every time, and stripping
  // brackets or generic words does not save it either. So before this, every
  // single card on every wheel came back as "sold on Whatnot but not on this
  // show set", whether it was on the set or not, which buried the cards that
  // genuinely were missing in a list of forty that were not.
  const saleNo = cardNoInListing(sale.title);
  if (saleNo) {
    const numbered = products.filter((p) => cardNoOnLine(p.name));
    const same = numbered.filter((p) => cardNoOnLine(p.name) === saleNo);
    if (same.length) return same.find((p) => prefer.has(p.id)) || same[0];
    // The set numbers its cards and none of them is this one, so this card
    // really was not on it. Falling through to the token match here would be
    // free to land a sold [0238] on the [0236] sitting next to it.
    if (numbered.length) return null;
  }

  const hay = new Set(tokens(`${sale.title} ${sale.description}`));
  let best: Product | null = null;
  let bestScore = 0;
  let bestOnSet: Product | null = null;
  let bestOnSetScore = 0;
  for (const p of products) {
    const full = [...new Set(tokens(p.name))];
    if (full.length === 0) continue;
    // one short word alone is too loose to trust
    if (full.length === 1 && full[0].length < 5) continue;
    let score = 0;
    if (full.every((w) => hay.has(w))) score = full.length;
    else {
      const core = [...new Set(tokens(p.name.replace(/\[[^\]]*\]|\([^)]*\)/g, " ")))];
      if (core.length >= 2 && core.length < full.length && core.every((w) => hay.has(w))) score = core.length + 0.5;
      // "CN BRILLIANT FANTASY" is still the Brilliant Fantasy pack
      const named = full.filter((w) => !GENERIC.has(w));
      if (!score && named.length >= 2 && named.length < full.length && named.every((w) => hay.has(w))) {
        // Dropping "booster pack" off the product leaves the set name, which
        // every product in that set shares, so this must not fire when the
        // listing names a different form. "Mega Evolution Pokemon Center
        // [Mega Lucario]" was being counted as a hit on the Mega Evolution
        // Booster Pack: both named words match, and the only thing saying
        // otherwise is the word "center".
        const otherForm = [...hay].some((w) => FORM.has(w) && !full.includes(w));
        if (!otherForm) score = named.length - 0.5;
      }
    }
    if (prefer.has(p.id) && score >= 1.5 && score > bestOnSetScore) {
      bestOnSet = p;
      bestOnSetScore = score;
    }
    // On a tie between two products (two blisters that differ only by the
    // Pokemon in brackets), the one that was actually on this show wins.
    if (score > bestScore || (score > 0 && score === bestScore && best && prefer.has(p.id) && !prefer.has(best.id))) {
      best = p;
      bestScore = score;
    }
  }
  // When the same product exists twice in inventory ("Perfect Order" and
  // "Perfect Order Booster Bundle"), the copy that was on this show's set is
  // the one that sold. Without this, a duplicate record reads as "not on the
  // set" and buries the real misses.
  return bestOnSet || best;
}

// Words that describe the format rather than the product.
const GENERIC = new Set(["pack", "booster"]);

/** Words that say what shape of thing a listing is selling. Two products from
 *  one set differ by exactly this, so a form word in the listing that the
 *  product does not have is evidence against, not noise. */
const FORM = new Set([
  "pack", "booster", "bundle", "box", "tin", "collection", "blister", "center", "case", "display",
]);

export type CheckRow = {
  key: string; // product id, or the listing title when nothing matched
  product: Product | null;
  titles: string[];
  sold: number; // units on the Whatnot export
  revenue: number;
  onSet: number; // units that went on this stream's set (0 = never added)
  hitOnSet: number; // units recorded as hit in the app
  status: "ok" | "not-on-set" | "count-off" | "no-match";
};

/** Line the export up against the set. `setByProduct` is product id -> the
 *  units on this stream's set and how many were recorded as hit. */
export function checkAgainstSet(
  sales: WhatnotSale[],
  products: Product[],
  setByProduct: Record<string, { onSet: number; hit: number }>
): { rows: CheckRow[]; counts: Record<CheckRow["status"], number> } {
  const by = new Map<string, CheckRow>();
  const onSet = new Set(Object.keys(setByProduct).filter((k) => setByProduct[k].onSet > 0));
  for (const s of sales) {
    const p = matchProduct(s, products, onSet);
    const key = p ? p.id : `?${s.title.toLowerCase()}`;
    const row = by.get(key) || { key, product: p, titles: [], sold: 0, revenue: 0, onSet: 0, hitOnSet: 0, status: "ok" as const };
    if (!row.titles.includes(s.title)) row.titles.push(s.title);
    row.sold += s.qty;
    row.revenue += s.price;
    by.set(key, row);
  }
  const counts = { ok: 0, "not-on-set": 0, "count-off": 0, "no-match": 0 };
  const rows = [...by.values()].map((r) => {
    if (!r.product) return { ...r, status: "no-match" as const };
    const set = setByProduct[r.product.id];
    if (!set || set.onSet === 0) return { ...r, status: "not-on-set" as const };
    const status: CheckRow["status"] = set.hit === r.sold ? "ok" : "count-off";
    return { ...r, onSet: set.onSet, hitOnSet: set.hit, status };
  });
  for (const r of rows) counts[r.status]++;
  const order = { "not-on-set": 0, "count-off": 1, "no-match": 2, ok: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || b.sold - a.sold);
  return { rows, counts };
}

/** Free listings are giveaways, not sales. Whatnot shows them as $0 orders;
 *  they are split out so they do not clutter the product check, and counted
 *  so they can be lined up against the giveaways recorded on the stream. */
export function splitGiveaways(sales: WhatnotSale[]): {
  paid: WhatnotSale[];
  freePacks: number;
  freeSingles: number;
  freeOther: number;
  gross: number;
} {
  const paid: WhatnotSale[] = [];
  let freePacks = 0, freeSingles = 0, freeOther = 0, gross = 0;
  for (const s of sales) {
    const free = s.giveaway || s.price <= 0;
    if (!free) {
      paid.push(s);
      gross += s.price;
      continue;
    }
    const t = `${s.title} ${s.description}`;
    if (/single|slab|graded|card/i.test(t)) freeSingles += s.qty;
    else if (/pack|givv|giveaway|free/i.test(t)) freePacks += s.qty;
    else freeOther += s.qty;
  }
  return { paid, freePacks, freeSingles, freeOther, gross };
}

export type WhatnotShow = { id: string; title: string; start: string; orders: number };

/** The shows in a file. A single-show export has no show column, so it comes
 *  back as one show with a blank id. */
export function showsIn(sales: WhatnotSale[]): WhatnotShow[] {
  const by = new Map<string, WhatnotShow>();
  for (const s of sales) {
    const cur = by.get(s.showId) || { id: s.showId, title: s.showTitle, start: s.date, orders: 0 };
    cur.orders += s.qty;
    if (s.date && (!cur.start || s.date < cur.start)) cur.start = s.date;
    by.set(s.showId, cur);
  }
  return [...by.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** Local calendar date of a Whatnot timestamp. Whatnot writes UTC, and an
 *  evening show in Colorado runs past midnight UTC. */
export function localDate(ts: string, timeZone = "America/Denver"): string {
  if (!ts) return "";
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : ts.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return ts.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Best guess at which show in a weekly file belongs to an app stream: same
 *  local day, and the streamer's first name in the show title when there is
 *  more than one show that day. */
export function suggestShow(shows: WhatnotShow[], stream: { date: string; streamer: string }): string {
  const sameDay = shows.filter((s) => localDate(s.start) === stream.date);
  const first = (stream.streamer || "").split(/\s+/)[0].toLowerCase();
  const named = first ? sameDay.filter((s) => s.title.toLowerCase().includes(first)) : [];
  return (named[0] || sameDay[0])?.id ?? "";
}

// ---------------------------------------------------------------------------
// Store sales
//
// A store sale is anything bought straight off the shelf during a show (Buy It
// Now on Whatnot) rather than won on the wheel. They live in their own section
// of the stream, not on the show set, so they never touch spin stats.

/** "5x Darkness Ablaze Booster Packs" is 5 packs. The number up front is how
 *  many units one order takes off the shelf.
 *
 *  Only ever asked of a listing that is already known not to be a wheel spin,
 *  because a show can be named "10x POKEMON CENTER EXCLUSIVES w/ CASES" and
 *  that 10 is the odds on offer, not a count of anything on a shelf. The
 *  dash cannot be used to skip the show's name here: a shelf listing has its
 *  own ("5x Obsidian Flames Packs - Ripped Live"). */
export function packMultiplier(title: string): number {
  const m = String(title || "").match(/^\s*(\d{1,2})\s*x\s/i);
  const n = m ? parseInt(m[1]) : 1;
  return n >= 2 && n <= 50 ? n : 1;
}

/** Shipping upgrades are money, not product. */
export const isShippingLine = (title: string) => /shipping/i.test(String(title || ""));

export type StoreRow = {
  key: string; // order id, or file row when there is none
  orderId: string;
  title: string;
  units: number; // what comes off the shelf: order qty x the "5x" multiplier
  price: number; // what the buyer paid for the whole order
  date: string;
  showId: string;
};

/** The store sales in a file. The earnings report says outright which orders
 *  were Buy It Now. The per-show export does not, so there it is worked out
 *  from the titles: every wheel spot in a show shares the show's prefix
 *  ("BANGERS ALL NIGHT!! - item"), so a prefix used on several paid orders is
 *  a wheel. Anything else paid - no prefix, a prefix only used once or twice
 *  ("Pokemon Keychain - KailieKreations"), or a pack count like "5x" - is a
 *  store sale. */
export function isStoreSale(s: WhatnotSale, hasFormat: boolean, wheelPrefixes?: Set<string>): boolean {
  if (s.giveaway || s.price <= 0 || isShippingLine(s.title)) return false;
  if (hasFormat) return /buy.?it.?now/i.test(s.format || "");
  const pre = wheelPrefix(s.title);
  // A prefix the show reused order after order is the wheel, and that settles
  // it before anything is guessed from the words. It has to be asked first:
  // the pack-count guess below was reading the "10x" out of the show's own
  // name and calling all 199 spins shelf sales, so the wheel came back empty
  // and the set recorded no hits at all.
  if (pre && wheelPrefixes?.has(pre)) return false;
  if (packMultiplier(s.title) > 1) return true;
  if (!pre) return true;
  // a prefix nobody else used is a one-off listing, not a wheel
  return !!wheelPrefixes;
}

const wheelPrefix = (title: string) => {
  const t = String(title || "");
  const i = t.indexOf(" - ");
  return i >= 0 ? t.slice(0, i).trim().toLowerCase() : "";
};

/** Prefixes that belong to wheel spots: used on at least 3 paid orders. */
export function wheelPrefixesIn(sales: WhatnotSale[]): Set<string> {
  const n = new Map<string, number>();
  for (const s of sales) {
    if (s.giveaway || s.price <= 0) continue;
    const p = wheelPrefix(s.title);
    if (p) n.set(p, (n.get(p) || 0) + 1);
  }
  return new Set([...n].filter(([, c]) => c >= 3).map(([p]) => p));
}

export function storeRows(sales: WhatnotSale[]): { rows: StoreRow[]; guessed: boolean } {
  const hasFormat = sales.some((s) => s.format);
  const wheels = hasFormat ? undefined : wheelPrefixesIn(sales);
  const rows: StoreRow[] = [];
  for (const s of sales) {
    if (!isStoreSale(s, hasFormat, wheels)) continue;
    rows.push({
      key: s.orderId || `row${s.row}`,
      orderId: s.orderId || "",
      title: s.title,
      units: s.qty * packMultiplier(s.title),
      price: s.price,
      date: s.date,
      showId: s.showId,
    });
  }
  return { rows, guessed: !hasFormat };
}

/** Which show in a weekly file belongs to this stream. The app's stream name
 *  is supposed to be the Whatnot show title, so an exact match wins; failing
 *  that, same day and streamer. */
export function pickShow(shows: WhatnotShow[], stream: { title: string; date: string; streamer: string }): string {
  const n = (t: string) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // one app stream can cover two Whatnot shows, written "Show A / Show B"
  const names = String(stream.title || "").replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, "").split(" / ").map(n);
  const exact = shows.find((s) => s.title && names.includes(n(s.title)));
  return exact ? exact.id : suggestShow(shows, stream);
}

// ---------------------------------------------------------------------------
// Filling in the show set from a Whatnot show report
//
// Every paid order in a wheel show is one spin, and each spin landed on one
// item from the set. Wheel listings are titled "SHOW TITLE - item", so the
// part after the dash says what was hit. Counting those per set line gives
// the hits; the free orders give the giveaway counts; the number of spins is
// spots sold. Store sales (Buy It Now) are left out here - they have their
// own section.

export type SetLine = {
  id: string; name: string; qty: number; qtyHit: number;
  isStore?: boolean; isGiveaway?: boolean;
  /** The title this line was pasted into Whatnot as. The strongest thing to
   *  match a sale on, because it is the same string on both ends. */
  exportTitle?: string;
  /** Other titles this line is known by: the product's Former Names and the
   *  Whatnot listing titles somebody has mapped to it by hand before. This is
   *  what makes a mapping stick, so the same oddly-titled listing is not
   *  flagged again on the next show. */
  aliases?: string[];
  /** The Inventory record behind this line, when there is one. Mapping a
   *  listing title to this line remembers it against this product. Blank on a
   *  single card. */
  productId?: string;
};

/** A title stripped down to the part Whatnot cannot change: letters and digits
 *  only, upper case.
 *
 *  Whatnot rewrites a listing title on its way out - it uppercases it, drops
 *  parentheses, and appends dots to tell two listings of the same thing apart,
 *  so one set line comes back as "[Sealed] Brilliant Fantasy pack.",
 *  "[Sealed] Brilliant Fantasy pack..", "[Sealed]. Brilliant Fantasy pack."
 *  and so on. Folded, all of those are one string again. Emoji wrappers fall
 *  out for free, since they are not letters or digits. */
export const foldTitle = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");

export type SetPlan = {
  spins: number; // paid wheel orders = spots sold
  gross: number; // what those spins brought in, before Whatnot fees
  freePacks: number;
  freeSingles: number;
  lines: { lineId: string; name: string; qty: number; was: number; now: number }[];
  over: { name: string; sold: number; onSet: number }[]; // more hit than was on the set
  /** Spins that match nothing on the set. `fold` is the handle to map one by:
   *  pass it back in `mapTo` or `asStore` and the plan re-reads accordingly. */
  notOnSet: { title: string; fold: string; sold: number; revenue: number }[];
  /** What the operator sent to the store-sales section instead, ready to book:
   *  these are out of `spins` and out of `gross` already.
   *
   *  `orders` keeps each Whatnot order separately even though the row shows a
   *  total, because the store booking dedupes on order id. Aggregating them
   *  away would let the same file, uploaded twice, book the sale twice and
   *  take the stock off the shelf twice. */
  toStore: {
    title: string; fold: string; units: number; price: number; productId: string;
    orders: { orderId: string; units: number; price: number }[];
  }[];
};

// Slot vocabulary. A break does not list products on the wheel, it lists the
// thing you are buying a share of: an energy type, a team, a numbered spot.
// The same words come back show after show meaning something different each
// time, which is exactly what must not be remembered.
const SLOT_WORDS = new Set([
  "energy", "psychic", "fire", "water", "grass", "lightning", "electric", "fighting",
  "darkness", "dark", "metal", "steel", "fairy", "dragon", "colorless", "normal",
  "slot", "spot", "pick", "team", "random", "spin", "mystery", "hit", "share", "break",
]);

/** Whether a listing title is too generic to be worth remembering.
 *
 *  Mapping "ENERGY" to a line is right for the show in front of you and wrong
 *  forever after, because the next energy break uses the same word for a
 *  different box. A title like this is still mappable; it just must not be
 *  written onto a product as an alias, so the UI warns instead of offering it
 *  as a good idea. */
export function looksGeneric(title: string): boolean {
  const t = String(title || "")
    // [Sealed] and [0236] say nothing about which product this is
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (!t) return true;
  const words = t.split(" ").filter((w) => w && !/^\d+$/.test(w));
  if (words.length <= 1) return true; // ENERGY, PSYCHIC, "#1", "SLOT 3"
  return words.every((w) => SLOT_WORDS.has(w.toLowerCase())); // PSYCHIC ENERGY
}

/** What somebody decided about the titles the matcher could not place.
 *
 *  Both are keyed by foldTitle, because that is the only form of the listing
 *  title that is stable across uploads: Whatnot's trailing dots and
 *  uppercasing differ run to run, so storing the raw string would make a
 *  mapping stop working on the next report. */
export type SetDecisions = {
  /** folded listing title -> the set line's id it really is */
  mapTo?: Record<string, string>;
  /** folded listing title -> the Inventory product it sold off the shelf as.
   *  These come out of spins and out of spin gross: a shelf sale was never a
   *  wheel spin, so leaving it in would overstate spots sold. */
  asStore?: Record<string, string>;
};

/** "BANGERS ALL NIGHT!! - 🔥ZARUDE 2-PACK BLISTER🔥" -> "🔥ZARUDE 2-PACK BLISTER🔥" */
export const spinItem = (title: string) => {
  const t = String(title || "");
  const i = t.indexOf(" - ");
  return (i >= 0 ? t.slice(i + 3) : t).trim();
};

const lineKey = (name: string) => String(name || "").replace(/\s*\(store\)\s*$/i, "").toLowerCase().replace(/\s+/g, " ").trim();

export function planSetFromShow(sales: WhatnotSale[], setLines: SetLine[], decisions: SetDecisions = {}): SetPlan {
  const hasFormat = sales.some((s) => s.format);
  const wheels = hasFormat ? undefined : wheelPrefixesIn(sales);
  const g = splitGiveaways(sales);
  const spins = g.paid.filter((s) => !isShippingLine(s.title) && !isStoreSale(s, hasFormat, wheels));

  // lines that can be hit, grouped by name: a product added twice is one pool
  const pool = setLines.filter((l) => !l.isStore && !l.isGiveaway);
  const groups = new Map<string, SetLine[]>();
  for (const l of pool) {
    const k = lineKey(l.name);
    groups.set(k, [...(groups.get(k) || []), l]);
  }
  const catalog: Product[] = [...groups.keys()].map((k) => ({ id: k, name: groups.get(k)![0].name }));

  // Folded pasted title -> group. The app wrote the listing title itself, so
  // when it survives the round trip this is an identity, not a guess. First
  // writer wins, so a line whose own name collides with another line's pasted
  // title cannot steal it.
  // Pasted titles are claimed before plain names, so a line's own name can
  // never take a fold that another line was actually listed under.
  // Aliases are claimed last of the automatic sources: a title somebody mapped
  // by hand should not be able to take a fold that a line was really listed
  // under, but it beats having to map the same listing again every show.
  const byFold = new Map<string, string>();
  const sources: ((l: SetLine) => string | string[] | undefined)[] = [
    (l) => l.exportTitle, (l) => l.name, (l) => l.aliases,
  ];
  for (const pick of sources) {
    for (const [k, ls] of groups) {
      for (const l of ls) {
        const got = pick(l);
        for (const t of Array.isArray(got) ? got : [got]) {
          const f = foldTitle(t || "");
          if (f && !byFold.has(f)) byFold.set(f, k);
        }
      }
    }
  }

  // A decision made in the UI outranks everything above. mapTo names a line
  // id; the line may be one of several sharing a name, so it resolves to that
  // line's group and the hits spread over the pool as usual.
  const groupOfLine = new Map<string, string>();
  for (const [k, ls] of groups) for (const l of ls) groupOfLine.set(l.id, k);
  for (const [fold, lineId] of Object.entries(decisions.mapTo || {})) {
    const k = groupOfLine.get(lineId);
    if (fold && k) byFold.set(fold, k);
  }
  const asStore = decisions.asStore || {};

  const sold = new Map<string, number>();
  const missing = new Map<string, { title: string; fold: string; sold: number; revenue: number }>();
  const store = new Map<string, SetPlan["toStore"][number]>();
  let count = 0;
  let gross = 0;
  for (const s of spins) {
    const item = spinItem(s.title);
    const fold = foldTitle(item);
    // Sent to the shelf: not a spin at all, so it is kept out of both the
    // count and the gross before either is touched.
    if (asStore[fold]) {
      const cur = store.get(fold) || { title: item, fold, units: 0, price: 0, productId: asStore[fold], orders: [] };
      cur.units += s.qty;
      cur.price += s.price;
      cur.orders.push({ orderId: s.orderId || "", units: s.qty, price: s.price });
      store.set(fold, cur);
      continue;
    }
    count += s.qty;
    gross += s.price;
    // The pasted title first, then the word match. Reading the title we wrote
    // is exact where the word match has to infer, and it is the only thing
    // that reliably tells two near-identical lines apart.
    const hit = byFold.get(fold);
    if (hit) { sold.set(hit, (sold.get(hit) || 0) + s.qty); continue; }
    const m = matchProduct({ title: item, description: "" }, catalog);
    if (m) { sold.set(m.id, (sold.get(m.id) || 0) + s.qty); continue; }
    const cur = missing.get(fold) || { title: item, fold, sold: 0, revenue: 0 };
    cur.sold += s.qty;
    cur.revenue += s.price;
    missing.set(fold, cur);
  }

  const lines: SetPlan["lines"] = [];
  const over: SetPlan["over"] = [];
  for (const [k, ls] of groups) {
    let left = sold.get(k) || 0;
    const onSet = ls.reduce((a, l) => a + l.qty, 0);
    if (left > onSet) over.push({ name: ls[0].name, sold: left, onSet });
    for (const l of ls) {
      const now = Math.min(l.qty, left);
      left -= now;
      lines.push({ lineId: l.id, name: l.name, qty: l.qty, was: l.qtyHit, now });
    }
  }
  return {
    spins: count,
    gross: Math.round(gross * 100) / 100,
    freePacks: g.freePacks,
    freeSingles: g.freeSingles,
    lines,
    over,
    notOnSet: [...missing.values()].sort((a, b) => b.sold - a.sold),
    toStore: [...store.values()]
      .map((r) => ({ ...r, price: Math.round(r.price * 100) / 100 }))
      .sort((a, b) => b.units - a.units),
  };
}
