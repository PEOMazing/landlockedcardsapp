import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { pickSoldPrice } from "../comp";

const f = (low: number, count = 3) => ({ low, count });

describe("pickSoldPrice", () => {
  it("keeps the median when the newest sale is in line with it", () => {
    // Gabe's actual Charizard: sales 182.51 / 245 / 260, median 245.
    // The newest sale is only 6% over, which is noise, not a move.
    const p = pickSoldPrice(245, [
      { date: "2026-09-02", price: 260 },
      { date: "2026-07-20", price: 182.51 },
      { date: "2026-07-03", price: 245 },
    ], f(250));
    assert.equal(p.price, 245);
    assert.equal(p.usedLastSale, false);
  });

  it("takes the newest sale when the median is lagging badly", () => {
    // The case the rule exists for: median says $105 on a card that just
    // changed hands for $400.
    const p = pickSoldPrice(105, [
      { date: "2026-09-10", price: 400 },
      { date: "2026-08-01", price: 105 },
      { date: "2026-07-01", price: 100 },
    ], null);
    assert.equal(p.price, 400);
    assert.equal(p.usedLastSale, true);
    assert.equal(p.cappedByFloor, false);
  });

  it("caps a spike at what the card can actually be bought for", () => {
    // One $400 sale, but live listings start at $150. Nobody has to pay $400
    // while a $150 copy is sitting there, so the comp is $150.
    const p = pickSoldPrice(105, [
      { date: "2026-09-10", price: 400 },
      { date: "2026-08-01", price: 105 },
    ], f(150));
    assert.equal(p.price, 150);
    assert.equal(p.usedLastSale, true);
    assert.equal(p.cappedByFloor, true);
  });

  it("does not cap when the floor agrees the card moved", () => {
    const p = pickSoldPrice(105, [{ date: "2026-09-10", price: 400 }], f(390));
    assert.equal(p.price, 390);
    assert.equal(p.cappedByFloor, true);
  });

  it("picks the newest sale by date, not by feed order", () => {
    const p = pickSoldPrice(100, [
      { date: "2026-06-01", price: 100 },
      { date: "2026-09-10", price: 300 },
      { date: "2026-07-01", price: 95 },
    ], null);
    assert.equal(p.price, 300);
    assert.equal(p.latestDate, "2026-09-10");
  });

  it("ignores a newest sale BELOW the median - the median already handles a dip", () => {
    const p = pickSoldPrice(200, [
      { date: "2026-09-10", price: 50 },
      { date: "2026-08-01", price: 200 },
    ], null);
    assert.equal(p.price, 200);
    assert.equal(p.usedLastSale, false);
  });

  it("sits on the right side of the threshold", () => {
    const under = pickSoldPrice(100, [{ date: "2026-09-10", price: 124 }], null);
    const over = pickSoldPrice(100, [{ date: "2026-09-10", price: 125 }], null);
    assert.equal(under.usedLastSale, false);
    assert.equal(over.usedLastSale, true);
  });

  it("falls back to the median on missing or junk input", () => {
    assert.equal(pickSoldPrice(50, [], null).price, 50);
    assert.equal(pickSoldPrice(50, null as any, null).price, 50);
    assert.equal(pickSoldPrice(50, [{ date: "2026-09-10", price: 0 }], null).price, 50);
    assert.equal(pickSoldPrice(0, [{ date: "2026-09-10", price: 400 }], null).price, 0);
  });

  it("does not let a zero or negative floor zero out a card", () => {
    const p = pickSoldPrice(100, [{ date: "2026-09-10", price: 400 }], f(0));
    assert.equal(p.price, 400);
  });
});
