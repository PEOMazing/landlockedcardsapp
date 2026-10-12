// sc-v1. Turning a pile of cards on a table into a priced list.
//
// One scan, two exits. Quoting a collection you are standing in front of and
// taking in cards you have bought are the same act of reading a pile; they
// differ only in what happens at the end. So the scan builds one list, and
// the list can be priced without writing anything, or later written into
// inventory. Nobody rescans a pile after agreeing a number for it.
//
// Everything here is pure on purpose. The camera, the model call and the
// network live in the route and the client; the parts that decide what a card
// IS live here, where they can be tested without any of that.

/** A row on the scan list, which is also exactly what /api/pokemon/quote
 *  takes. Keeping the shapes identical is the reason the pricing half of this
 *  feature needed no new server code at all. */
export type ScanRow = {
  /** Local id for the list, never sent anywhere. */
  key: string;
  name: string;
  setName: string;
  number: string;
  /** "", "Normal", "Reverse Holofoil", "Holofoil". Blank means undecided, and
   *  an undecided row must not be priced: see needsPrinting. */
  variant: string;
  condition: string;
  qty: number;
  /** How the identity was arrived at, so the UI can show what to trust. */
  source: "scan" | "hand";
};

export type Identity = { name: string; setName: string; number: string };

/** Printings that share one piece of artwork, and therefore cannot be told
 *  apart from a photograph however good the model is. The foil sits on the
 *  card body rather than the art window, which is the first thing a phone
 *  flash destroys.
 *
 *  This is not a theoretical worry. Pricing a Reverse off the Normal printing
 *  is what put a $3 comp on a card listing at $19, and the same error across
 *  the binder came to about $1,150. So the scan never guesses: it asks. */
export const PRINTINGS = ["Normal", "Reverse Holofoil", "Holofoil"] as const;

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DM"] as const;

/** A collector number as printed: "46/123", "SVP 170", "99/100". Kept as text
 *  because leading zeros and set prefixes both carry meaning. */
export function cleanNumber(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[^\w/\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

export function cleanText(raw: unknown, max = 120): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Read an identity out of whatever the model said.
 *
 *  Models wrap JSON in prose, in code fences, or answer with the object alone,
 *  and which one you get changes with the weather. Rather than demand a shape,
 *  the first balanced {...} is taken and parsed. A reply that cannot be parsed
 *  is not an error worth shouting about: the row simply stays unidentified and
 *  the person types it, which they could always do anyway. */
export function parseIdentity(reply: unknown): Identity | null {
  const text = String(reply ?? "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) { end = i; break; }
  }
  if (end < 0) return null;
  let o: any;
  try { o = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!o || typeof o !== "object") return null;

  const name = cleanText(o.name ?? o.cardName);
  const setName = cleanText(o.setName ?? o.set);
  const number = cleanNumber(o.number ?? o.cardNumber ?? o.collectorNumber);
  // A name is the one field without which nothing downstream can even try:
  // the resolver refuses an empty name outright.
  if (!name) return null;
  return { name, setName, number };
}

/** Base64 out of a data URL, with its media type. Rejects anything that is
 *  not an image the model will take, rather than letting the upstream call
 *  fail on something unreadable. Lives here rather than beside the route
 *  because a Next route file may only export its handlers. */
export function readDataUrl(s: unknown): { media: string; data: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(s ?? "").trim());
  return m ? { media: m[1], data: m[2] } : null;
}

/** Whether this row still needs a human to say which printing it is.
 *
 *  Deliberately asked of every scanned row rather than only the sets known to
 *  have a Reverse. Getting that list wrong fails silently and in the
 *  expensive direction, and one tap is cheap. A row typed by hand is left
 *  alone: somebody who typed the card already said what it was. */
export function needsPrinting(row: Pick<ScanRow, "variant" | "source">): boolean {
  return row.source === "scan" && !String(row.variant || "").trim();
}

/** Rows that are ready to price, in the shape the quote endpoint wants.
 *
 *  Anything still missing a name or a printing is held back rather than sent
 *  with a blank: the resolver treats a blank variant as "any printing" and
 *  will happily answer with the wrong one. */
export function toQuoteRows(rows: ScanRow[]): { ready: any[]; held: ScanRow[] } {
  const ready: any[] = [];
  const held: ScanRow[] = [];
  for (const r of rows) {
    if (!cleanText(r.name) || needsPrinting(r)) { held.push(r); continue; }
    ready.push({
      name: r.name,
      setName: r.setName,
      number: r.number,
      variant: r.variant,
      condition: CONDITIONS.includes(r.condition as any) ? r.condition : "NM",
      qty: Math.max(1, Math.floor(Number(r.qty) || 1)),
    });
  }
  return { ready, held };
}

/** The quote endpoint prices 40 cards a request in condition mode, because
 *  each one costs three calls against somebody else's public endpoints. A
 *  pile does not care about that limit, so the client splits. */
export const QUOTE_BATCH = 40;

export function chunk<T>(rows: T[], size = QUOTE_BATCH): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}

/** Add up what came back. Unmatched rows are counted separately rather than
 *  as zero: a total that quietly swallows the cards nobody could price is a
 *  number that loses money. */
export function quoteTotal(results: { matched?: boolean; price?: number | null; qty?: number }[]) {
  let total = 0, priced = 0, unmatched = 0;
  for (const r of results) {
    const qty = Math.max(1, Number(r?.qty) || 1);
    const price = Number(r?.price);
    // A matched row with no number is not a priced row. The quote endpoint
    // counts it the same way, and a total that disagrees with the page it
    // came from is worse than no total.
    if (r?.matched && Number.isFinite(price) && price > 0) { total += price * qty; priced += qty; }
    else unmatched += qty;
  }
  return { total: Math.round(total * 100) / 100, priced, unmatched };
}
