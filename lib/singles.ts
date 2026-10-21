import { AtRecord } from "./airtable";
import { ALL_GRADES, SHIP_PER_CARD, gradingCost, netGain, suspectQuotes, type GradeKey, type SaleQuote } from "./gradeTriage";

// gt-v7. The graded prices on a record, with the ones that are not believed
// taken out, and the best net recomputed from what is left.
//
// Deliberately NOT read straight off the Grade Best Net column. That column is
// what the sweep wrote at the time it ran, from every price it found including
// the ones suspectQuotes now rejects, so on a card whose PSA 10 "sale" was a
// hundred-thousand-dollar asking price the column says the card nets ninety-
// nine thousand. Recomputing here means the filter tells the truth about every
// card already swept without waiting for a fresh pass over all of them - and
// the column stays as it is, since it is the sweep's own record of what it saw.
function gradedRead(f: Record<string, any>) {
  let d: any = null;
  try { d = f["Graded Detail"] ? JSON.parse(f["Graded Detail"]) : null; } catch { d = null; }
  if (!d) return { sales: null as Record<string, number> | null, bestNet: null as number | null, suspectCount: 0 };

  const quotes: Partial<Record<GradeKey, SaleQuote>> = {};
  for (const g of ALL_GRADES) {
    const p = Number(d?.[g]?.price);
    if (Number.isFinite(p) && p > 0) {
      quotes[g] = { price: p, date: d[g]?.date ?? null, title: d[g]?.title ?? null };
    }
  }
  const suspect = suspectQuotes(quotes);

  // The cost the sweep used, when it recorded one. Falling back to the
  // default rather than to zero: a missing cost must not make grading look
  // free, which is the one direction this number must never be wrong in.
  const cost = Number(d?.cost) > 0 ? Number(d.cost) : gradingCost(59.99, SHIP_PER_CARD);
  const raw = typeof f["Comp"] === "number" ? f["Comp"] : null;

  const sales: Record<string, number> = {};
  let bestNet: number | null = null;
  for (const g of ALL_GRADES) {
    if (suspect[g]) continue;
    const p = Number(quotes[g]?.price);
    if (!Number.isFinite(p) || p <= 0) continue;
    sales[g] = p;
    const net = netGain(raw, p, cost);
    // Greater-or-equal walking high to low, so a tie names the lower grade -
    // the same rule as triage(), which the two must agree on.
    if (net !== null && (bestNet === null || net >= bestNet)) bestNet = net;
  }
  return {
    sales: Object.keys(sales).length ? sales : null,
    bestNet,
    suspectCount: Object.keys(suspect).length,
  };
}

// Shape an Airtable Singles record for the client. Buy price is admin-only,
// matching the sealed inventory.
export function toSingle(r: AtRecord, isAdmin: boolean) {
  const f = r.fields;
  // Once per record, not once per field that wants it: this parses JSON and
  // the singles list calls toSingle twelve hundred times a request.
  const graded = gradedRead(f);
  return {
    id: r.id,
    // permanent sticker number, assigned by Airtable and never reused
    cardNo: f["Card No"] ?? null,
    // the price bucket that was on the label last time it printed; compared
    // against the live bucket to spot cards sitting in the wrong box
    printedBucket: f["Printed Bucket"] || "",
    // when a sticker was last sent to the printer, for anything, priced or not.
    // Blank is the whole point: it means this card has never been stickered.
    labelPrinted: f["Label Printed"] || "",
    name: f["Card Name"] || "",
    setName: f["Set Name"] || "",
    number: f["Card Number"] || "",
    cardId: f["Card ID"] || "",
    // the binder pocket. Unlike Card No this one is recycled: it empties when
    // the card sells and the next card added moves into it.
    slot: f["Slot"] ?? null,
    location: f["Location"] || "",
    language: f["Language"] || "English",
    rarity: f["Rarity"] || "",
    variant: f["Variant"] || "",
    condition: f["Condition"] || "Raw",
    comp: f["Comp"] ?? null,
    // Lowest live TCGplayer listing for this card's exact printing AND
    // condition - the number you get on their site after picking a condition.
    // marketBasis spells out what it covers, and says "any condition" on the
    // rare card with no live listings, where it falls back to the mirror.
    market: f["Market"] ?? null,
    marketBasis: f["Market Basis"] || "",
    compSource: f["Comp Source"] || "",
    compDate: f["Comp Date"] || "",
    // how many real sales the comp rests on. null means this card has not been
    // repriced since the count started being recorded - unknown, not thin.
    compSales: typeof f["Comp Sales"] === "number" ? f["Comp Sales"] : null,
    // gt-v1. Best dollars grading this card would make across PSA 8, 9 and 10,
    // after giving up the raw card and paying the fee. Written by the graded
    // sweep. null means nobody has looked yet, which is NOT zero - the
    // Recommend to grade filter has to tell those two apart or it would claim
    // every uncheck ed card is a dud.
    gradeBestNet: graded.bestNet,
    gradeChecked: f["Graded Checked"] || "",
    // gt-v7. How many of this card's graded prices were not believed. Shown
    // beside the recommendation so a card resting on a rejected sale cannot
    // look like a card resting on a clean one.
    gradeSuspect: graded.suspectCount,
    // gt-v3. Last sale at EVERY PSA grade, 10 down to 1, out of the JSON the
    // sweep writes. The three columns on the record are only the ones worth
    // sorting on inside Airtable; the floor filter needs all ten.
    gradeSales: graded.sales,
    compDetail: (() => {
      try { return f["Comp Detail"] ? JSON.parse(f["Comp Detail"]) : null; } catch { return null; }
    })(),
    // most recent sale the comp was built from - the sales feed returns
    // newest first, so this is the freshest real transaction we have
    lastSale: (() => {
      try {
        const d = f["Comp Detail"] ? JSON.parse(f["Comp Detail"]) : null;
        return Array.isArray(d) && d.length ? { date: d[0].date, price: d[0].price } : null;
      } catch { return null; }
    })(),
    tcgProductId: (() => {
      const m = String(f["Card ID"] || "").match(/^tcg:(\d+):/);
      return m ? parseInt(m[1]) : null;
    })(),
    image: f["Image URL"] || "",
    qty: f["Qty"] ?? 1,
    status: f["Status"] || "In Stock",
    streamRecId: f["Stream Rec Id"] || "",
    salePrice: f["Sale Price"] ?? null,
    soldDate: f["Sold Date"] || "",
    entryComp: f["Entry Comp"] ?? null,
    printing: f["Printing"] || "",
    notes: f["Notes"] || "",
    altLink: f["ALT Link"] || "",
    addedBy: f["Added By"] || "",
    dateAdded: f["Date Added"] || "",
    ...(isAdmin ? { buy: f["Buy Price"] ?? 0 } : {}),
  };
}
