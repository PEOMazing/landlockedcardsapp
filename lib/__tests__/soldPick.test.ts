import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { dropWashSales, pickSoldPrice } from "../comp";

const f = (low: number, count = 3) => ({ low, count });
// Fixtures are self-consistent on purpose: the median passed in is only used
// when there are no usable sales, so a fixture whose median disagrees with its
// own sale list tests nothing real.
const s = (date: string, price: number) => ({ date, price });

describe("pickSoldPrice: what the sales say", () => {
  it("uses the median of the recent sales", () => {
    const p = pickSoldPrice(245, [s("2026-09-02", 260), s("2026-07-20", 182.51), s("2026-07-03", 245)], null);
    assert.equal(p.price, 245);
    assert.equal(p.usedLastSale, false);
  });

  it("takes the newest sale when the median is lagging badly", () => {
    // The median says $105 on a card that just changed hands for $400.
    const p = pickSoldPrice(105, [s("2026-09-10", 400), s("2026-08-01", 105), s("2026-07-01", 100)], null);
    assert.equal(p.price, 400);
    assert.equal(p.usedLastSale, true);
  });

  it("picks the newest sale by date, not by feed order", () => {
    const p = pickSoldPrice(100, [s("2026-06-01", 100), s("2026-09-10", 300), s("2026-07-01", 95)], null);
    assert.equal(p.price, 300);
    assert.equal(p.latestDate, "2026-09-10");
  });

  it("sits on the right side of the jump threshold", () => {
    const under = pickSoldPrice(100, [s("2026-01-01", 100), s("2026-02-01", 100), s("2026-09-10", 124)], null);
    const over = pickSoldPrice(100, [s("2026-01-01", 100), s("2026-02-01", 100), s("2026-09-10", 125)], null);
    assert.equal(under.usedLastSale, false);
    assert.equal(over.usedLastSale, true);
  });

  it("does not chase a newest sale that is BELOW the rest", () => {
    // A dip is what a median is for; only jumps upward override it.
    const p = pickSoldPrice(0, [s("2026-09-10", 50), s("2026-08-01", 200)], null);
    assert.equal(p.usedLastSale, false);
    assert.equal(p.price, 125);
  });

  it("falls back to the passed median when there is nothing usable", () => {
    assert.equal(pickSoldPrice(50, [], null).price, 50);
    assert.equal(pickSoldPrice(50, null as any, null).price, 50);
    assert.equal(pickSoldPrice(50, [s("2026-09-10", 0)], null).price, 50);
  });
});

describe("pickSoldPrice: what the live listings say", () => {
  it("uses the floor when nobody is selling as cheap as the sales claim", () => {
    // Milotic 70/147: one two-month-old $49 sale, three live NM asks from $88.
    const p = pickSoldPrice(49, [s("2026-07-17", 49)], f(88, 3));
    assert.equal(p.price, 88);
    assert.equal(p.usedFloor, true);
    assert.equal(p.priceFromSales, 49);
  });

  it("uses the floor even when the sales are only slightly under it", () => {
    // Charizard G Lv.X: median $245, cheapest live LP ask $250. The rule is
    // "higher of the two", so the $5 counts the same as the $39 would.
    const p = pickSoldPrice(245, [s("2026-09-02", 260), s("2026-07-20", 182.51), s("2026-07-03", 245)], f(250, 3));
    assert.equal(p.price, 250);
    assert.equal(p.usedFloor, true);
  });

  it("leaves the sales alone when they already clear the floor", () => {
    const p = pickSoldPrice(245, [s("2026-09-02", 260), s("2026-07-20", 240), s("2026-07-03", 245)], f(200, 4));
    assert.equal(p.price, 245);
    assert.equal(p.usedFloor, false);
  });

  it("ignores a lone optimistic listing", () => {
    // Gengar (17): real sales around $120 against ONE ask of $604.90.
    const p = pickSoldPrice(119.99, [s("2026-09-10", 119.99), s("2026-09-05", 120), s("2026-09-01", 119)], f(604.9, 1));
    assert.equal(p.price, 119.99);
    assert.equal(p.usedFloor, false);
  });

  it("caps a spiking last sale at what the card can be bought for", () => {
    const p = pickSoldPrice(105, [s("2026-09-10", 400), s("2026-08-01", 105)], f(150, 5));
    assert.equal(p.price, 150);
    assert.equal(p.cappedByFloor, true);
  });

  it("does not let a zero or one-listing floor touch the price", () => {
    assert.equal(pickSoldPrice(100, [s("2026-09-10", 100), s("2026-08-01", 100)], f(0, 9)).price, 100);
    assert.equal(pickSoldPrice(100, [s("2026-09-10", 100), s("2026-08-01", 100)], f(900, 1)).price, 100);
  });
});

// Sold data can be pushed down deliberately: list far under value, have it
// bought instantly, and the recorded sale drags the published average down -
// then buy up copies from everyone pricing off that average.
describe("manipulated sold data", () => {
  it("throws out a wash trade before taking the median", () => {
    const p = pickSoldPrice(0, [s("2026-09-10", 1), s("2026-09-08", 200), s("2026-09-01", 210)], null);
    assert.equal(p.price, 205);
  });

  it("survives a wash trade that would otherwise BE the median", () => {
    // Two sales, one fake: a plain median gives $100.50 on a $200 card.
    const p = pickSoldPrice(100.5, [s("2026-09-10", 1), s("2026-09-08", 200)], null);
    assert.equal(p.price, 200);
  });

  it("does not mistake an ordinary cheap sale for a wash trade", () => {
    // 30% under the high is normal spread, not manipulation.
    const p = pickSoldPrice(0, [s("2026-09-10", 70), s("2026-09-08", 100)], null);
    assert.equal(p.price, 85);
  });

  it("falls back to the live floor when every sale has been pushed down", () => {
    // A $1 listing gets bought instantly and stops being a listing, so the
    // standing asks are the only number left that cannot be faked this way.
    const p = pickSoldPrice(1, [s("2026-09-10", 1), s("2026-09-09", 1), s("2026-09-08", 1)], f(180, 6));
    assert.equal(p.price, 180);
    assert.equal(p.usedFloor, true);
  });

  it("never discards the whole sale set", () => {
    const kept = dropWashSales([{ price: 1 }, { price: 1 }]);
    assert.equal(kept.length, 2);
  });
});
