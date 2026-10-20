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

export type GradeQuote = { price: number | null; date: string | null };
export type TriageCard = {
  id: string;
  name: string;
  setName?: string;
  rarity?: string;
  rawComp: number | null;
  grades: Partial<Record<GradeKey, GradeQuote>>;
  checked?: string | null;
};

export type TriageRow = {
  id: string;
  name: string;
  setName: string;
  rarity: string;
  rawComp: number | null;
  cost: number;
  breakEven: number | null;
  neededMultiple: number | null;
  /** Per grade: the price, the net after fee, how old the sale is. */
  byGrade: Record<GradeKey, { price: number | null; net: number | null; ageDays: number | null; stale: boolean }>;
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

  for (const g of ALL_GRADES) {
    const q = card.grades[g] || { price: null, date: null };
    const price = Number.isFinite(Number(q.price)) && Number(q.price) > 0 ? Number(q.price) : null;
    const net = netGain(card.rawComp, price, cost);
    const ageDays = saleAgeDays(q.date, now);
    const isStale = isStaleSale(q.date, now);
    byGrade[g] = { price, net, ageDays, stale: isStale };
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
    rawComp: card.rawComp ?? null,
    cost,
    floorNet,
    breakEven: breakEven(card.rawComp, cost),
    neededMultiple: neededMultiple(card.rawComp, cost),
    byGrade,
    bestNet,
    bestGrade,
    overInsured: overInsured(byGrade["10"].price, opts.maxInsured),
    allStale: seen > 0 && stale === seen,
  };
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
    if (band !== "cold") return true;
    const age = saleAgeDays(String(c.checked || "").slice(0, 10), now);
    return age === null || age >= COLD_RECHECK_DAYS;
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
  /** n is too small to read the share as a rate. */
  thin: boolean;
};

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export function rollupSetUpside(rows: TriageRow[], floor: GradeKey): SetUpside[] {
  const by = new Map<string, TriageRow[]>();
  for (const r of rows) {
    // A card with no sale at this grade is not evidence either way and is
    // left out of n entirely, rather than counted as a failure.
    if (r.byGrade[floor]?.price == null) continue;
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
      const price = r.byGrade[floor].price as number;
      const raw = Number(r.rawComp);
      if (Number.isFinite(raw) && raw > 0) mults.push(price / raw);
      const fn = r.floorNet[floor];
      if (fn !== null && fn > 0) {
        clearing++;
        upside += fn;
      }
    }
    const m = median(mults);
    out.push({
      key,
      setName: group[0].setName,
      rarity: group[0].rarity,
      n: group.length,
      clearing,
      share: group.length ? clearing / group.length : 0,
      medianMultiple: m === null ? null : Math.round(m * 10) / 10,
      upside: Math.round(upside * 100) / 100,
      thin: group.length < MIN_SAMPLE,
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
