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
import {
  dropLowOutliers,
  medianOf,
  round2,
  roundUpDollar,
  WASH_FRACTION,
  windowCutoff,
} from "./salesWindow";
import { normalizeGrade } from "./slab";

export { dropLowOutliers } from "./salesWindow";

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

// ---------------------------------------------------------------------------
// Asks that are not prices
// ---------------------------------------------------------------------------

/** How far apart two price levels must sit before we call it a repricing
 *  rather than noise. Two times. Chosen because it is comfortably outside the
 *  spread of a normal market in one card - the sales behind a healthy comp sit
 *  within tens of percent of each other, not multiples - and because anything
 *  looser starts firing on ordinary condition and timing variance. */
export const STEP_FACTOR = 2;

/** How many recent sales have to agree before a new level is believed.
 *
 *  Two, and this is the load-bearing number in the whole module. One sale at a
 *  new price is noise: a shill, a bad listing, an ask misread as a sale, a
 *  buyer who did not look. Two independent sales at the same new level is a
 *  market. This encodes the standard a careful human applies by hand, and it is
 *  what stops the $15,000 Darkrai row from ever moving a comp on its own. */
export const STEP_MIN_RECENT = 2;

/** How many sales have to establish the level the card supposedly LEFT.
 *
 *  Also two, and symmetry is the entire argument. A test that demanded two
 *  corroborating sales at the new price but accepted a single sale as proof of
 *  the old one would let one stale outlier declare a repricing. Caught by its
 *  own test: five sales between $90 and $110 preceded by a lone $1,000 was
 *  being reported as a 9x crash, when the honest reading is that the $1,000 is
 *  the odd sale and the card is a $100 card.
 *
 *  One sale is noise in whichever direction it points. */
export const STEP_MIN_OLDER = 2;

/** How far back to look for the OLD level when testing for a step.
 *
 *  Wider than the comp window on purpose. To see that a card has moved you need
 *  the ground it moved from, and the 30 day window may contain only the new
 *  level. This history is used to classify, never to price. */
export const STEP_LOOKBACK_DAYS = 90;

/** Cap on how many sales the step test considers. A liquid card can sell fifty
 *  times a quarter and the fiftieth tells you nothing about today. */
export const STEP_MAX_POOL = 12;

/** Past this much movement it is not a repricing, it is bad data.
 *
 *  CALIBRATED, not derived, and worth saying so. Two real observations fix the
 *  line, one on each side:
 *
 *    - Darkrai Prism Star English PSA 10 genuinely moved 5.8x, from a $1,550
 *      median across Jun-Sep to $9,000 in October, confirmed by two sales and
 *      by the Japanese printing following it. A ceiling at 5 rejected that.
 *    - Sales of $20 and $25 followed two days later by $480, $500 and $520
 *      read as a 22x move. Cards do not go up 22x in 48 hours; sellers do wash
 *      two cheap copies before listing the real one.
 *
 *  So the boundary sits somewhere between 5.8 and 22, and 10 is the round
 *  number in that gap with real margin on both sides. Over the ceiling the
 *  problem goes back to dropLowOutliers, which reads the cheap cluster as wash
 *  trading and gets it right.
 *
 *  Known limit, written down rather than left to be found: a genuine crash of
 *  more than 10x inside the lookback will lag until the old sales age out.
 *  That errs toward over-valuing briefly, which is the wrong direction for a
 *  surprise set, so a card you believe has crashed hard is worth a human
 *  look. */
export const STEP_MAX_GAP = 10;

/** Is this row a price, or just what somebody was asking?
 *
 *  THE FAILURE THIS EXISTS FOR, observed in the wild on 2026-10-16: eBay
 *  publishes the asking price on an accepted Best Offer and suppresses what
 *  actually changed hands. A Darkrai listed at $15,000 sold for $8,500. One
 *  vendor's feed recorded a $15,000 fixed-price sale. The error only ever
 *  points one way, because an accepted offer is by definition at or below the
 *  ask, and it is largest on exactly the expensive negotiated cards where being
 *  wrong costs the most.
 *
 *  So an ask is not a price and must never be averaged with prices. Two signals
 *  mark one:
 *
 *    - the feed says so, via askOnly, which adapters set when the source
 *      returns a null or missing sold price on a negotiated sale
 *    - the row is flagged best-offer AND its price is exactly the asking price,
 *      which is what a mis-ingest looks like from the outside
 *
 *  The second test is the one that catches a vendor who does not know its own
 *  data is wrong. A genuine accepted offer essentially never lands on the ask
 *  to the cent; a feed that substituted the ask lands on it every time. */
export function isPricedSale(s: SaleRow): boolean {
  if (!(Number(s?.price) > 0)) return false;
  if (s.askOnly === true) return false;
  if (s.bestOffer && Number(s.askingPrice) > 0 && round2(Number(s.askingPrice)) === round2(s.price)) {
    return false;
  }
  return true;
}

/** The sales a comp may be computed from, newest first. */
export function pricedSales(sales: SaleRow[]): SaleRow[] {
  return (sales || [])
    .filter(isPricedSale)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ---------------------------------------------------------------------------
// Step changes
// ---------------------------------------------------------------------------

export type StepChange = {
  direction: "up" | "down";
  /** The sales at the current level, newest first. */
  recent: SaleRow[];
  /** The sales at the level the card left. */
  older: SaleRow[];
  /** How many times apart the two levels sit, at their closest edges. */
  gap: number;
};

/** Did this card reprice inside the window?
 *
 *  THE BUG THIS FIXES. A median over a fixed window assumes the price is flat
 *  across that window. When a card gaps mid-window the median is a blend of two
 *  different markets and matches neither. The real case: Darkrai PSA 10 sold
 *  twice at $2,000 and once at $2,500 in late September, then $8,500 and
 *  $9,499.99 in October. The median of those five is $2,500 - below every
 *  October sale and above every September one. It is not a compromise, it is an
 *  answer that was never true on any day.
 *
 *  The test is a split of the time-ordered sales into a recent group and an
 *  older group, scored by how cleanly the two separate:
 *
 *    - the recent group must hold at least STEP_MIN_RECENT sales, so one print
 *      cannot move anything
 *    - the recent group must be a LEVEL and not a scatter, so its own high over
 *      its own low must stay inside STEP_FACTOR. This is what rejects a lone
 *      spike: pair $15,000 with the $2,500 beneath it and the group spans 6x,
 *      which is not a level, so no split containing the spike ever qualifies
 *    - the two groups must not overlap, and their nearest edges must sit
 *      STEP_FACTOR apart
 *
 *  Among qualifying splits the widest gap wins, which picks the tightest recent
 *  cluster rather than the largest one. Symmetric by design: a card that
 *  crashes needs repricing just as urgently as one that runs, and carrying a
 *  dead card at its old number is how you end up putting it in a surprise set.
 *
 *  Null means no step, which is the normal and most common answer. */
export function detectStepChange(sales: SaleRow[]): StepChange | null {
  const s = sales || [];
  if (s.length < STEP_MIN_RECENT + STEP_MIN_OLDER) return null;

  let best: StepChange | null = null;
  for (let k = STEP_MIN_RECENT; k <= s.length - STEP_MIN_OLDER; k++) {
    const recent = s.slice(0, k);
    // The old level gets its own wash filter before it is measured.
    //
    // Without this, a single cheap sale sitting under a real one turns a
    // two-sale "old level" into a fiction: sales of $500, $520, $480 and $25
    // split into [$500,$520] against [$480,$25], whose median of $252 made a
    // 2.02x "repricing" out of one wash trade. The $25 is not half of an old
    // market, it is the thing dropLowOutliers exists to remove, so remove it
    // here too and then see whether enough of an old level is left to argue
    // with.
    const older = dropLowOutliers(s.slice(k));
    if (older.length < STEP_MIN_OLDER) continue;
    const rp = recent.map((x) => x.price);
    const op = older.map((x) => x.price);
    const rMin = Math.min(...rp);
    const rMax = Math.max(...rp);
    const oMin = Math.min(...op);
    const oMax = Math.max(...op);
    if (!(rMin > 0) || !(oMin > 0)) continue;

    // A new level has to look like a level.
    if (rMax / rMin >= STEP_FACTOR) continue;

    // Two tests, and they do different jobs.
    //
    // SEPARATION is measured edge to edge and must be total: every sale at the
    // new level sits above every sale at the old one, or below every one. This
    // is the strict half, and it is what stops two overlapping scatters from
    // being read as two markets.
    //
    // MAGNITUDE is measured median to median. It used to be measured edge to
    // edge as well, and that was too strict in a way the sweep caught: Dark
    // Weezing 1st Edition PSA 10 sold at $1,055 to $1,550 through September
    // and $3,050 to $3,999 in October, a 3.5x move by any sane reading. The
    // edge ratio was 3050/1550 = 1.97 and the step was rejected for being
    // 0.03 under the bar, because one September sale happened to run high. A
    // single sale at the top of the old cluster should not be able to hide a
    // move; that is the same mistake as anchoring the wash filter on the
    // window high, in a different place.
    const up = rMin > oMax;
    const down = rMax < oMin;
    if (!up && !down) continue;
    const rMed = medianOf(rp);
    const oMed = medianOf(op);
    if (!(rMed > 0) || !(oMed > 0)) continue;
    const gap = up ? rMed / oMed : oMed / rMed;
    if (gap < STEP_FACTOR || gap > STEP_MAX_GAP) continue;

    if (!best || gap > best.gap) {
      best = { direction: up >= down ? "up" : "down", recent, older, gap: round2(gap) };
    }
  }
  return best;
}

/** A single in-window sale that disagrees with the card's own recent history.
 *
 *  THE GAP THE FIRST CUT LEFT, found by running the new rule against real
 *  130point data on 88 slabs rather than against my own test fixtures.
 *
 *  The Japanese Darkrai Prism Star (SM12a 077/173) PSA 10 sold at $102.50,
 *  $150.97, $192.87 and $148.39 through August and September, then once at
 *  $784.90 on 14 October. Only that last sale falls inside the 30 day window.
 *  The step detector cannot speak, because it needs two sales to believe a new
 *  level. The low-outlier filter cannot speak, because it only cuts lows. So
 *  the comp became $784.90 on the evidence of one sale, five times what the
 *  card had traded at all autumn.
 *
 *  That is the same shape as Espeon on the raw path, which lib/comp has had a
 *  demotion guard for since the import that created it. The slab path had
 *  nothing. This is that guard.
 *
 *  One-directional on purpose, matching lib/comp. A lone high is demoted
 *  because believing it over-values the card and an over-valued slab anchors a
 *  surprise set. A lone LOW is left alone, because it is as likely to be the
 *  start of a real decline as a wash sale, and the thin-sales flag already
 *  says the comp rests on one print.
 *
 *  If a second sale arrives at the new level, detectStepChange fires first and
 *  the card reprices properly. That is the intended path from "one print" to
 *  "a market", and it is why this guard and the step test share STEP_FACTOR. */
export function demoteLoneHigh(
  fresh: SaleRow[],
  older: SaleRow[],
  peerMove?: PeerMove,
): { price: number; peers: SaleRow[] } | null {
  if (fresh.length === 0 || fresh.length >= STEP_MIN_RECENT) return null;
  if (older.length < STEP_MIN_OLDER) return null;
  const peerMed = medianOf(older.map((s) => s.price));
  if (!(peerMed > 0)) return null;
  if (!(fresh[0].price > peerMed * STEP_FACTOR)) return null;
  // A related printing moving the same way is corroboration this card's own
  // sales cannot supply. See corroboratedBy.
  if (corroboratedBy(fresh[0].price / peerMed, peerMove)) return null;
  return { price: roundUpDollar(peerMed), peers: older.slice(0, SLAB_MAX_SALES) };
}

/** A move on a RELATED printing of the same card: the English copy when this
 *  is the Japanese one, or the reverse. `factor` is how far that printing
 *  moved, old median to new. */
export type PeerMove = { factor: number; label: string };

/** How far a sibling's move may differ and still count as corroboration.
 *
 *  Twice, in either direction, which is loose on purpose. The claim being
 *  tested is "these two printings move together", not "they move by identical
 *  multiples", and demanding precision would reject the correlation exactly
 *  when it is most useful - on the thin card with one sale. */
export const PEER_TOLERANCE = 2;

/** Does a sibling printing's move explain this card's lone high sale?
 *
 *  WHY THIS EXISTS, and it is Gabe's observation rather than mine. The
 *  Japanese Darkrai Prism Star had one sale inside the window, $784.90, five
 *  times its own recent history, and demoteLoneHigh threw it out as
 *  unconfirmed. It was confirmed, just not by anything this function could
 *  see: the English printing had stepped to $9,000 six days earlier, and the
 *  two printings had tracked each other at 11 to 13x all year. At September's
 *  ratio a $9,000 English card implies about $682 for the Japanese. The sale
 *  was $784.90.
 *
 *  So the sale was not an outlier, it was the second half of a move. A rule
 *  that only ever reads one card's own sales is structurally blind to that,
 *  and the fix is to let the caller pass in what the sibling did rather than
 *  to loosen the guard for everybody.
 *
 *  Deliberately one-directional and deliberately requires the caller to supply
 *  the peer: inferring which cards are siblings is a matching problem, and
 *  guessing it wrong would launder an outlier on an unrelated card. */
export function corroboratedBy(moveFactor: number, peer?: PeerMove): boolean {
  if (!peer || !(peer.factor > 1) || !(moveFactor > 1)) return false;
  return (
    moveFactor >= peer.factor / PEER_TOLERANCE && moveFactor <= peer.factor * PEER_TOLERANCE
  );
}

/** How far a comp result says the card moved, for feeding to a sibling as a
 *  PeerMove. Null when the card did not move. */
export function moveFactorOf(r: SlabCompResult | null): number | null {
  if (!r?.step || r.step.direction !== "up" || !(r.step.from > 0)) return null;
  return round2(r.step.to / r.step.from);
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
    const ask = Number(item.asking_price);
    // sl-v5. A negotiated sale the feed could not read is marked, not dropped
    // here and not quietly trusted either. "confirmed" and "likely" carry a
    // real accepted amount; "unlikely" and "unknown" mean the number on the row
    // may be the ask. No confidence field at all is the older shape of the
    // feed, where the price is taken at face value and isPricedSale's
    // ask-equals-price test is the remaining guard.
    const conf = String(item.best_offer_confidence || "").toLowerCase();
    const unreadable = conf === "unlikely" || conf === "unknown";
    out.push({
      date: day(item.last_sold),
      price: Math.round(Number(item.price) * 100) / 100,
      title: String(item.title || ""),
      url: String(item.url || ""),
      format: String(item.format || ""),
      bestOffer: !!item.best_offer,
      ...(ask > 0 ? { askingPrice: round2(ask) } : {}),
      ...(item.best_offer && unreadable ? { askOnly: true } : {}),
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
  /** Set when the card repriced and the comp was taken off the new level only.
   *  `from` and `to` are the two medians, so a screen can say how far it moved
   *  and a person can disagree with the call. */
  step?: { direction: "up" | "down"; gap: number; from: number; to: number };
  /** A single in-window sale was set aside because the card's own older sales
   *  outvoted it. `claimed` is what that sale said the card was worth. */
  demoted?: { claimed: number; peers: number };
  /** Rows thrown out because the feed gave an asking price and not a sale
   *  price. Kept so the count can be shown: "priced off 3 of 5 sales, 2 were
   *  negotiated and eBay does not publish what they went for" is a far more
   *  useful thing to read than a bare number. */
  askOnly: SaleRow[];
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
export function slabComp(
  sales: SaleRow[],
  now: Date = new Date(),
  opts: { peerMove?: PeerMove } = {},
): SlabCompResult | null {
  const all = (sales || []).filter((s) => Number(s?.price) > 0);
  const real = pricedSales(all);
  const askOnly = all
    .filter((s) => !isPricedSale(s))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // Every sale we have is an unreadable negotiated one. That is not "no
  // sales", it is "sales we are not allowed to see", and the two deserve
  // different answers. Leave the comp alone rather than invent one from asks.
  if (real.length === 0) return null;

  const cutoff = windowCutoff(now);
  const fresh = real.filter((s) => String(s.date) >= cutoff);
  const stepCutoff = new Date(now.getTime() - STEP_LOOKBACK_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  const pool = real.filter((s) => String(s.date) >= stepCutoff).slice(0, STEP_MAX_POOL);

  // sl-v5. Before taking any median, ask whether the sales in front of us
  // describe one market or two. They described two on 2026-10-16 and the
  // median answered with a number that had never been true.
  //
  // The step test gets a wider pool than the comp does, because recognising
  // that a card has moved needs the ground it moved from, and that ground may
  // sit outside the 30 day window. The pool classifies; it never prices.
  //
  // Run before the stale branch, not after. A card that repriced and then went
  // quiet is still a repriced card, and medianing its two levels together
  // would be the original bug wearing a different hat.
  const step = detectStepChange(pool);

  // Nothing inside the window.
  //
  // sl-v6. This used to return the single newest sale. That was needlessly
  // crude whenever the card has history just outside the window: Misty's
  // Gyarados PSA 9 had nineteen sales in the lookback and the rule picked the
  // single highest auction result off the top of them. A median over the
  // recent ones is the same statistic the fresh path uses and far harder to
  // fool.
  //
  // Still labelled stale, and still dated to the newest sale, because the
  // point of the flag is that the market has had time to move since.
  if (fresh.length === 0) {
    const recent = (step ? step.recent : pool.length > 0 ? pool : real).slice(0, SLAB_MAX_SALES);
    const kept = dropLowOutliers(recent);
    const keptSet = new Set(kept);
    const price = roundUpDollar(medianOf(kept.map((s) => s.price)));
    return {
      price,
      used: kept,
      dropped: step ? step.older : recent.filter((s) => !keptSet.has(s)),
      stale: true,
      asOf: recent[0].date,
      ...(step
        ? {
            step: {
              direction: step.direction,
              gap: step.gap,
              from: roundUpDollar(medianOf(step.older.map((s) => s.price))),
              to: price,
            },
          }
        : {}),
      askOnly,
    };
  }

  // A step only reprices the card if the new level is itself current. A move
  // that finished six weeks ago with nothing since is a stale card, and the
  // branch above already handles those honestly.
  if (step && String(step.recent[0].date) >= cutoff) {
    const used = step.recent.slice(0, SLAB_MAX_SALES);
    // Whole dollars, same rounding as the comp itself, so the "was $X, now $Y"
    // in the source string cannot disagree with the number in the Comp column
    // by a cent of float noise.
    const from = roundUpDollar(medianOf(step.older.map((s) => s.price)));
    const to = roundUpDollar(medianOf(used.map((s) => s.price)));
    return {
      price: to,
      used,
      // The old level is not an outlier and is not labelled one. It is a real
      // market that this card has left, and it goes in `dropped` so the screen
      // can show it being set aside deliberately.
      dropped: step.older,
      stale: false,
      asOf: used[0].date,
      step: { direction: step.direction, gap: step.gap, from, to },
      askOnly,
    };
  }

  // sl-v6. One recent sale, and the card's own history disagrees with it.
  // Checked after the step test, so two agreeing sales always win over this.
  const older = pool.filter((s) => String(s.date) < cutoff);
  const lone = demoteLoneHigh(fresh, older, opts.peerMove);
  if (lone) {
    return {
      price: lone.price,
      used: lone.peers,
      dropped: fresh,
      stale: false,
      asOf: lone.peers[0].date,
      demoted: { claimed: fresh[0].price, peers: lone.peers.length },
      askOnly,
    };
  }

  const window = fresh.slice(0, SLAB_MAX_SALES);
  const kept = dropLowOutliers(window);
  const keptSet = new Set(kept);
  const dropped = window.filter((s) => !keptSet.has(s));
  const price = roundUpDollar(medianOf(kept.map((s) => s.price)));
  return {
    price,
    used: kept,
    dropped,
    stale: false,
    asOf: kept[0]?.date || window[0].date,
    askOnly,
  };
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
  const parts: string[] = [];

  if (r.stale) {
    const n = r.used.length;
    parts.push(
      n === 1
        ? `eBay solds (${grade}, last sale ${r.asOf}, none in ${SLAB_WINDOW_DAYS}d)`
        : `eBay solds (${grade}, median of ${n} up to ${r.asOf}, none in ${SLAB_WINDOW_DAYS}d)`,
    );
  } else if (r.demoted) {
    // Name the sale that was rejected. It is the thing somebody is most likely
    // to want to argue with, and a comp that quietly ignored the only recent
    // sale on the card invites being "corrected" straight back to it.
    parts.push(
      `eBay solds (${grade}, median of ${r.used.length} older sales; ` +
        `one sale at $${r.demoted.claimed.toLocaleString("en-US")} set aside, ` +
        `unconfirmed by any other sale)`,
    );
  } else if (r.step) {
    // Say the move out loud, with both levels and the date it is priced from.
    // A comp that has deliberately ignored older sales owes the reader that,
    // because the alternative is a number that looks like it came out of
    // nowhere and gets "corrected" back to the stale one by the next person.
    const dir = r.step.direction === "up" ? "repriced up" : "repriced down";
    parts.push(
      `eBay solds (${grade}, ${dir} ${r.step.gap}x: median of ${r.used.length} at the new level ` +
        `as of ${r.asOf}, was $${r.step.from.toLocaleString("en-US")}, ` +
        `${r.dropped.length} older ${r.dropped.length === 1 ? "sale" : "sales"} not counted)`,
    );
  } else {
    const base = `eBay solds (${grade}, median of ${r.used.length} in last ${SLAB_WINDOW_DAYS}d)`;
    const n = r.dropped.length;
    parts.push(n === 0 ? base : `${base}, ${n} low ${n === 1 ? "sale" : "sales"} set aside`);
  }

  // Unreadable negotiated sales are disclosed rather than hidden. If three of
  // five sales were accepted Best Offers that eBay will not publish, the comp
  // rests on two sales and the reader should know the sample was cut, not just
  // that it was small.
  const n = r.askOnly.length;
  if (n > 0) {
    parts.push(`${n} negotiated ${n === 1 ? "sale" : "sales"} excluded, price not published`);
  }
  return parts.join("; ");
}
