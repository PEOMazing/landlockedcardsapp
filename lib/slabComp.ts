// sl-v1. What a slab we already own is worth, from eBay sold prices.
//
// This is the other half of lib/gradedSales. That module answers "is this raw
// card worth sending off" and deliberately returns ONE sale per grade, because
// the question there is what somebody actually paid for one. This module
// answers "what is the slab in my hand worth", which is a question about a
// population, so it takes a median.
//
// Until now every graded card in the collection was priced by hand off eBay
// solds - 41 of them, $21,409 of comp, 40% of the book's value sitting on
// numbers somebody typed in once. Hand-priced is the right SOURCE for a slab,
// since the TCGplayer raw feed has no grade dimension at all and lib/comp's
// RAW_CONDITIONS deliberately locks slabs out of the nightly rotation. What was
// wrong was that it was also hand-COMPUTED, so nothing recorded which sales a
// number came from or when it stopped being true.
//
// Everything here is pure. The network call lives in the route, same split as
// gradedSales, because what is hard about this is not fetching.

import {
  CardLike,
  foldNumber,
  gradedQuery,
  langOf,
  languageMatches,
  printingKind,
  SaleRow,
} from "./gradedSales";
import { medianOf, round2, roundUpDollar, WASH_FRACTION, windowCutoff } from "./salesWindow";
import { normalizeGrade } from "./slab";

export type { SaleRow } from "./gradedSales";

/** The graders that appear in the Condition column, longest first so "Other
 *  Graded" cannot be read as a grader called "Other". */
const GRADERS = ["PSA", "BGS", "CGC", "SGC"] as const;

export type SlabGrade = { grader: string; grade: string };

/** Which grader and grade a Condition value means.
 *
 *  Null for "Other" and "Other Graded", which say a card is in a case and
 *  nothing else. A comp cannot be looked up for a grade nobody named, and
 *  guessing one would put a PSA 10 price on a PSA 4. Those stay hand-priced,
 *  and the route says so rather than pretending it tried.
 *
 *  lib/slab.ts owns the list of what counts as a slab. This owns what the
 *  string MEANS, which is a different job: slab.ts has to answer "does this
 *  card get a binder pocket" for conditions it has never heard of, and gets
 *  that right by listing them. Parsing here stays tolerant for the opposite
 *  reason - a grade somebody types next year should price itself. */
export function parseSlabGrade(condition: string | null | undefined): SlabGrade | null {
  // sl-v3. Normalised first, so a grade written the way a grading company or a
  // Collectr export writes it parses as well as the short form we store.
  // "PSA 10.0 GEM - MT" used to fall straight through to null here, which meant
  // the comp route reported "does not name a grade" for 49 of 82 real PSA 10s.
  const s = normalizeGrade(condition);
  if (!s) return null;
  for (const g of GRADERS) {
    // Anchored, so "Other Graded" does not match on a grader hiding in the
    // middle of it, and the number has to be the whole rest of the string.
    const m = new RegExp(`^${g}\\s+(10|\\d(?:\\.5)?)$`, "i").exec(s);
    if (m) return { grader: g, grade: m[1] };
  }
  return null;
}

/** How recent a graded sale has to be to count. Deliberately the same 30 days
 *  lib/salesWindow uses for raw cards, not a longer window: a slab market is
 *  thinner, but a stale price is stale at any grade and the fallback below
 *  discloses an older sale rather than quietly averaging it in. */
export const SLAB_WINDOW_DAYS = 30;

/** How many sales inside the window decide the price.
 *
 *  Five, per the spec, and the cap matters as much as the window. A popular
 *  PSA 10 can sell twenty times a month; letting all twenty in would make the
 *  comp a month-long average on liquid cards and a single sale on thin ones -
 *  two different statistics wearing one name. Five newest is the same
 *  statistic either way. */
export const SLAB_MAX_SALES = 5;

export type SlabParams = Record<string, string>;

/** The request for one slab: this grader, this grade, nothing else.
 *
 *  One grade rather than gradedSales' five, because here we know which grade we
 *  hold. Asking for all of them would spend the same quota and then throw most
 *  of the answer away.
 *
 *  `days` is wider than the window on purpose. The feed is asked for a year so
 *  that a card with nothing inside 30 days still has an older sale to fall back
 *  on and disclose; narrowing the request to the window would make "no sales in
 *  30 days" and "no sales ever" look identical. */
export function slabParams(card: CardLike, g: SlabGrade, days = 365): SlabParams {
  const p: SlabParams = {
    q: gradedQuery(card),
    graded: "true",
    grader: g.grader,
    grade: g.grade,
    cards: "1",
    exclude: "junk",
    days: String(days),
  };
  if (printingKind(card) === "first") p.first_edition = "true";
  // sl-v2. Narrow the request for a non-English slab.
  //
  // Only when it is not English, same rule gradedParams uses: asking the feed
  // for English would drop every title that names no language, which is most
  // honest English listings. For a Japanese, Chinese or Korean slab the
  // opposite holds - sellers do say so - and narrowing upstream spends the
  // quota on sales that can actually answer instead of on English ones that
  // get thrown away here.
  //
  // Not the whole fix on its own. An English slab's results come back
  // unfiltered by this, so slabSaleMatches checks the language again on the
  // way in. Both halves are needed: this one for the quota, that one for
  // correctness.
  const lang = langOf(card);
  if (lang !== "en") p.lang = lang;
  return p;
}

/** Whether a sale the feed parsed is really this slab.
 *
 *  Stricter than the raw-card version in one way: the grade has to match
 *  exactly. A PSA 9 sale is not evidence for a PSA 10 and the gap between them
 *  is routinely 5x, so a near miss here is worse than no answer. Grade is
 *  compared as a number, because "10" and "10.0" are the same grade and the
 *  feed is not consistent about which it hands back. */
export function slabSaleMatches(item: any, card: CardLike, g: SlabGrade): boolean {
  const c = item?.card;
  if (!c || c.graded === false) return false;
  if (String(c.grader || "").toUpperCase() !== g.grader.toUpperCase()) return false;
  const got = Number(c.grade);
  const want = Number(g.grade);
  if (!Number.isFinite(got) || got !== want) return false;

  const wantNum = foldNumber(card.number);
  const gotNum = foldNumber(c.card_number);
  if (wantNum && gotNum && wantNum !== gotNum) return false;

  // Same asymmetry as gradedSales, same reason: for an Unlimited card only an
  // explicit 1st Edition sale is dropped, for a 1st Edition card the sale has
  // to say so, because being quoted Unlimited money on a 1st Edition slab is
  // the expensive direction to be wrong in.
  const run = printingKind(card);
  if (run === "unlimited" && c.first_edition === true) return false;
  if (run === "first" && c.first_edition !== true) return false;

  // sl-v2. An English slab must not be priced off a Japanese sale, and the
  // request cannot be trusted to have handled it: for an English card no lang
  // is sent at all, on purpose, so everything comes back. This is where it
  // gets decided. See languageMatches for why the rule is asymmetric.
  if (!languageMatches(item, card)) return false;

  return Number(item?.price) > 0 && !!item?.last_sold;
}

/** Low sales, thrown out before the median, measured against the MEDIAN of the
 *  window rather than its high.
 *
 *  This is deliberately not salesWindow's dropWashSales, and the difference is
 *  the whole point. That one compares every sale to the highest in the window,
 *  which means a single absurd high sale raises the bar under all the real ones
 *  and throws THEM out instead. Sales of $100, $110 and $900 keep only the
 *  $900: every legitimate sale is below a fifth of it. The rule written to stop
 *  one bad sale deciding a price hands that bad sale the price outright, and it
 *  is the expensive direction to fail in.
 *
 *  A median barely moves when one sale is absurd, so measuring against it cuts
 *  the lows it was meant to cut and leaves a high outlier to be diluted by the
 *  median itself. Same threshold, same one-sided intent, no hijack.
 *
 *  Kept local on purpose. dropWashSales has the same weakness, but it prices
 *  722 raw cards today and quietly changing their comps is a separate decision
 *  from building this. */
export function dropLowOutliers<T extends { price: number }>(sales: T[]): T[] {
  const real = (sales || []).filter((s) => Number(s?.price) > 0);
  if (real.length < 3) return real;
  const floor = round2(medianOf(real.map((s) => s.price)) * WASH_FRACTION);
  const kept = real.filter((s) => s.price >= floor);
  // Never discard everything. If the whole window looks wrong the problem is
  // the comparison, not the sales, and a blank comp over a real one is worse
  // than a wide one.
  return kept.length > 0 ? kept : real;
}

const day = (s: unknown) => String(s ?? "").slice(0, 10);

/** Every matching sale, newest first.
 *
 *  Sorted here rather than trusting the feed's order, for the same reason
 *  latestByGrade does it: page order is not date order, and everything
 *  downstream takes "the newest five" off the front of this list. */
export function slabSales(items: any[], card: CardLike, g: SlabGrade): SaleRow[] {
  const out: SaleRow[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!slabSaleMatches(item, card, g)) continue;
    out.push({
      date: day(item.last_sold),
      price: Math.round(Number(item.price) * 100) / 100,
      title: String(item.title || ""),
      url: String(item.url || ""),
      format: String(item.format || ""),
      bestOffer: !!item.best_offer,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export type SlabCompResult = {
  /** The comp, whole dollars, rounded up the same way raw comps are. */
  price: number;
  /** The sales the median was taken over, newest first. */
  used: SaleRow[];
  /** Low sales thrown out before the median. Kept on the result rather than
   *  discarded so a screen can show the working: a comp that ignores a real
   *  sale should say which one and let a person disagree. */
  dropped: SaleRow[];
  /** Nothing sold inside the window, so this is one older sale. */
  stale: boolean;
  /** Date of the newest sale behind the number. */
  asOf: string;
};

/** The comp, from sales already matched and sorted newest first.
 *
 *  The rule, in order:
 *    1. keep sales inside the 30 day window
 *    2. take the newest five of those
 *    3. throw out low outliers
 *    4. median of what is left
 *
 *  Step 3 cuts low only, which is what was asked for and is worth being
 *  explicit about because it is not symmetric. It protects against the real
 *  attack on sold data - list a slab far under value, have it bought
 *  instantly, drag every published average down with it - and it reuses
 *  salesWindow's existing WASH_FRACTION threshold rather than introducing a
 *  second number that means almost the same thing. See dropLowOutliers for why
 *  it measures that threshold against the median and not the high.
 *
 *  What it does not protect against is one optimistic auction result walking a
 *  comp up, so on a thin card this rule is biased high by design. That is why
 *  `used.length` comes back on the result and the route writes it to Comp
 *  Sales: the existing isThinComp warning then fires on a two sale slab comp
 *  without anything new having to know about slabs.
 *
 *  Null when there are no sales at all, which is a real answer and means leave
 *  the hand-entered comp alone. */
export function slabComp(sales: SaleRow[], now: Date = new Date()): SlabCompResult | null {
  const real = (sales || [])
    .filter((s) => Number(s?.price) > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (real.length === 0) return null;

  const cutoff = windowCutoff(now);
  const fresh = real.filter((s) => String(s.date) >= cutoff);

  // Nothing inside the window. One older sale, labelled, rather than a median
  // over a year of a market that has since moved: a slab that last traded in
  // March is worth saying so about, not worth averaging March into October.
  if (fresh.length === 0) {
    const last = real[0];
    return { price: roundUpDollar(last.price), used: [last], dropped: [], stale: true, asOf: last.date };
  }

  const window = fresh.slice(0, SLAB_MAX_SALES);
  const kept = dropLowOutliers(window);
  const keptSet = new Set(kept);
  const dropped = window.filter((s) => !keptSet.has(s));
  const price = roundUpDollar(medianOf(kept.map((s) => s.price)));
  return { price, used: kept, dropped, stale: false, asOf: kept[0]?.date || window[0].date };
}

/** How a slab comp is written down.
 *
 *  Carries the word "solds" so lib/pricingHealth's basisOf classifies it as
 *  sales-derived without having to learn about slabs. It IS sales-derived; the
 *  only difference from a raw comp is which venue the sales came from, and the
 *  string says eBay so nobody goes looking for these on TCGplayer.
 *
 *  The dropped count is named rather than silently absorbed, because a comp
 *  that set a real sale aside is the one somebody is most likely to want to
 *  check. */
export function slabCompSource(g: SlabGrade, r: SlabCompResult): string {
  const grade = `${g.grader} ${g.grade}`;
  if (r.stale) {
    return `eBay solds (${grade}, last sale ${r.asOf}, none in ${SLAB_WINDOW_DAYS}d)`;
  }
  const base = `eBay solds (${grade}, median of ${r.used.length} in last ${SLAB_WINDOW_DAYS}d)`;
  if (r.dropped.length === 0) return base;
  const n = r.dropped.length;
  return `${base}, ${n} low ${n === 1 ? "sale" : "sales"} set aside`;
}
