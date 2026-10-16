import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSlabGrade,
  slabComp,
  slabCompSource,
  slabParams,
  slabSaleMatches,
  slabSales,
  SLAB_MAX_SALES,
  SLAB_WINDOW_DAYS,
  type SaleRow,
} from "../slabComp";
import { SLAB_CONDITIONS } from "../slab";

// sl-v1. The slab comp rule is "newest five inside 30 days, drop the low
// outliers, take the median". These tests pin each clause of that separately,
// because the clauses fail in different directions: the window going wrong
// prices a card off a market that has moved, and the outlier rule going wrong
// hands a tanked sale the whole comp.

const NOW = new Date("2026-10-16T12:00:00Z");
const sale = (date: string, price: number): SaleRow =>
  ({ date, price, title: "t", url: "u", format: "Auction", bestOffer: false });

describe("reading the grader and grade off a Condition", () => {
  it("parses the graders that actually appear in the column", () => {
    assert.deepEqual(parseSlabGrade("PSA 10"), { grader: "PSA", grade: "10" });
    assert.deepEqual(parseSlabGrade("PSA 9"), { grader: "PSA", grade: "9" });
    assert.deepEqual(parseSlabGrade("CGC 9.5"), { grader: "CGC", grade: "9.5" });
    assert.deepEqual(parseSlabGrade("BGS 9.5"), { grader: "BGS", grade: "9.5" });
  });

  it("refuses the ones that name no grade", () => {
    // "Other" and "Other Graded" say a card is in a case and nothing else.
    // A comp needs a grade, and guessing one puts PSA 10 money on a PSA 4.
    assert.equal(parseSlabGrade("Other"), null);
    assert.equal(parseSlabGrade("Other Graded"), null);
  });

  it("does not find a grader hiding inside another word", () => {
    assert.equal(parseSlabGrade("Other Graded"), null);
    assert.equal(parseSlabGrade("PSA"), null);
    assert.equal(parseSlabGrade("10"), null);
  });

  it("is not fooled by raw conditions", () => {
    for (const c of ["NM", "LP", "MP", "HP", "DM", "Raw"]) {
      assert.equal(parseSlabGrade(c), null, `${c} is not a slab`);
    }
  });

  it("every slab condition either parses or is an explicit Other", () => {
    // Guards against someone adding "PSA 7" to lib/slab.ts and this silently
    // never pricing it.
    for (const c of SLAB_CONDITIONS) {
      const g = parseSlabGrade(c);
      assert.ok(g !== null || c.startsWith("Other"), `${c} parses to nothing and is not an Other`);
    }
  });

  it("tolerates whitespace and case", () => {
    assert.deepEqual(parseSlabGrade("  psa 10 "), { grader: "PSA", grade: "10" });
  });
});

describe("the request for one slab", () => {
  const card = { name: "Charizard", setName: "Base Set", number: "4/102" };

  it("asks for one grade, not all of them", () => {
    const p = slabParams(card, { grader: "PSA", grade: "10" });
    assert.equal(p.grader, "PSA");
    assert.equal(p.grade, "10");
    assert.equal(p.graded, "true");
  });

  it("asks wider than the comp window so a stale sale can still be disclosed", () => {
    // Requesting only 30 days would make "nothing sold this month" and
    // "nothing has ever sold" look the same.
    const p = slabParams(card, { grader: "PSA", grade: "10" });
    assert.ok(Number(p.days) > SLAB_WINDOW_DAYS * 2, `days was ${p.days}`);
  });

  it("narrows to 1st Edition only when the card is one", () => {
    const first = slabParams({ ...card, variant: "1st Edition Holofoil" }, { grader: "PSA", grade: "10" });
    assert.equal(first.first_edition, "true");
    const unl = slabParams({ ...card, variant: "Unlimited Holofoil" }, { grader: "PSA", grade: "10" });
    assert.equal(unl.first_edition, undefined);
  });
});

describe("whether a sold listing is really this slab", () => {
  const card = { name: "Charizard", setName: "Base Set", number: "4/102" };
  const g = { grader: "PSA", grade: "10" };
  const item = (over: any = {}) => ({
    price: 100, last_sold: "2026-10-10",
    card: { graded: true, grader: "PSA", grade: "10", card_number: "4/102", ...over },
  });

  it("takes an exact grade match", () => {
    assert.equal(slabSaleMatches(item(), card, g), true);
  });

  it("rejects a neighbouring grade", () => {
    // A PSA 9 is routinely a fifth of a PSA 10. A near miss here is worse
    // than no answer at all.
    assert.equal(slabSaleMatches(item({ grade: "9" }), card, g), false);
  });

  it("treats 10 and 10.0 as the same grade", () => {
    assert.equal(slabSaleMatches(item({ grade: "10.0" }), card, g), true);
  });

  it("rejects a different grader at the same number", () => {
    assert.equal(slabSaleMatches(item({ grader: "CGC" }), card, g), false);
  });

  it("rejects a different collector number", () => {
    assert.equal(slabSaleMatches(item({ card_number: "11/102" }), card, g), false);
  });

  it("keeps a listing whose title carried no number", () => {
    // Most honest listings do not put the number in the title. Dropping those
    // would empty the panel.
    assert.equal(slabSaleMatches(item({ card_number: null }), card, g), true);
  });

  it("will not price an Unlimited slab off a 1st Edition sale", () => {
    const unl = { ...card, variant: "Unlimited Holofoil" };
    assert.equal(slabSaleMatches(item({ first_edition: true }), unl, g), false);
    assert.equal(slabSaleMatches(item({ first_edition: false }), unl, g), true);
  });

  it("makes a 1st Edition slab prove it", () => {
    const first = { ...card, variant: "1st Edition Holofoil" };
    assert.equal(slabSaleMatches(item({ first_edition: true }), first, g), true);
    assert.equal(slabSaleMatches(item({}), first, g), false);
  });

  it("rejects a sale with no price or no date", () => {
    assert.equal(slabSaleMatches({ ...item(), price: 0 }, card, g), false);
    assert.equal(slabSaleMatches({ ...item(), last_sold: null }, card, g), false);
  });
});

describe("sorting and selecting the sales", () => {
  const card = { name: "Charizard", setName: "Base Set" };
  const g = { grader: "PSA", grade: "10" };

  it("returns newest first whatever order the feed used", () => {
    const items = [
      { price: 1, last_sold: "2026-09-01", card: { graded: true, grader: "PSA", grade: "10" } },
      { price: 2, last_sold: "2026-10-14", card: { graded: true, grader: "PSA", grade: "10" } },
      { price: 3, last_sold: "2026-10-02", card: { graded: true, grader: "PSA", grade: "10" } },
    ];
    assert.deepEqual(slabSales(items, card, g).map((s) => s.date),
      ["2026-10-14", "2026-10-02", "2026-09-01"]);
  });

  it("returns nothing rather than throwing on junk", () => {
    assert.deepEqual(slabSales(null as any, card, g), []);
    assert.deepEqual(slabSales([{}, { card: null }] as any, card, g), []);
  });
});

describe("the comp itself", () => {
  it("is the median of the sales in the window", () => {
    const r = slabComp([
      sale("2026-10-14", 100), sale("2026-10-10", 110), sale("2026-10-04", 120),
    ], NOW)!;
    assert.equal(r.price, 110);
    assert.equal(r.used.length, 3);
    assert.equal(r.stale, false);
  });

  it("takes only the newest five", () => {
    const sales = Array.from({ length: 9 }, (_, i) =>
      sale(`2026-10-${String(15 - i).padStart(2, "0")}`, 100 + i * 10));
    const r = slabComp(sales, NOW)!;
    assert.equal(r.used.length, SLAB_MAX_SALES);
    // newest five are 100,110,120,130,140 -> median 120, not the median of all nine
    assert.equal(r.price, 120);
  });

  it("throws out a low outlier and says so", () => {
    // The attack this exists for: list a slab far under value, buy it
    // instantly, drag the published average down.
    const r = slabComp([
      sale("2026-10-14", 500), sale("2026-10-12", 520), sale("2026-10-10", 480),
      sale("2026-10-08", 25),
    ], NOW)!;
    assert.equal(r.dropped.length, 1);
    assert.equal(r.dropped[0].price, 25);
    assert.equal(r.price, 500);
    assert.match(slabCompSource({ grader: "PSA", grade: "10" }, r), /1 low sale set aside/);
  });

  it("leaves a merely cheap sale alone", () => {
    // Low is not the same as fake. A sale at 70% of the high is the market
    // being wide, and throwing it out would be inventing a price.
    const r = slabComp([
      sale("2026-10-14", 100), sale("2026-10-12", 90), sale("2026-10-10", 70),
    ], NOW)!;
    assert.equal(r.dropped.length, 0);
    assert.equal(r.price, 90);
  });

  it("does not cut the high end", () => {
    // Asked for explicitly: low only. Pinned so nobody "fixes" it into a
    // symmetric rule without the decision being made again on purpose.
    const r = slabComp([
      sale("2026-10-14", 100), sale("2026-10-12", 110), sale("2026-10-10", 900),
    ], NOW)!;
    assert.equal(r.dropped.length, 0);
    assert.equal(r.price, 110);
  });

  it("a high outlier cannot delete the real sales", () => {
    // The bug this rule was rewritten for. Measuring the low threshold against
    // the window HIGH - which is what salesWindow's dropWashSales does - makes
    // $100 and $110 both fall under a fifth of $900, so the two real sales get
    // thrown out and the single absurd one becomes the comp. A rule written to
    // stop one bad sale deciding a price would have handed it the price.
    const r = slabComp([
      sale("2026-10-14", 100), sale("2026-10-12", 110), sale("2026-10-10", 900),
    ], NOW)!;
    assert.equal(r.used.length, 3, "every real sale must survive a high outlier");
    assert.ok(r.price < 200, `comp was ${r.price}, the outlier took over`);
  });

  it("still cuts the low when a high outlier is also present", () => {
    // Both failure modes in one window: a tanked $20 sale and a silly $900
    // one. The $20 goes, the $900 stays and gets diluted by the median.
    const r = slabComp([
      sale("2026-10-14", 500), sale("2026-10-13", 520), sale("2026-10-12", 480),
      sale("2026-10-11", 20), sale("2026-10-10", 900),
    ], NOW)!;
    assert.deepEqual(r.dropped.map((s) => s.price), [20]);
    // 480, 500, 520 and 900 survive, so the median is (500+520)/2 = 510. The
    // $900 is in the set and barely moves it, which is the point.
    assert.equal(r.price, 510);
  });

  it("will not call either of two sales an outlier", () => {
    // With two data points there is no way to tell which one is odd, so
    // neither is cut and the thin-data count does the talking instead.
    const r = slabComp([sale("2026-10-14", 1), sale("2026-10-13", 1000)], NOW)!;
    assert.equal(r.dropped.length, 0);
    assert.equal(r.used.length, 2);
  });

  it("ignores sales outside the window", () => {
    const r = slabComp([
      sale("2026-10-14", 100), sale("2026-10-12", 120),
      sale("2026-01-02", 4000),
    ], NOW)!;
    assert.equal(r.used.length, 2);
    assert.equal(r.price, 110);
    assert.equal(r.stale, false);
  });

  it("falls back to one older sale when the window is empty, and labels it", () => {
    const r = slabComp([sale("2026-08-02", 250), sale("2026-05-01", 400)], NOW)!;
    assert.equal(r.stale, true);
    assert.equal(r.price, 250);       // the newest one, not the best one
    assert.equal(r.asOf, "2026-08-02");
    assert.match(slabCompSource({ grader: "PSA", grade: "10" }, r), /last sale 2026-08-02, none in 30d/);
  });

  it("returns null when there are no sales at all", () => {
    // A real answer, and it means leave the hand-entered comp alone.
    assert.equal(slabComp([], NOW), null);
    assert.equal(slabComp([sale("2026-10-10", 0)], NOW), null);
  });

  it("rounds up to the dollar like every other comp", () => {
    const r = slabComp([sale("2026-10-14", 94.24)], NOW)!;
    assert.equal(r.price, 95);
  });

  it("never throws every sale away", () => {
    // dropWashSales guarantees this and the comp depends on it: an empty kept
    // list would median to NaN and write a blank comp over a real one.
    const r = slabComp([sale("2026-10-14", 1), sale("2026-10-13", 1000)], NOW)!;
    assert.ok(r.used.length > 0);
    assert.ok(Number.isFinite(r.price));
  });

  it("reports the sale count so the thin-data warning can fire", () => {
    const thin = slabComp([sale("2026-10-14", 300)], NOW)!;
    assert.equal(thin.used.length, 1);
  });
});

describe("the comp source string", () => {
  const g = { grader: "CGC", grade: "9.5" };

  it("carries the solds marker so pricingHealth classifies it", () => {
    const r = slabComp([sale("2026-10-14", 100), sale("2026-10-12", 120)], NOW)!;
    assert.match(slabCompSource(g, r), /\bsolds\b/);
  });

  it("names the venue, because these are not TCGplayer sales", () => {
    const r = slabComp([sale("2026-10-14", 100)], NOW)!;
    assert.match(slabCompSource(g, r), /^eBay solds/);
    assert.match(slabCompSource(g, r), /CGC 9\.5/);
  });

  it("does not carry the est. marker", () => {
    // est. means "market times a guess at the condition". A slab comp is real
    // sales of the real grade and must not be flagged amber alongside them.
    const r = slabComp([sale("2026-10-14", 100)], NOW)!;
    assert.doesNotMatch(slabCompSource(g, r), /est\./);
  });

  it("pluralises the set-aside count", () => {
    const r = slabComp([
      sale("2026-10-14", 500), sale("2026-10-13", 520), sale("2026-10-12", 480),
      sale("2026-10-11", 20), sale("2026-10-10", 25),
    ], NOW)!;
    assert.equal(r.dropped.length, 2);
    assert.match(slabCompSource(g, r), /2 low sales set aside/);
  });
});
