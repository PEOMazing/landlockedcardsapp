// sp-v1. Sold listings as a human copied them off a page, turned into sales.
//
// Adding a slab used to end with the app telling you to go and look the price
// up somewhere else: "Graded comps are manual: check ALT or eBay sold listings
// and enter the comp above." So the hardest part of the job happened outside
// the app, the result arrived as one number somebody typed, and nothing
// recorded which sales it came from or when it stopped being true. That is the
// same hole the slab comp engine was built to close, and this is the way the
// evidence gets in.
//
// Deliberately a PASTE and not a fetch. eBay put sold listings behind a login
// wall in August 2026, 130point publishes no API, and every scraper in that
// gap breaks silently and hands back something that still parses. A person
// looking at the page can see what the server cannot, and selecting the
// results is one keystroke. The cost is a paste; the gain is that the comp
// rests on real rows with real dates instead of a number with no provenance.
//
// Tolerant on purpose. This has to survive 130point's layout, eBay's, and
// whatever either does next year, so it reads the shapes that matter - money
// and dates - and ignores everything else rather than demanding a schema.

import type { SaleRow } from "./gradedSales";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const MONEY = /\$\s?([\d,]+(?:\.\d{1,2})?)/g;

/** "15 Oct 26", "27 Sept 26", "Oct 15, 2026", "2026-10-15". Null if the line
 *  holds no date this understands. */
export function parseSoldDate(line: string, now: Date = new Date()): string | null {
  const s = String(line || "");

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 130point: day first. "15 Oct 26 19:14:26"
  let m = /\b(\d{1,2})\s+([A-Za-z]{3,4})\.?,?\s+(\d{2,4})\b/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) return fmt(year(m[3], now), mo, parseInt(m[1], 10));
  }

  // eBay: month first. "Oct 15, 2026"
  m = /\b([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s+(\d{2,4})\b/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) return fmt(year(m[3], now), mo, parseInt(m[2], 10));
  }
  return null;
}

/** A two digit year is this century. Pinned against `now` rather than a
 *  hardcoded 2000 so this does not quietly rot. */
function year(raw: string, now: Date): number {
  const n = parseInt(raw, 10);
  if (raw.length === 4) return n;
  const century = Math.floor(now.getUTCFullYear() / 100) * 100;
  return century + n;
}

const fmt = (y: number, mo: number, d: number) =>
  `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function moneyOn(line: string): number[] {
  const out: number[] = [];
  MONEY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MONEY.exec(line))) {
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

export type ParsedPaste = {
  sales: SaleRow[];
  /** Lines that looked like a sale but had no readable date, so were skipped.
   *  Surfaced rather than swallowed: a paste that half worked should say so. */
  skipped: number;
};

/** Sales out of a pasted block, newest first.
 *
 *  The shape it looks for is a run of lines ending in a date. Money seen since
 *  the previous date belongs to the sale that date closes; everything else -
 *  titles, "USD", marketplace names, advert copy - is ignored.
 *
 *  TWO PRICES ON ONE SALE MEANS AN ACCEPTED OFFER, and which is which matters
 *  more than anything else here. 130point prints the asking price struck
 *  through and the accepted price beside it, so the pair reads $15,000 then
 *  $8,500. The LOWER is what changed hands; the higher is what was asked. Get
 *  this backwards and every negotiated sale inflates the comp, which is
 *  exactly the error that put a $15,000 ask into this collection as a sale. */
export function parseSoldPaste(text: string, now: Date = new Date()): ParsedPaste {
  const lines = String(text || "").split(/\r?\n/);
  const sales: SaleRow[] = [];
  let skipped = 0;

  let prices: number[] = [];
  let title = "";
  let format = "";
  let bestOffer = false;
  let bids = 0;

  const reset = () => { prices = []; title = ""; format = ""; bestOffer = false; bids = 0; };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const found = moneyOn(line);
    if (found.length) prices.push(...found);

    if (/best\s*offer/i.test(line)) bestOffer = true;
    if (/\bauction\b/i.test(line)) format = "AUCTION";
    else if (/fixed\s*price|buy\s*it\s*now/i.test(line)) format = format || "FIXED_PRICE";
    const b = /bids?\s*[:·]?\s*(\d+)/i.exec(line);
    if (b) bids = parseInt(b[1], 10);

    // A line with letters but no money and no date is the item title. Keep the
    // longest one seen, which is almost always the real title rather than a
    // marketplace badge.
    if (!found.length && /[A-Za-z]{4}/.test(line) && !parseSoldDate(line, now)) {
      if (line.length > title.length && line.length < 300) title = line;
    }

    const date = parseSoldDate(line, now);
    if (!date) continue;

    if (prices.length === 0) { reset(); continue; }

    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const negotiated = bestOffer || prices.length > 1;
    const price = negotiated ? low : prices[0];

    const row: SaleRow = {
      date,
      price: Math.round(price * 100) / 100,
      title,
      url: "",
      format: format || (bids > 0 ? "AUCTION" : "FIXED_PRICE"),
      bestOffer: negotiated,
    };
    // Only when the two differ. A best offer printed with one number is one we
    // cannot read the ask for, and inventing askingPrice === price would trip
    // isPricedSale's mis-ingest guard and throw away a real sale.
    if (negotiated && high > low) row.askingPrice = Math.round(high * 100) / 100;
    sales.push(row);
    reset();
  }

  // Anything still held when the text runs out had money but never reached a
  // date, so it cannot be placed in the window.
  if (prices.length > 0) skipped++;

  sales.sort((a, b) => b.date.localeCompare(a.date));
  return { sales, skipped };
}
