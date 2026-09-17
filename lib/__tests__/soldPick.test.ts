import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { dropWashSales, pickSoldPrice } from "../comp";

// Pinned so these never rot: every date below is relative to this.
const NOW = new Date("2026-09-17T00:00:00Z");
const f = (low: number, count = 3) => ({ low, count });
const s = (date: string, price: number) => ({ date, price });
const pick = (detail: { date: string; price: number }[], floor: any = null, median = 0) =>
  pickSoldPrice(median, detail, floor, NOW);

// The rule: real sales inside 30 days, no outliers, average them. No sale in
// 30 days, and the lowest listing is the better answer.
describe("a card that has sold recently", () => {
  it("takes the middle sale, not the average, when the sales split", () => {
    // Machamp (Prime): $60.88, $74.99, $115, $118, $118. Three tight at the
    // top, two stragglers. The mean is $97.37 - a price at which none of the
    // five actually sold. The median sits in the cluster.
    const p = pick([
      s("2026-09-10", 74.99), s("2026-09-06", 115), s("2026-09-03", 60.88),
      s("2026-08-22", 118), s("2026-08-21", 118),
    ], f(448.59, 4));
    assert.equal(p.price, 115);
    assert.equal(p.freshCount, 5);
    assert.equal(p.freshRange, "$60.88-$118.00");
    assert.equal(p.usedFloor, false);
  });

  it("gives the same answer as an average when the sales agree", () => {
    const p = pick([s("2026-09-10", 114), s("2026-09-06", 115), s("2026-09-03", 116)], null);
    assert.equal(p.price, 115);
  });

  it("does not let four people's asking price outrank five real sales", () => {
    // The asks are what four sellers want. The sales are what the card is
    // worth, and those listings are still listed because nobody paid it.
    const p = pick([s("2026-09-10", 115), s("2026-09-06", 115), s("2026-09-04", 115)], f(448.59, 4));
    assert.equal(p.price, 115);
    assert.equal(p.usedFloor, false);
  });

  it("only counts sales inside the window", () => {
    // Charizard G Lv.X: $260 on Sep 2 is in, July is long gone.
    const p = pick([s("2026-09-02", 260), s("2026-07-20", 182.51), s("2026-07-03", 245)], f(250, 3));
    assert.equal(p.price, 260);
    assert.equal(p.freshCount, 1);
  });

  it("treats the window edge consistently", () => {
    const inside = pick([s("2026-08-18", 50), s("2026-09-01", 100)], null);
    const outside = pick([s("2026-08-17", 50), s("2026-09-01", 100)], null);
    assert.equal(inside.freshCount, 2);
    assert.equal(inside.price, 75); // two sales: the median is their midpoint
    assert.equal(outside.freshCount, 1);
    assert.equal(outside.price, 100);
  });
});

describe("a card that has not sold in 30 days", () => {
  it("uses the lowest listing", () => {
    // Milotic 70/147: one sale back in July, three live NM asks from $88.
    const p = pick([s("2026-07-17", 49)], f(88, 3));
    assert.equal(p.price, 88);
    assert.equal(p.usedFloor, true);
    assert.equal(p.staleSales, true);
  });

  it("ignores a lone optimistic listing and keeps the stale sales", () => {
    // Gengar (17): one ask at $604.90 is not a market.
    const p = pick([s("2026-07-01", 119.99), s("2026-06-20", 120)], f(604.9, 1));
    assert.equal(p.price, 120); // rounded to cents
    assert.equal(p.usedFloor, false);
  });

  it("falls back to the older sales when there are no listings either", () => {
    const p = pick([s("2026-07-01", 100), s("2026-06-20", 200)], null);
    assert.equal(p.staleSales, true);
    assert.equal(p.price, 150);
  });
});

// Sold data can be pushed down deliberately: list far under value, have it
// bought instantly, and the recorded sale drags the average down.
describe("outliers and manipulation", () => {
  it("throws out a wash trade before averaging", () => {
    const p = pick([s("2026-09-10", 1), s("2026-09-08", 200), s("2026-09-01", 210)], null);
    assert.equal(p.price, 205); // the $1 is dropped, leaving 200 and 210
  });

  it("survives a wash trade that would otherwise halve the average", () => {
    const p = pick([s("2026-09-10", 1), s("2026-09-08", 200)], null);
    assert.equal(p.price, 200);
  });

  it("does not mistake an ordinary cheap sale for a wash trade", () => {
    const p = pick([s("2026-09-10", 70), s("2026-09-08", 100)], null);
    assert.equal(p.price, 85);
  });

  it("is not dragged into the gap by a split set", () => {
    // Two clusters and nothing between them: the answer has to be one of the
    // clusters, not the empty middle.
    const p = pick([
      s("2026-09-10", 60), s("2026-09-09", 62),
      s("2026-09-08", 200), s("2026-09-07", 205), s("2026-09-06", 210),
    ], null);
    assert.equal(p.price, 200);
  });

  it("uses the listings when every recent sale has been pushed down", () => {
    // Recent and plentiful, but under 1% of what six sellers are asking.
    const p = pick([s("2026-09-10", 1), s("2026-09-09", 1), s("2026-09-08", 1)], f(180, 6));
    assert.equal(p.price, 180);
    assert.equal(p.usedFloor, true);
    assert.equal(p.staleSales, false);
  });

  it("leaves a wide but plausible gap on the sales side", () => {
    // Machamp sits at 26% of its asking floor; the implausibility line is 15%.
    const p = pick([s("2026-09-10", 115), s("2026-09-06", 115)], f(448.59, 4));
    assert.equal(p.price, 115);
    assert.equal(p.usedFloor, false);
  });

  it("never discards the whole sale set", () => {
    assert.equal(dropWashSales([{ price: 1 }, { price: 1 }]).length, 2);
  });

  it("handles missing and junk input", () => {
    assert.equal(pickSoldPrice(50, [], null, NOW).price, 50);
    assert.equal(pickSoldPrice(50, null as any, null, NOW).price, 50);
    assert.equal(pickSoldPrice(50, [s("2026-09-10", 0)], null, NOW).price, 50);
  });
});
