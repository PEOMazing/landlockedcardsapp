// gt-v1. Is this card worth sending off to be graded?
//
// lib/gradedSales already answers "what did this card last sell for at each
// PSA grade". That is evidence. This turns the evidence into a decision, which
// needs two more things the price alone does not carry: what grading costs,
// and what the submission tier will actually accept.
//
// The cost is the whole story here and it is unusually large. Gabe's open tier
// is $59.99 a card with a $1,000 insured ceiling and a 90 to 100 business day
// turnaround; the bulk tiers are closed to him. At that price a card has to
// clear its raw comp by sixty-odd dollars before grading has done anything at
// all, which rules out most of a binder:
//
//   raw $25  needs the graded price to beat $90   - 3.6x
//   raw $50  needs $115                           - 2.3x
//   raw $100 needs $165                           - 1.65x
//   raw $200 needs $265                           - 1.33x
//
// That maths argues for only grading dear cards. It does NOT argue for only
// LOOKING at dear cards, and the two got confused in the first draft of this
// file. A $5 common whose PSA 10 sells for $500 is the find worth having, and
// a raw-value gate is precisely the filter that would never show it. See the
// note on sweepCandidates.
//
// Nothing here guesses the ODDS of a card landing a given grade. That number
// would make the output look authoritative and it would be invented: nobody
// knows whether a specific card 9s or 10s. So every figure below is
// conditional - "if it 10s, you make this" - and the judgement stays with the
// person holding the card.

export type GradeKey = "10" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2" | "1";

/** gt-v3. Every PSA grade, high to low, and the order anything rendering them
 *  must iterate: object key order cannot be trusted for numeric keys, which
 *  come back 1,2,3...10 whatever order they went in.
 *
 *  Down to 1 on purpose. A PSA 1 is not a joke on vintage - a 1 on a
 *  first-edition holo can still be three figures - and the floor grade is the
 *  honest question: "is this worth sending if it comes back BADLY". */
export const ALL_GRADES: GradeKey[] = ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1"];

/** The three with their own Airtable columns, so they can be sorted on in the
 *  base itself. Every grade is stored in Graded Detail regardless. */
export const TRIAGE_GRADES: GradeKey[] = ["10", "9", "8"];

/** Shipping both ways, per card, on top of the grading fee. A submission goes
 *  insured in both directions and the return leg is the expensive one; spread
 *  over a normal-sized batch it lands near this. Deliberately a constant and
 *  not a setting: it is a rough allocation, and giving it a settings box would
 *  dress up an estimate as a measurement. */
export const SHIP_PER_CARD = 5;

/** What one card costs to get graded, all in. */
export function gradingCost(fee: number, ship: number = SHIP_PER_CARD): number {
  const f = Number(fee);
  // Rounded, because 59.99 + 5 is 64.99000000000001 in binary floating point
  // and that figure then rides through every break-even and net on the page.
  return Math.round(((Number.isFinite(f) && f > 0 ? f : 0) + ship) * 100) / 100;
}

/** What the graded price has to beat for grading to have been worth doing.
 *  Raw comp plus the whole cost, because the raw card is what you give up. */
export function breakEven(rawComp: number | null | undefined, cost: number): number | null {
  const raw = Number(rawComp);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round((raw + cost) * 100) / 100;
}

/** The multiple of raw the card must hit to break even. The shape of the whole
 *  problem in one number: it falls as the card gets dearer, which is why a
 *  fixed fee makes grading a rich-card game. */
export function neededMultiple(rawComp: number | null | undefined, cost: number): number | null {
  const raw = Number(rawComp);
  const be = breakEven(raw, cost);
  if (be === null) return null;
  return Math.round((be / raw) * 100) / 100;
}

/** Dollars made by grading, if the card lands this grade. Negative means the
 *  fee ate it. Null when either side is unknown - "no sale found" must never
 *  render as a $0 profit, which reads as a decision when it is an absence. */
export function netGain(
  rawComp: number | null | undefined,
  gradedPrice: number | null | undefined,
  cost: number,
): number | null {
  const raw = Number(rawComp);
  const g = Number(gradedPrice);
  if (!Number.isFinite(raw) || raw <= 0 || !Number.isFinite(g) || g <= 0) return null;
  return Math.round((g - raw - cost) * 100) / 100;
}

/** Past the tier's insured ceiling, so this submission cannot carry the card.
 *  Checked against the GRADED price, not the raw one: the ceiling is about
 *  what the slab will be worth coming back, and a $700 raw card whose 10 sells
 *  for $2,400 is exactly the card you must not put on a $1,000 tier. */
export function overInsured(gradedPrice: number | null | undefined, maxInsured: number): boolean {
  const g = Number(gradedPrice);
  return Number.isFinite(g) && g > 0 && maxInsured > 0 && g > maxInsured;
}

/** How old the evidence is, in days. A graded sale is often ONE sale, so its
 *  age matters as much as its size: a 10 that last traded fourteen months ago
 *  is a different claim from one that traded last week. */
export function saleAgeDays(saleDate: string | null | undefined, now: Date = new Date()): number | null {
  const s = String(saleDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86400000);
}

/** Evidence old enough that it should be read as history rather than price. */
export const STALE_SALE_DAYS = 180;
export const isStaleSale = (saleDate: string | null | undefined, now?: Date) => {
  const age = saleAgeDays(saleDate, now);
  return age !== null && age > STALE_SALE_DAYS;
};

// gt-v7. Which of these prices should not be believed.
//
// This section exists because of what the first full sweep actually returned,
// and it is worth writing down what happened rather than just the fix.
//
// The per-card panel this grew out of was fine. A human opened one card, saw
// "PSA 10, $100,000, 2026-09-21" with the listing title under it, and either
// believed it or did not. The title was right there.
//
// Ranking 858 cards by that same number is a different thing entirely, and it
// fails in a way the single-card view cannot. Sorting by the best net sorts by
// the LARGEST number, and the largest number in a pile of single observations
// is the most likely one to be wrong. A ranked list built on one sale per
// grade is not a shortlist of the best cards, it is an outlier detector with a
// dollar sign in front of it. Three real examples off the first 240 cards:
//
//   Charizard G Lv.X, Supreme Victors. PSA 8 $2,450, PSA 9 $7,000,
//   PSA 10 $100,000. Right card, right grade, correct title. The 10 is 14x
//   the 9 and a round hundred thousand: an asking price, not a sale.
//
//   Mew, Southern Island. PSA 9 "$3,036.98", title reads "PSA 9 & 8 Japanese
//   Southern Island Complete Set Tropical / Rainbow Island Mew". That is a
//   multi-slab set sold as one lot, recorded as the price of one Mew. The
//   feed's own exclude=junk did not catch it.
//
//   Leafeon LV.X, Majestic Dawn. PSA 8 $10,080, PSA 9 $6,999.99. The 8 above
//   the 9 by three grand. One of those two numbers is not a Leafeon.
//
// All three are mechanically detectable, and detectable from what the sweep
// already stores, which matters: the titles are in Graded Detail, so none of
// this needs a single extra API call over data already paid for.
//
// The direction of the bias is deliberate. Every rule below throws away
// UPSIDE, never adds it, and when a rule cannot tell which of two prices is
// wrong it drops the lower grade and keeps the higher claim out of the
// decision. A flagged real card costs Gabe a click to confirm. An unflagged
// fake card costs $65 and five months.

/** Why a price is not being used. */
export type SuspectReason = "lot" | "inverted" | "round-jump";

export const SUSPECT_WHY: Record<SuspectReason, string> = {
  lot: "the listing looks like more than one card",
  inverted: "priced above a higher grade",
  "round-jump": "a round number far above the grade below it",
};

/** Words that mean a title is not describing one single card.
 *
 *  "complete set" and "lot" are the common ones. Kept narrow on purpose: this
 *  runs against titles of real sales and a word that also appears innocently
 *  would quietly delete good evidence. */
const LOT_WORDS =
  /\b(lots?|bundles?|job\s*lots?|collections?|complete\s+sets?|sets?\s+of|both|pairs?|binders?|reprints?|proxy|proxies|custom)\b/i;

/** "2x", "x2", "3 cards", "4 slabs". */
const MULTI_COUNT = /\b\d{1,3}\s?x\b|\bx\d{1,3}\b|\b\d{1,2}\s+(?:cards?|slabs?|pcs?)\b/i;

/** Two grades named in one title: "PSA 9 & 8", "PSA 10 / 9", "PSA 8 and 7". */
const TWO_GRADES = /\bpsa\s*(?:10|[1-9])\s*(?:&|\+|and|,|\/)\s*(?:10|[1-9])\b/i;

/** Whether this title is selling more than one card.
 *
 *  "Lv.X" is stripped before anything else runs. It is a real part of a card
 *  name on exactly the generation this tool is most useful on, and the bare X
 *  beside a collector number reads as a multiplier to every quantity pattern
 *  there is: without this, "Leafeon LV.X 99/100" is a lot of 99 cards. */
export function lotTitle(title: string | null | undefined): boolean {
  const t = String(title || "");
  if (!t) return false;
  const s = t.replace(/\blv\.?\s*x\b/gi, " ");
  if (LOT_WORDS.test(s)) return true;
  if (MULTI_COUNT.test(s)) return true;
  if (TWO_GRADES.test(s)) return true;
  // Two separate "PSA n" tokens is the same thing said another way.
  const tokens = s.match(/\bpsa\s*(?:10|[1-9])\b/gi) || [];
  return tokens.length > 1;
}

/** A price with a round-number asking-price signature.
 *
 *  Roundness alone proves nothing - real cards sell for $5,000. The jump alone
 *  proves nothing either - a 10 really can be many times the 9 on a low pop
 *  card. It is the two together that no honest sale produces often: a price
 *  that is an exact multiple of a thousand AND several times the grade below
 *  it is somebody's ask that the feed read as a sale. */
export const ROUND_JUMP_MULTIPLE = 4;
export const ROUND_JUMP_FLOOR = 5000;

export function roundJump(price: number, nextLower: number | null): boolean {
  if (!(price >= ROUND_JUMP_FLOOR) || price % 1000 !== 0) return false;
  // Nothing to compare against is not evidence of anything.
  if (nextLower === null || !(nextLower > 0)) return false;
  return price >= ROUND_JUMP_MULTIPLE * nextLower;
}

/** gt-v7. A grade-to-grade jump big enough to be worth a look before acting.
 *
 *  This one is a MARKER, not a rejection, and the difference matters. The
 *  three rules above identify prices that are mechanically wrong - a lot is a
 *  lot whatever the market does. This is a number that is merely unusual, and
 *  unusual is where the real finds live too.
 *
 *  The threshold is measured off Gabe's own binder rather than picked. Across
 *  835 adjacent grade pairs in the first full sweep, the ratio of a grade to
 *  the grade below it ran: median 2.4x, p75 4.9x, p90 8.8x, p95 14.5x, max
 *  1800x. So 9x is roughly the top tenth of his own data - normal enough to
 *  happen, rare enough to be worth a click.
 *
 *  What is NOT used, and the reason is worth recording. My first attempt at a
 *  second rule compared the graded price to the RAW comp and flagged anything
 *  over a few hundred times it. The same measurement killed it: the median
 *  PSA 10 in this binder is 40x its raw comp and the p75 is 107x. That is not
 *  a data problem, it is what a vintage-heavy binder looks like - a Base Set
 *  common is $2 raw and a few hundred dollars in a 10 - and it is Gabe's own
 *  example back at me: "some cards could be $5 but in a 10 are worth $500",
 *  which is exactly 100x. A rule at any threshold low enough to catch the
 *  wrong numbers would have deleted the entire reason the page exists. */
export const JUMP_FLAG_MULTIPLE = 9;

export type SaleQuote = { price: number | null; date: string | null; title?: string | null };

/** Which grades' prices to ignore, and why.
 *
 *  Three passes, in this order, because each one needs the previous one's
 *  output: a lot price must not be used to judge whether another grade is
 *  inverted, and an inverted price must not be the baseline a round jump is
 *  measured against.
 *
 *    1. lot          - the title alone, independent of every other price
 *    2. inverted     - a surviving price above a surviving HIGHER grade
 *    3. round-jump   - a surviving round number far above the one below it
 *
 *  Pass 2 drops the lower grade when two prices disagree. Which of the pair is
 *  wrong is genuinely unknowable from here, and dropping the lower one is the
 *  choice that removes the bigger claim from the decision: the lower grade is
 *  the easier outcome, so an inflated 8 is what makes a card look like a safe
 *  send. */
export function suspectQuotes(
  quotes: Partial<Record<GradeKey, SaleQuote>>,
): Partial<Record<GradeKey, SuspectReason>> {
  const out: Partial<Record<GradeKey, SuspectReason>> = {};
  const price = (g: GradeKey): number | null => {
    if (out[g]) return null;
    const p = Number(quotes[g]?.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  };

  for (const g of ALL_GRADES) {
    if (price(g) !== null && lotTitle(quotes[g]?.title)) out[g] = "lot";
  }

  // High to low, carrying the best surviving price seen at a higher grade.
  let bestAbove: number | null = null;
  for (const g of ALL_GRADES) {
    const p = price(g);
    if (p === null) continue;
    if (bestAbove !== null && p > bestAbove) {
      out[g] = "inverted";
      continue;
    }
    bestAbove = bestAbove === null ? p : Math.max(bestAbove, p);
  }

  // Low to high, so each grade is measured against the nearest surviving
  // grade beneath it.
  let below: number | null = null;
  for (const g of [...ALL_GRADES].reverse()) {
    const p = price(g);
    if (p === null) continue;
    if (roundJump(p, below)) {
      out[g] = "round-jump";
      continue;
    }
    below = p;
  }

  return out;
}

export type GradeQuote = { price: number | null; date: string | null };
export type TriageCard = {
  id: string;
  name: string;
  setName?: string;
  rarity?: string;
  /** gt-v8. The condition of THIS copy: NM, LP, MP, HP, DM, Raw.
   *
   *  Not part of cardGroupKey and deliberately so - a PSA 10 of a card sold
   *  for what it sold for whatever shape your copy is in. It is on the row
   *  because it is the single most important thing the page was not showing.
   *  An LP copy shows a BIGGER net than the NM one beside it, because it is
   *  cheaper to give up, while being far less likely to come back a 9 or a 10.
   *  Both halves of that are true and the page was only printing the first. */
  condition?: string;
  rawComp: number | null;
  /** gt-v7. The title comes in with the price because the title is how a
   *  wrong price is caught. See suspectQuotes. */
  grades: Partial<Record<GradeKey, SaleQuote>>;
  checked?: string | null;
};

export type TriageRow = {
  id: string;
  name: string;
  setName: string;
  rarity: string;
  condition: string;
  rawComp: number | null;
  cost: number;
  breakEven: number | null;
  neededMultiple: number | null;
  /** Per grade: the price, the net after fee, how old the sale is. */
  byGrade: Record<GradeKey, {
    /** The price being USED. Null when there is no sale, and also null when
     *  there is one that suspectQuotes threw out - so nothing downstream can
     *  spend a rejected number by forgetting to check a flag. The number
     *  itself is still available as rejected, for showing the person what was
     *  dropped and letting them overrule it. */
    price: number | null;
    net: number | null;
    ageDays: number | null;
    stale: boolean;
    /** Set when a price was found and not believed. */
    suspect: SuspectReason | null;
    rejected: number | null;
    title: string | null;
  }>;
  /** Net if the card comes back at AT LEAST this grade - that is, the WORST
   *  net among this grade and everything above it. The question "is it worth
   *  sending if I assume an 8 floor" is not "what does the 8 make", it is
   *  "what does the worst plausible outcome make", and a card whose 9 sells
   *  for less than its 8 (it happens, thin markets are noisy) must not pass a
   *  floor test on the strength of the 8 alone. */
  floorNet: Record<GradeKey, number | null>;
  /** The best net across the three grades. The sort key, and null when no
   *  grade has a price at all. */
  bestNet: number | null;
  /** Which grade produced bestNet, for the "only worth it if it 10s" read. */
  bestGrade: GradeKey | null;
  /** The tier cannot insure this card's 10. */
  overInsured: boolean;
  /** Every price we have is older than STALE_SALE_DAYS. */
  allStale: boolean;
  /** gt-v7. How many grades had a price that was not believed, and why. A card
   *  with any of these is on the check list rather than the buy list: the
   *  evidence may be fine and one click on the listing settles it. */
  suspectCount: number;
  suspectReasons: SuspectReason[];
  /** The dearest rejected price, so the check list can be read worst-first:
   *  the $100,000 Charizard is the one to settle before the $5,000 one. */
  topRejected: number | null;
  /** gt-v7. The biggest surviving grade-to-grade jump, when it clears
   *  JUMP_FLAG_MULTIPLE. Not a rejection - a note that this card's case rests
   *  on one sale standing well clear of the one beneath it, which is both what
   *  a genuine low-pop chase card looks like and what a misread listing looks
   *  like. Null when the curve is ordinary or there is nothing to compare. */
  bigJump: { grade: GradeKey; times: number } | null;
  /** gt-v7. How many grades this card's case rests on, after rejections.
   *
   *  Purely a count, with no threshold in it, and it covers the blind spot in
   *  bigJump: a card whose only surviving price is its PSA 10 has nothing to
   *  be compared against, so it cannot be flagged as a big jump however wrong
   *  it is, and it sails to the top of the list looking as solid as a card
   *  with a full curve underneath it. One is worth saying out loud. */
  gradesWithPrice: number;
};

export function triage(
  card: TriageCard,
  opts: { fee: number; maxInsured: number; ship?: number; now?: Date },
): TriageRow {
  const cost = gradingCost(opts.fee, opts.ship ?? SHIP_PER_CARD);
  const now = opts.now ?? new Date();
  const byGrade = {} as TriageRow["byGrade"];
  let bestNet: number | null = null;
  let bestGrade: GradeKey | null = null;
  let seen = 0;
  let stale = 0;

  // gt-v7. Decided once, over all ten grades together, because the rules are
  // about the shape of the curve and cannot be applied a grade at a time.
  const suspect = suspectQuotes(card.grades);
  const suspectReasons: SuspectReason[] = [];
  let topRejected: number | null = null;

  for (const g of ALL_GRADES) {
    const q = card.grades[g] || { price: null, date: null };
    const found = Number.isFinite(Number(q.price)) && Number(q.price) > 0 ? Number(q.price) : null;
    const why = found !== null ? suspect[g] ?? null : null;
    const price = why ? null : found;
    const net = netGain(card.rawComp, price, cost);
    const ageDays = saleAgeDays(q.date, now);
    const isStale = isStaleSale(q.date, now);
    byGrade[g] = {
      price, net, ageDays, stale: isStale,
      suspect: why, rejected: why ? found : null, title: q.title ?? null,
    };
    if (why) {
      if (!suspectReasons.includes(why)) suspectReasons.push(why);
      if (found !== null && (topRejected === null || found > topRejected)) topRejected = found;
    }
    if (price !== null) {
      seen++;
      if (isStale) stale++;
    }
    // Greater-or-EQUAL, walking 10 then 9 then 8, so a tie lands on the
    // lowest grade. If a 9 and a 10 both net $80 the honest answer is the 9:
    // it is the easier outcome and the one the decision should lean on.
    // Strict greater-than kept the 10 here, which overstated every tie.
    if (net !== null && (bestNet === null || net >= bestNet)) {
      bestNet = net;
      bestGrade = g;
    }
  }

  // Walking high to low, the floor net at grade g is the worst net seen from
  // 10 down to g. Grades with no sale on record are skipped rather than
  // treated as zero: an absent 7 should not veto a floor of 6.
  const floorNet = {} as TriageRow["floorNet"];
  let worst: number | null = null;
  for (const g of ALL_GRADES) {
    const net = byGrade[g].net;
    if (net !== null) worst = worst === null ? net : Math.min(worst, net);
    floorNet[g] = worst;
  }

  return {
    id: card.id,
    name: card.name,
    setName: card.setName || "",
    rarity: card.rarity || "",
    condition: card.condition || "Raw",
    rawComp: card.rawComp ?? null,
    cost,
    floorNet,
    breakEven: breakEven(card.rawComp, cost),
    neededMultiple: neededMultiple(card.rawComp, cost),
    byGrade,
    bestNet,
    bestGrade,
    // gt-v7. The DEAREST surviving grade, not the 10.
    //
    // This read byGrade["10"] until the rejection rules went in, and the two
    // together were a quiet regression: on the Charizard the $100,000 ten is
    // rejected, so the ten is null, so the ceiling check passed - on a card
    // whose PSA 9 last sold at $7,000, seven times the $1,000 tier limit. The
    // question is whether any outcome this card could come back as is worth
    // more than the tier will insure, and that is the top of what is left
    // standing, whichever grade it sits at.
    overInsured: ALL_GRADES.some((g) => overInsured(byGrade[g].price, opts.maxInsured)),
    allStale: seen > 0 && stale === seen,
    suspectCount: suspectReasons.length ? ALL_GRADES.filter((g) => byGrade[g].suspect).length : 0,
    suspectReasons,
    topRejected,
    bigJump: biggestJump(byGrade),
    gradesWithPrice: ALL_GRADES.filter((g) => byGrade[g].price !== null).length,
  };
}

/** The largest ratio between a surviving price and the surviving price at the
 *  next grade down, if it clears the flag. Rejected prices take no part: a
 *  price nothing believes must not generate a warning either. */
function biggestJump(
  byGrade: TriageRow["byGrade"],
): { grade: GradeKey; times: number } | null {
  let out: { grade: GradeKey; times: number } | null = null;
  let below: number | null = null;
  for (const g of [...ALL_GRADES].reverse()) {
    const p = byGrade[g].price;
    if (p === null) continue;
    if (below !== null && below > 0) {
      const times = Math.round((p / below) * 10) / 10;
      if (times >= JUMP_FLAG_MULTIPLE && (out === null || times > out.times)) out = { grade: g, times };
    }
    below = p;
  }
  return out;
}

/** gt-v8. Best first BY THE OUTCOMES TICKED, which is not the same ordering
 *  as rankTriage and has to be used wherever the set net is the number on
 *  screen.
 *
 *  Caught by running the real binder through it: ranked by bestNet, the NM
 *  list opened with an Infernape at $2,785 above a Hitmonlee at $8,989,
 *  because the Infernape's best grade was a 10 that the tick set excluded. A
 *  table sorted by one number and displaying another is worse than either
 *  number on its own - it quietly asserts an order the figures contradict. */
export function rankBySet(rows: TriageRow[], grades: GradeKey[]): TriageRow[] {
  const net = new Map(rows.map((r) => [r.id, setNet(r, grades)]));
  return [...rows].sort((a, b) => {
    const x = net.get(a.id) ?? null;
    const y = net.get(b.id) ?? null;
    // No evidence for the ticked grades sinks, rather than sorting as zero:
    // "we have not looked" is not "not worth it".
    if (x === null && y === null) return (b.rawComp || 0) - (a.rawComp || 0);
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  });
}

/** Best first. Cards with no evidence sink to the bottom rather than sorting
 *  as zero, because "we have not looked" is not "not worth it". */
export function rankTriage(rows: TriageRow[]): TriageRow[] {
  return [...rows].sort((a, b) => {
    if (a.bestNet === null && b.bestNet === null) return (b.rawComp || 0) - (a.rawComp || 0);
    if (a.bestNet === null) return 1;
    if (b.bestNet === null) return -1;
    return b.bestNet - a.bestNet;
  });
}

// gt-v8. Picking the outcomes you think are plausible, instead of a floor.
//
// The floor dropdown asked one question: "is this worth sending if it comes
// back no better than a 9". That is the right question most of the time, and
// it has a shape built into it - a floor of 9 always means the set {10, 9},
// because "at least a 9" includes every grade above it.
//
// Gabe: "I only want to include the ones that make sense (if I want)." Which
// is a different and better question, because the floor cannot express it.
// Some of these cards have no 7 on record and never will. Some have a 10
// whose only sale the sanity rules threw out. And on a decent NM card the
// honest read is often "this 9s or it 10s", which is the set {10, 9} with 8
// and below deliberately NOT included - not because they are impossible, but
// because they are not the outcomes being bet on. A floor cannot say that: a
// floor of 9 and the set {10,9} agree, but there is no floor that means
// {10, 9} while excluding what a floor of 8 would drag in.
//
// So the set is the primitive and the floor becomes a preset over it. Every
// floor G is exactly the set G..10, which is why old links keep working and
// the Singles chip did not have to change.
//
// The rule inside is unchanged and is the part worth keeping: judge the card
// on the WORST of the outcomes you ticked. Ticking three grades and being
// shown the best of them would be picking the outcomes and then ignoring the
// pick.

/** The grades a floor means: that grade and everything above it. */
export function gradeSetFromFloor(floor: GradeKey): GradeKey[] {
  const i = ALL_GRADES.indexOf(floor);
  return i < 0 ? [...ALL_GRADES] : ALL_GRADES.slice(0, i + 1);
}

/** Read a grade set off a query string, high to low, duplicates dropped.
 *
 *  Returns null rather than a default when nothing usable is in there, so the
 *  caller decides what no answer means - an empty set and an absent one are
 *  different things and only the caller knows which it is looking at. */
export function parseGradeSet(raw: string | null | undefined): GradeKey[] | null {
  const want = new Set(
    String(raw ?? "")
      .split(/[^0-9]+/)
      .filter(Boolean),
  );
  const out = ALL_GRADES.filter((g) => want.has(g));
  return out.length ? out : null;
}

/** The outcome that decides the card: the ticked grade with the WORST net.
 *
 *  Grades with no surviving price are skipped rather than counted as zero.
 *  That is the same rule the floor used and it matters more here, because a
 *  person ticking 10, 9 and 8 on a card that only ever sold as a 10 should be
 *  told what the 10 makes, not be given nothing.
 *
 *  Null when not one ticked grade has a price. "We have no evidence for the
 *  outcomes you asked about" is not "this card makes nothing". */
export function worstOfSet(
  row: Pick<TriageRow, "byGrade">,
  grades: GradeKey[],
): { grade: GradeKey; price: number; net: number } | null {
  let out: { grade: GradeKey; price: number; net: number } | null = null;
  // Walked high to low so a tie lands on the LOWER grade, matching triage():
  // if the 9 and the 10 both net the same, the 9 is the honest answer because
  // it is the easier outcome.
  for (const g of grades.length ? grades : ALL_GRADES) {
    const cell = row.byGrade[g];
    if (!cell || cell.price === null || cell.net === null) continue;
    if (out === null || cell.net <= out.net) out = { grade: g, price: cell.price, net: cell.net };
  }
  return out;
}

/** What the card makes at the worst outcome you ticked. */
export function setNet(row: Pick<TriageRow, "byGrade">, grades: GradeKey[]): number | null {
  return worstOfSet(row, grades)?.net ?? null;
}

/** Whether a grade is worth offering as a tick box on this card: there is a
 *  sale on record for it and the sanity rules did not reject it. A grade that
 *  fails this is shown greyed rather than hidden, because "no 7 has ever sold"
 *  is information and a chip that silently vanishes is not. */
export function gradeIsUsable(row: Pick<TriageRow, "byGrade">, grade: GradeKey): boolean {
  return row.byGrade[grade]?.price !== null;
}

/** How many of the cards in hand have a usable price at each grade, so the
 *  chips can say what ticking one would actually get you. */
export function gradeCoverage(rows: Pick<TriageRow, "byGrade">[]): Record<GradeKey, number> {
  const out = {} as Record<GradeKey, number>;
  for (const g of ALL_GRADES) out[g] = 0;
  for (const r of rows) for (const g of ALL_GRADES) if (gradeIsUsable(r, g)) out[g]++;
  return out;
}

/** gt-v2. What to spend the next calls on.
 *
 *  My first cut gated this on raw comp - only look at cards over $50, because
 *  at $65 a card nothing cheap can clear the fee. Gabe killed it in one line:
 *  "there's also some cards that could be $5 but in a 10 are worth $500." He
 *  is right, and the gate would have hidden exactly the find worth having. A
 *  cheap card with a huge grade multiple is the whole reason to own this tool;
 *  a $200 card that 10s to $280 is the boring case.
 *
 *  The flaw was treating a metered API as if every call recurred. It does not.
 *  DISCOVERY is one call per card ever, and 1,469 of those is a finite bill
 *  paid once. REFRESH is the recurring cost, and that is the thing to be mean
 *  about - there is no reason to re-price a card whose 10 came back at $7.
 *
 *  So the sweep runs in three bands:
 *
 *    1. never looked at      - every card, cheapest included, dearest first
 *    2. looked, had upside   - refresh oldest first, this is the live list
 *    3. looked, hopeless     - revisit rarely, markets do move
 *
 *  Band 1 drains and never comes back. After that the recurring load is band
 *  2, which is however many cards actually have a case, and that number is
 *  small enough not to need a gate at all. */
export const COLD_RECHECK_DAYS = 120;

/** gt-v7. How long a card with a live case waits before being looked up again.
 *
 *  This constant is the whole quota budget and the first version of this file
 *  did not have it, which was a real bug rather than a tuning question. due()
 *  read "band is not cold, so it is due", and a card that had just been
 *  checked and HAD upside came back as due on the very next run. So the sweep
 *  worked correctly through the never-checked backlog, and then, the moment
 *  that backlog drained, settled into re-pricing the same several hundred
 *  good cards every fifteen minutes forever.
 *
 *  The arithmetic on that is not subtle. A quarter-hourly cron is 96 runs a
 *  day; at 120 cards a run that is 11,520 requests a day against a plan of
 *  25,000 a MONTH. The feature would have gone dark about two days after it
 *  started working, and the failure would have looked like the comps API being
 *  broken rather than like this.
 *
 *  A week is the right answer for the recurring pass. These are graded sales,
 *  usually one or two in a grade over months - the number does not move
 *  between Tuesday and Wednesday, and a card worth sending off on a 90 day
 *  turnaround is not a card whose decision turns on seven days of drift.
 *  Seven hundred live cards on a weekly cycle is a hundred lookups a day,
 *  which is twelve percent of the plan rather than forty-six times it. */
export const LIVE_RECHECK_DAYS = 7;

export type SweepCard = {
  comp: number | null;
  /** When this card was last looked up, YYYY-MM-DD or ISO. Blank = never. */
  checked?: string | null;
  /** Best net across grades from the LAST lookup. Null when never looked up. */
  bestNet?: number | null;
};

export type SweepBand = "new" | "live" | "cold";

/** Which band a card is in. Exported because the sweep reports its mix, and a
 *  run that is all band 1 means different things from one that is all band 3. */
export function sweepBand(card: SweepCard, nearMiss: number): SweepBand {
  if (!card.checked) return "new";
  const net = Number(card.bestNet);
  if (!Number.isFinite(net)) return "cold";
  // Near-miss stays live: a card $20 short of break-even is one market move
  // from being worth sending, and it is cheap to keep an eye on.
  return net >= -Math.abs(nearMiss) ? "live" : "cold";
}

export function sweepCandidates<T extends SweepCard>(
  cards: T[],
  limit: number,
  opts: { nearMiss?: number; now?: Date } = {},
): T[] {
  const nearMiss = opts.nearMiss ?? 25;
  const now = opts.now ?? new Date();
  const order: Record<SweepBand, number> = { new: 0, live: 1, cold: 2 };
  const due = (c: T) => {
    const band = sweepBand(c, nearMiss);
    // Never looked at: always due. This is the band that drains, and it is
    // the only one with no waiting period, because a card nobody has priced
    // is the one case where the answer is worth any amount of hurry.
    if (band === "new") return true;
    const wait = band === "live" ? LIVE_RECHECK_DAYS : COLD_RECHECK_DAYS;
    const age = saleAgeDays(String(c.checked || "").slice(0, 10), now);
    // An unparseable timestamp counts as due rather than as fresh: a card
    // whose last-checked date we cannot read is a card we do not know about.
    return age === null || age >= wait;
  };
  return cards
    .filter(due)
    .sort((a, b) => {
      const ab = order[sweepBand(a, nearMiss)];
      const bb = order[sweepBand(b, nearMiss)];
      if (ab !== bb) return ab - bb;
      // Inside a band: never-checked dearest first so the obvious money lands
      // on day one, then oldest-checked first so nothing starves.
      const ac = a.checked || "";
      const bc = b.checked || "";
      if (!ac && !bc) return Number(b.comp || 0) - Number(a.comp || 0);
      if (ac !== bc) return ac < bc ? -1 : 1;
      return Number(b.comp || 0) - Number(a.comp || 0);
    })
    .slice(0, Math.max(0, limit));
}

/** How many runs to drain the backlog, for telling somebody how long the
 *  first pass will take before they start it. */
export function sweepRunsNeeded(pending: number, perRun: number): number {
  if (perRun <= 0) return Infinity;
  return Math.ceil(Math.max(0, pending) / perRun);
}

// gt-v4. One lookup per CARD, not per copy.
//
// Gabe: "some cards I have 30 copies of. Some may be mint, others LP, but we
// could still apply the one comp run to all cards." Exactly right, and it is
// a correctness point before it is an efficiency one.
//
// What a PSA 10 of a card last sold for does not depend on the condition of
// YOUR raw copy. The graded price belongs to the card; only the net belongs to
// the copy, because the net subtracts that copy's own raw comp - and an LP
// copy, being cheaper, actually shows a BIGGER net than the NM one beside it.
// That is not a bug: it costs you less to give up.
//
// So the sweep groups by card identity, spends one call, and writes the same
// three prices to all 30 records with a net computed per record. Thirty copies
// cost one request instead of thirty.
//
// Condition is deliberately NOT in the key. Printing and language are: a 1st
// Edition and an Unlimited are different cards with different graded markets,
// and so are the English and Japanese printings.
export function cardGroupKey(c: {
  name?: string | null; setName?: string | null; number?: string | null;
  printing?: string | null; language?: string | null;
}): string {
  const norm = (v: unknown) =>
    String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // "7/102" and "007/102" and "7" are one card. Promo codes like "SM201" keep
  // their letters and are compared whole.
  const num = (() => {
    const head = String(c.number ?? "").split("/")[0].trim().toUpperCase();
    const n = parseInt(head, 10);
    return /^\d+$/.test(head) && Number.isFinite(n) ? String(n) : norm(head);
  })();
  return [norm(c.name), norm(c.setName), num, norm(c.printing), norm(c.language) || "english"].join("|");
}

/** Group records so each distinct card is looked up once. Order inside a
 *  group is preserved, so the caller can report "and 29 others". */
export function groupByCard<T extends Parameters<typeof cardGroupKey>[0]>(
  records: T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of records) {
    const k = cardGroupKey(r);
    const cur = out.get(k);
    if (cur) cur.push(r);
    else out.set(k, [r]);
  }
  return out;
}

// gt-v5. Which SETS are worth buying to grade.
//
// Gabe: "I'd like to track what sets have the highest upside... we could say
// wow we should buy destined rivals art rares, 98% of those cards have a 3.9x
// return." That is a buying decision rather than a grading one, and it is the
// more valuable of the two: the grading list tells you what to do with cards
// you already own, this tells you what to go and acquire.
//
// Grouped by set AND rarity, because the rarity is doing most of the work. A
// set's commons and its art rares are not one population and averaging them
// produces a number describing nothing.
//
// The honesty problem here is small samples. Three cards from one set, two of
// which clear, is "67%" and it is noise. So every row carries its n, rows
// under MIN_SAMPLE are marked thin rather than hidden - hiding them would
// make the page look more certain than it is - and the headline figure is a
// MEDIAN multiple, not a mean, because one $900 chase in a set of commons
// drags a mean somewhere no individual card lives.
export const MIN_SAMPLE = 5;

export type SetUpside = {
  key: string;
  setName: string;
  rarity: string;
  /** Cards with a graded sale on record at the chosen floor grade. */
  n: number;
  /** How many of those clear the fee at that floor. */
  clearing: number;
  /** clearing / n, 0 to 1. */
  share: number;
  /** Median of graded price divided by raw comp. The "3.9x". */
  medianMultiple: number | null;
  /** Total dollars on the table if every clearing card were sent. */
  upside: number;
  /** How many of the cards in this row rest on a single grade, with no other
   *  grade on record to sanity check the price against. */
  oneGrade: number;
  /** n is too small, OR most of the row's cards stand on one sale apiece.
   *  Either way the share is not a rate you should buy against. */
  thin: boolean;
};

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export function rollupSetUpside(rows: TriageRow[], grades: GradeKey[]): SetUpside[] {
  const by = new Map<string, TriageRow[]>();
  for (const r of rows) {
    // gt-v8. A card with no sale at ANY of the ticked grades is not evidence
    // either way and is left out of n entirely, rather than counted as a
    // failure. Judged on the same worst-of-the-set the ranked list uses, so
    // the two halves of the page cannot disagree about which cards clear.
    if (worstOfSet(r, grades) === null) continue;
    const key = `${r.setName}|${r.rarity}`;
    const cur = by.get(key);
    if (cur) cur.push(r);
    else by.set(key, [r]);
  }
  const out: SetUpside[] = [];
  for (const [key, group] of by) {
    const mults: number[] = [];
    let clearing = 0;
    let upside = 0;
    for (const r of group) {
      const worst = worstOfSet(r, grades);
      if (worst === null) continue;
      const raw = Number(r.rawComp);
      // The multiple is read off the BINDING grade, not the best one: the
      // return a set of outcomes gives you is the return of the worst of them.
      if (Number.isFinite(raw) && raw > 0) mults.push(worst.price / raw);
      if (worst.net > 0) {
        clearing++;
        upside += worst.net;
      }
    }
    const m = median(mults);
    const oneGrade = group.filter((r) => r.gradesWithPrice === 1).length;
    out.push({
      key,
      setName: group[0].setName,
      rarity: group[0].rarity,
      n: group.length,
      clearing,
      share: group.length ? clearing / group.length : 0,
      medianMultiple: m === null ? null : Math.round(m * 10) / 10,
      upside: Math.round(upside * 100) / 100,
      oneGrade,
      // gt-v8. A second way to be thin, found by reading the real output: XY
      // Base Set commons came back top of the buy list at a 1,578x median on
      // six cards and not marked thin, because six clears MIN_SAMPLE. Every
      // one of those six was a $3 raw card with a single PSA 10 sale and no
      // other grade beneath it to argue with. A row built mostly out of
      // one-sale cards is not a buying signal however many cards are in it,
      // and it belongs in the same bucket as a small n rather than above a
      // row with forty cards and a full curve each.
      thin: group.length < MIN_SAMPLE || oneGrade * 2 > group.length,
    });
  }
  // Best first, but a thin row never outranks a solid one: a 100% on three
  // cards is not a better buying signal than an 80% on forty.
  return out.sort((a, b) => {
    if (a.thin !== b.thin) return a.thin ? 1 : -1;
    if (b.share !== a.share) return b.share - a.share;
    return (b.medianMultiple || 0) - (a.medianMultiple || 0);
  });
}
