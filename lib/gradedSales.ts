// gs-v1. What a raw card last sold for once it was graded.
//
// The question this answers is not "what is my card worth" - the comp already
// says that. It is "is this card worth sending off". A $20 raw card whose PSA 10
// last sold at $420 is a different decision from one whose PSA 10 last sold at
// $26, and nothing in the app could tell those two apart.
//
// So: the most recent sale at each PSA grade, side by side, on the raw card.
// Deliberately the LAST SALE and not a median. A median over graded sales is a
// number about a population; the question here is what somebody actually paid
// for one, and when.
//
// Everything here is pure. The network call lives in the route, because what
// makes this hard is not fetching, it is deciding whether a listing somebody
// typed by hand is really this card.

/** High to low, because that is the order the decision is read in: the 10 is
 *  the upside and the 6 is the floor.
 *
 *  This array is the order of record and anything rendering the columns must
 *  iterate IT. The GradeSales object cannot be trusted for order: "10" and "9"
 *  are integer-like keys, so JavaScript sorts them ascending whatever order
 *  they were inserted in, and Object.keys comes back 6,7,8,9,10 - the columns
 *  backwards. */
export const PSA_GRADES = ["10", "9", "8", "7", "6"] as const;

export type SaleRow = {
  /** Sold date, YYYY-MM-DD. */
  date: string;
  price: number;
  title: string;
  url: string;
  /** Auction or fixed price, which is worth seeing: a lone auction result on a
   *  thin card is weaker evidence than a buy-it-now somebody chose to pay. */
  format: string;
  bestOffer: boolean;
};

export type GradeSales = Record<string, SaleRow | null>;

/** A single, as much of it as this needs. */
export type CardLike = {
  name?: string;
  setName?: string;
  number?: string;
  language?: string;
  printing?: string;
  condition?: string;
};

/** Collector number as the listing would carry it: "4/102" and "004/102" are
 *  the same card, and leading zeros are a set-list convention rather than
 *  something a seller types. */
export function foldNumber(n: unknown): string {
  const s = String(n ?? "").trim();
  if (!s) return "";
  const m = /^0*(\d+)\s*\/\s*0*(\d+)$/.exec(s);
  if (m) return `${m[1]}/${m[2]}`;
  return s.replace(/\s+/g, "").toUpperCase();
}

/** The words to search eBay titles with.
 *
 *  Name and set, and NOT the collector number. That is the opposite of what
 *  seems right, and it is the whole trick: most sellers do not put the number
 *  in the title, so including it throws away nearly every real sale. The number
 *  is used afterwards, to check the sales that came back, where a missing one
 *  can be tolerated instead of being fatal.
 *
 *  The grade is not in the query either - it goes in the grade parameter, so one
 *  request covers all five. */
export function gradedQuery(card: CardLike): string {
  const name = String(card.name || "")
    // "Charizard - 004/165 (Cosmos Holo)" searches far better as "Charizard":
    // the suffix is our own bookkeeping and almost never in a seller's title
    .replace(/\s*-\s*[\d/]+.*$/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const set = String(card.setName || "")
    // "SWSH11: Lost Origin" is listed as "Lost Origin"; the code is ours
    .replace(/^[A-Z0-9]{2,6}\s*\d*\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return [name, set].filter(Boolean).join(" ");
}

const LANG_CODES: Record<string, string> = {
  english: "en", japanese: "ja", chinese: "zh", korean: "ko",
  spanish: "es", german: "de", french: "fr", italian: "it", portuguese: "pt",
};

/** The request this card needs: PSA slabs only, all five grades at once, with
 *  the obvious junk excluded. One call per card, not one per grade. */
export function gradedParams(card: CardLike, days = 365): Record<string, string> {
  const p: Record<string, string> = {
    q: gradedQuery(card),
    graded: "true",
    grader: "PSA",
    grade: PSA_GRADES.join(","),
    cards: "1",
    // lots, sealed product, replicas, keyword-stuffed titles and listings that
    // only CLAIM a grade. Every one of those is a wrong number, not a weak one.
    exclude: "junk",
    days: String(days),
  };
  const lang = LANG_CODES[String(card.language || "").trim().toLowerCase()];
  // Only sent when we know it. Setting it drops titles that name no language,
  // which for an English card is most of them, so English is left unset.
  if (lang && lang !== "en") p.lang = lang;
  if (/1st/i.test(String(card.printing || ""))) p.first_edition = "true";
  return p;
}

/** Whether a sale the feed parsed is really this card.
 *
 *  Grader and grade come from the title, so they can be wrong or missing, and a
 *  sale whose grade could not be read is no use here however real it is: it
 *  cannot be put in a column.
 *
 *  The collector number is checked only when BOTH sides have one. A mismatch is
 *  a different card and is dropped; a listing with no number in the title is
 *  kept, because that describes most honest listings. */
export function saleMatches(item: any, card: CardLike): boolean {
  const c = item?.card;
  if (!c || c.graded === false) return false;
  if (String(c.grader || "").toUpperCase() !== "PSA") return false;
  if (!PSA_GRADES.includes(String(c.grade) as any)) return false;
  const want = foldNumber(card.number);
  const got = foldNumber(c.card_number);
  if (want && got && want !== got) return false;
  return Number(item?.price) > 0 && !!item?.last_sold;
}

const day = (s: unknown) => String(s ?? "").slice(0, 10);

/** The newest surviving sale in each grade column.
 *
 *  Sorted here rather than trusting the page order, because one page of sales
 *  across five grades is dominated by the grade that trades most - usually the
 *  10 - and the 6 may be a single sale buried in the middle of it. */
export function latestByGrade(items: any[], card: CardLike): GradeSales {
  const out: GradeSales = {};
  for (const g of PSA_GRADES) out[g] = null;
  for (const item of Array.isArray(items) ? items : []) {
    if (!saleMatches(item, card)) continue;
    const g = String(item.card.grade);
    const row: SaleRow = {
      date: day(item.last_sold),
      price: Math.round(Number(item.price) * 100) / 100,
      title: String(item.title || ""),
      url: String(item.url || ""),
      format: String(item.format || ""),
      bestOffer: !!item.best_offer,
    };
    const cur = out[g];
    if (!cur || row.date > cur.date) out[g] = row;
  }
  return out;
}

/** How many times the raw comp a grade last sold for. The reason the panel
 *  exists: 21x is a card to send off, 1.3x is a card to leave in the binder.
 *
 *  Null when either side is missing, rather than 0 - "no sale found" and
 *  "worth nothing graded" are opposite conclusions. */
export function upside(rawComp: number | null | undefined, graded: number | null | undefined): number | null {
  const raw = Number(rawComp);
  const g = Number(graded);
  if (!Number.isFinite(raw) || raw <= 0 || !Number.isFinite(g) || g <= 0) return null;
  return Math.round((g / raw) * 10) / 10;
}

/** Only raw cards get this panel. A slab does not need to be told what slabs
 *  sell for: it already has a grade, and its own comp answers the question. */
export function wantsGradedSales(card: CardLike & { condition?: string }, isSlab: (c: string) => boolean): boolean {
  return !isSlab(String(card.condition || ""));
}

/** A card off the wire rather than out of Airtable.
 *
 *  The scanner has no record to point at - a row on the scan list is a photo
 *  and whatever the model read off it - so the same lookup has to work from
 *  loose fields. Clamped hard because this comes straight from a query string:
 *  the only thing done with these is build a search, but a search built out of
 *  4KB of someone else's text is still not something to pass upstream. */
export function cardFromParams(get: (k: string) => string | null): CardLike {
  const s = (k: string, max = 120) => String(get(k) ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return {
    name: s("name"),
    setName: s("setName"),
    number: s("number", 24),
    language: s("language", 24) || "English",
    printing: s("printing", 40),
    condition: s("condition", 24) || "Raw",
  };
}

/** The raw price under which the scanner does not bother looking up graded
 *  sales. Grading costs money per card, so a sub-$5 common is not a candidate
 *  however nice its PSA 10 is, and a 40 card pile would otherwise spend 40
 *  lookups to tell you that about 35 of them. */
export const GRADE_LOOKUP_FLOOR = 5;

/** Grading is a decision with a floor under it. Sending a 70 cent common off
 *  costs more than the card, so the scanner does not spend a lookup on one:
 *  per-card quota is the scarce thing when a pile is 40 cards deep.
 *
 *  A card with no comp yet is NOT below the floor - unpriced is unknown, and
 *  the expensive mistake is passing on something because nobody had priced it. */
export function worthGradedLookup(rawComp: number | null | undefined, floor: number): boolean {
  if (rawComp === null || rawComp === undefined || !Number.isFinite(Number(rawComp))) return true;
  return Number(rawComp) >= floor;
}
