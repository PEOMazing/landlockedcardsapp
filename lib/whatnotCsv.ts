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
  name: ["product name", "item name", "listing title", "listing name", "title", "product title", "product", "item", "name"],
  desc: ["product description", "description", "item description", "listing description"],
  qty: ["product quantity", "quantity sold", "quantity", "qty", "units"],
  price: ["sold price", "sale price", "original item price", "item price", "price", "subtotal"],
  date: ["processed date", "order date", "sold date", "date", "created at", "placed at"],
  buyer: ["buyer username", "buyer", "username", "customer"],
  status: ["order status", "cancelled or failed", "status"],
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
    .filter((w) => w && !FILLER.has(w));
}

export type Product = { id: string; name: string };

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
  const hay = new Set(tokens(`${sale.title} ${sale.description}`));
  let best: Product | null = null;
  let bestScore = 0;
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
    }
    // On a tie between two products (two blisters that differ only by the
    // Pokemon in brackets), the one that was actually on this show wins.
    if (score > bestScore || (score > 0 && score === bestScore && best && prefer.has(p.id) && !prefer.has(best.id))) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

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
    const free = s.price <= 0;
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
