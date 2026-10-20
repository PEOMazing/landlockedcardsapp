import { AtRecord } from "./airtable";

// Shape an Airtable Singles record for the client. Buy price is admin-only,
// matching the sealed inventory.
export function toSingle(r: AtRecord, isAdmin: boolean) {
  const f = r.fields;
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
    gradeBestNet: typeof f["Grade Best Net"] === "number" ? f["Grade Best Net"] : null,
    gradeChecked: f["Graded Checked"] || "",
    // gt-v3. Last sale at EVERY PSA grade, 10 down to 1, out of the JSON the
    // sweep writes. The three columns on the record are only the ones worth
    // sorting on inside Airtable; the floor filter needs all ten.
    gradeSales: (() => {
      try {
        const d = f["Graded Detail"] ? JSON.parse(f["Graded Detail"]) : null;
        if (!d) return null;
        const out: Record<string, number> = {};
        for (const g of ["10","9","8","7","6","5","4","3","2","1"]) {
          const p = Number(d?.[g]?.price);
          if (Number.isFinite(p) && p > 0) out[g] = p;
        }
        return Object.keys(out).length ? out : null;
      } catch { return null; }
    })(),
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
