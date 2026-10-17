// ap-v1. eBay sold comps via the Apify actor epicscrapers/ebay-trading-card-comps.
//
// A second source for slab pricing, and a better-shaped one than the comps API
// behind lib/gradedSales. That feed hands back a title and makes us read the
// grade, the print run and the language out of it with regexes. This one parses
// all three upstream and returns them as fields: grader, grade, isFirstEdition,
// language, cardNumber, even certNumber. Every heuristic in slabSaleMatches
// becomes an equality check.
//
// Nothing here fetches. The adapter maps their row shape onto the SaleRow that
// lib/slabComp already works in, so the comp rule - newest five inside 30 days,
// low outliers dropped, median - is unchanged and still has one implementation.
//
// Deliberately NOT using their COMPS_SUMMARY. It ships a per-grade median for
// free and it is the wrong median: it is computed over whatever window the run
// asked for, with their outlier policy, not ours. Ponita is the case that
// matters - its only two sales are 47 and 54 days old, so our rule prices it
// off the newest one and labels it stale, while a provider median blends both
// and hands back a number with no warning attached to it.

import type { SaleRow } from "./gradedSales";
import type { SlabGrade } from "./slabComp";

export const APIFY_ACTOR = "epicscrapers~ebay-trading-card-comps";

/** One sold listing as the actor returns it. Only the fields we read. */
export type ApifyRow = {
  title?: string;
  url?: string;
  soldPrice?: number | null;
  listedPrice?: number | null;
  currency?: string;
  soldDate?: string;
  listingType?: string;
  isBestOfferAccepted?: boolean;
  bidCount?: number;
  isGraded?: boolean;
  grader?: string;
  grade?: number | string;
  gradeBucket?: string;
  certNumber?: string;
  cardNumber?: string;
  isFirstEdition?: boolean;
  language?: string;
  isLot?: boolean;
  site?: string;
};

/** What to ask the actor for, for one slab.
 *
 *  `days` is 365 and not 30 on purpose, the same reasoning as slabParams: a
 *  card with nothing inside the comp window still needs an older sale to fall
 *  back on and disclose, and narrowing the request would make "nothing sold
 *  this month" and "nothing has ever sold" look identical.
 *
 *  The grade is pinned both ways with minGrade and maxGrade rather than
 *  trusting a filter we cannot see. A PSA 9 sale answering for a PSA 10 is
 *  routinely a 5x error and it is the one mistake worth paying to avoid. */
export function apifyQuery(card: { name?: string; setName?: string; number?: string }, g: SlabGrade) {
  const name = String(card.name || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const set = String(card.setName || "").replace(/^[A-Z0-9]{2,6}\s*\d*\s*:\s*/i, "").trim();
  return [name, set, card.number || "", `${g.grader} ${g.grade}`].filter(Boolean).join(" ");
}

export function apifyInput(
  cards: { name?: string; setName?: string; number?: string; grade: SlabGrade }[],
  days = 365,
) {
  return {
    queries: cards.map((c) => apifyQuery(c, c.grade)),
    days,
    gradeFilter: "graded",
    graders: [...new Set(cards.map((c) => c.grade.grader))],
    excludeLots: true,
    matchCardNumber: true,
    // Reprints and proxies priced as the real card is the other expensive
    // mistake. Cheap to exclude upstream, impossible to spot downstream.
    excludeKeywords: ["reprint", "proxy", "custom", "fake", "replica", "lot of", "digital"],
  };
}

/** Did this listing sell for a price we actually know?
 *
 *  THE TRAP, and it is in their own docs: on an accepted Best Offer, soldPrice
 *  is null and only listedPrice survives, because eBay publishes the ask and
 *  not what changed hands. An accepted offer is by definition BELOW the ask,
 *  so quietly substituting listedPrice does not add noise, it adds a one-sided
 *  upward bias to exactly the sales most likely to be negotiated - the slow,
 *  expensive, thin ones.
 *
 *  Gabe's own Schillok search had one of these: $313.04 "or Best Offer" out of
 *  France. Treating that as a sale would have moved that card's comp by 36%.
 *
 *  So a Best Offer with no soldPrice is dropped. It is a real sale we cannot
 *  read, which is not the same as a sale that did not happen, and the sample
 *  count tells the truth about how much is left. */
export function hasKnownPrice(r: ApifyRow): boolean {
  return typeof r.soldPrice === "number" && r.soldPrice > 0;
}

const LANG_FROM_APIFY: Record<string, string> = {
  english: "en", japanese: "ja", chinese: "zh", korean: "ko", german: "de",
  french: "fr", italian: "it", spanish: "es", portuguese: "pt",
};

/** Their language field, as one of our codes. Blank when they did not say,
 *  which languageMatches already reads as "unmarked" and treats as English. */
export function apifyLanguage(r: ApifyRow): string {
  const v = String(r.language || "").trim().toLowerCase();
  if (!v) return "";
  if (LANG_FROM_APIFY[v]) return LANG_FROM_APIFY[v];
  return /^[a-z]{2}$/.test(v) ? v : "";
}

/** One Apify row as the shape lib/gradedSales and lib/slabComp already speak.
 *
 *  Returns null for anything that cannot answer: no known price, no date, a
 *  lot rather than a single card, or a grade that is not the one we hold.
 *  Grade is compared numerically because "10" and "10.0" are the same grade
 *  and no feed is consistent about which it sends. */
export function toSaleRow(r: ApifyRow, g: SlabGrade): SaleRow | null {
  if (!r || r.isLot) return null;
  if (r.isGraded === false) return null;
  if (!hasKnownPrice(r)) return null;
  const date = String(r.soldDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (String(r.grader || "").toUpperCase() !== g.grader.toUpperCase()) return null;
  if (Number(r.grade) !== Number(g.grade)) return null;
  return {
    date,
    price: Math.round(Number(r.soldPrice) * 100) / 100,
    title: String(r.title || ""),
    url: String(r.url || ""),
    format: String(r.listingType || ""),
    bestOffer: !!r.isBestOfferAccepted,
  };
}

/** Everything about this slab that the actor returned, newest first.
 *
 *  Card number and print run are checked here rather than trusted to the
 *  upstream filter, and only when both sides have a value - the same tolerance
 *  slabSaleMatches uses, for the same reason: a listing with no number in it
 *  is most honest listings, and dropping those empties the result. */
export function apifySales(
  rows: ApifyRow[],
  card: { number?: string; firstEdition?: boolean | null; language?: string },
  g: SlabGrade,
): SaleRow[] {
  const wantNum = String(card.number || "").split("/")[0].replace(/^0+/, "").toUpperCase();
  const wantLang = LANG_FROM_APIFY[String(card.language || "english").toLowerCase()] || "en";
  const out: SaleRow[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const row = toSaleRow(r, g);
    if (!row) continue;

    const gotNum = String(r.cardNumber || "").split("/")[0].replace(/^0+/, "").toUpperCase();
    if (wantNum && gotNum && wantNum !== gotNum) continue;

    // Print run, asymmetric the same way it is everywhere else: a 1st Edition
    // card must be answered by a 1st Edition sale, an Unlimited one only has
    // explicit 1st Edition sales ruled out.
    if (card.firstEdition === true && r.isFirstEdition !== true) continue;
    if (card.firstEdition === false && r.isFirstEdition === true) continue;

    // Language, now a field rather than a guess off the title.
    const gotLang = apifyLanguage(r);
    if (wantLang === "en") { if (gotLang && gotLang !== "en") continue; }
    else if (gotLang !== wantLang) continue;

    out.push(row);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
