import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickSoldPrice, outlierCompSource } from "../comp";

// "now" is fixed so the 30-day window is a known thing rather than whatever
// day the suite happens to run on.
const NOW = new Date("2026-09-25T00:00:00Z");
const d = (daysAgo: number) =>
  new Date(NOW.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);

describe("a lone recent sale that disagrees with the older ones", () => {
  // Espeon (Majestic Dawn), exactly as it was found: four sales agreeing with
  // each other outside the window, one $150 inside it.
  const espeon = [
    { date: d(2), price: 150 },
    { date: d(40), price: 25 },
    { date: d(45), price: 22.51 },
    { date: d(52), price: 19.95 },
    { date: d(60), price: 17.24 },
  ];

  it("sets the outlier aside and prices off the sales that agree", () => {
    const pick = pickSoldPrice(0, espeon, null, NOW);
    assert.equal(pick.demotedOutlier, true);
    assert.equal(pick.droppedPrice, 150);
    assert.equal(pick.peerMedian, 21.23); // (19.95 + 22.51) / 2
    assert.equal(pick.peerCount, 4);
    assert.equal(pick.price, 21.23);
  });

  it("does not let the rising-sale lift smuggle the same sale back in", () => {
    // The outlier is 2 days old, well inside LAST_SALE_FRESH_DAYS, so without
    // the guard running first this would come back as a "rising" $150.
    const pick = pickSoldPrice(0, espeon, null, NOW);
    assert.notEqual(pick.usedLastSale, true);
    assert.ok(pick.price < 30);
  });

  it("still lets a live asking floor hold the price up", () => {
    const pick = pickSoldPrice(0, espeon, { low: 40, count: 5 } as any, NOW);
    assert.equal(pick.demotedOutlier, true);
    assert.equal(pick.price, 40);
    // usedFloor stays false so the source line names the rejected sale
    assert.equal(pick.usedFloor, false);
  });

  it("names both numbers in the comp source", () => {
    const s = outlierCompSource("NM", 150, 21.23, 4);
    assert.match(s, /set aside as an outlier/);
    assert.match(s, /150/);
    assert.match(s, /21\.23/);
    assert.match(s, /4 earlier sales/);
  });
});

describe("what the guard deliberately leaves alone", () => {
  it("a thin card with no older sales to argue with keeps its one sale", () => {
    // Gabe's case: low volume, one sale, nothing to compare against. Firing
    // here would be guessing, so the sale stands and stays flagged as thin.
    const pick = pickSoldPrice(0, [{ date: d(3), price: 90 }], null, NOW);
    assert.notEqual(pick.demotedOutlier, true);
    assert.equal(pick.price, 90);
    assert.equal(pick.freshCount, 1);
  });

  it("two older sales are not enough of a quorum to overrule one", () => {
    const pick = pickSoldPrice(0, [
      { date: d(3), price: 90 },
      { date: d(40), price: 10 },
      { date: d(50), price: 12 },
    ], null, NOW);
    assert.notEqual(pick.demotedOutlier, true);
    assert.equal(pick.price, 90);
  });

  it("a card that genuinely sells well above its cheapest ask is untouched", () => {
    // Market/ask is nowhere in the test, which is the point: the comparison is
    // sale against sale. Three recent sales agreeing at $90 is a real opinion.
    const pick = pickSoldPrice(0, [
      { date: d(2), price: 92 },
      { date: d(6), price: 90 },
      { date: d(9), price: 88 },
      { date: d(40), price: 20 },
      { date: d(44), price: 22 },
      { date: d(48), price: 21 },
    ], { low: 25, count: 6 } as any, NOW);
    assert.notEqual(pick.demotedOutlier, true);
    // 92 rather than the 90 median: the newest sale is 2 days old and the
    // existing rising-sale rule lifts to it. That rule is untouched here.
    assert.equal(pick.price, 92);
    assert.equal(pick.usedLastSale, true);
  });

  it("leaves penny cards alone where the ratio is loud but the dollars are not", () => {
    // 4x the peers, but $1.60 against $0.40. Not worth a wrong answer.
    const pick = pickSoldPrice(0, [
      { date: d(3), price: 1.6 },
      { date: d(40), price: 0.4 },
      { date: d(44), price: 0.4 },
      { date: d(48), price: 0.45 },
    ], null, NOW);
    assert.notEqual(pick.demotedOutlier, true);
    assert.equal(pick.price, 1.6);
  });

  it("leaves a sale that is merely higher, not wild, alone", () => {
    // 2x the peer median is inside normal movement for a card on the way up.
    const pick = pickSoldPrice(0, [
      { date: d(3), price: 40 },
      { date: d(40), price: 20 },
      { date: d(44), price: 20 },
      { date: d(48), price: 21 },
    ], null, NOW);
    assert.notEqual(pick.demotedOutlier, true);
  });
});

describe("the other cards found with the same shape", () => {
  const cases: [string, { date: string; price: number }[], number][] = [
    ["Ponyta", [
      { date: d(1), price: 38.08 }, { date: d(35), price: 0.79 },
      { date: d(40), price: 0.59 }, { date: d(44), price: 0.58 }, { date: d(50), price: 0.57 },
    ], 0.59],
    ["Wurmple", [
      { date: d(1), price: 30.85 }, { date: d(35), price: 0.99 },
      { date: d(40), price: 0.96 }, { date: d(44), price: 0.81 }, { date: d(50), price: 0.64 },
    ], 0.89],
    ["Psyduck", [
      { date: d(1), price: 135.3 }, { date: d(35), price: 14.99 },
      { date: d(40), price: 13.8 }, { date: d(44), price: 13.72 }, { date: d(50), price: 11 },
    ], 13.76],
  ];

  for (const [name, detail, want] of cases) {
    it(`${name} prices off its cluster, not its outlier`, () => {
      const pick = pickSoldPrice(0, detail, null, NOW);
      assert.equal(pick.demotedOutlier, true, `${name} should have been caught`);
      assert.equal(pick.price, want);
    });
  }
});
