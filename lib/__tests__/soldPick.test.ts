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
  // Both remaining signals are weak and they fail in opposite directions, so
  // the higher of the two wins. Each of these is a real card.
  it("uses the lowest listing when the last sale is stale and low", () => {
    // Milotic 70/147: one sale back in July, three live NM asks from $88.
    const p = pick([s("2026-07-17", 49)], f(88, 3));
    assert.equal(p.price, 88);
    assert.equal(p.usedFloor, true);
    assert.equal(p.staleSales, true);
  });

  it("uses the last sale when the cheapest listing is junk", () => {
    // Blissey (Prime): last NM sale $94.98, and a $70 "Near Mint" ask that is
    // really a CGC 7.5 slab filed against the raw card. The four genuine NM
    // asks sit at $94.98 to $100, so $70 is not a raw NM price at all.
    // Nothing in the feed marks it as graded - taking the higher of the two
    // neutralises it without needing to detect it.
    const p = pick([
      s("2026-08-16", 94.98), s("2026-08-02", 96.95), s("2026-07-15", 68.96),
      s("2026-07-13", 63.75), s("2026-07-10", 53.99),
    ], f(70, 5));
    assert.equal(p.price, 94.98);
    assert.equal(p.usedFloor, false);
    assert.equal(p.staleSales, true);
  });

  it("uses the last sale when there are no listings at all", () => {
    const p = pick([s("2026-08-16", 94.98), s("2026-07-10", 20)], null);
    assert.equal(p.price, 94.98);
  });

  it("ignores a lone optimistic listing and falls back to the last sale", () => {
    // Gengar (17): one ask at $604.90 is not a market, so it cannot answer.
    const p = pick([s("2026-07-01", 119.99), s("2026-06-20", 120)], f(604.9, 1));
    assert.equal(p.price, 119.99);
    assert.equal(p.usedFloor, false);
  });

  it("prefers the most recent stale sale over older ones", () => {
    // The newest sale is the best evidence left, even when an older one was
    // higher: the market moved on from that older price.
    const p = pick([s("2026-07-01", 100), s("2026-06-20", 200)], null);
    assert.equal(p.staleSales, true);
    assert.equal(p.price, 100);
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

// A rising card should not be held down by sales about to age out, but the
// lift only ever goes up: the median still answers when the newest sale is a
// low straggler. Asymmetric on purpose.
describe("the newest sale against the median", () => {
  // Arceus LV.X DP53, the card that prompted the rule. Two older sales hold
  // the median at $120 while the freshest sale says $169.99.
  const ARCEUS = [s("2026-09-13", 169.99), s("2026-08-29", 120), s("2026-08-19", 115)];

  it("lifts the comp to a fresh sale above the median", () => {
    const p = pick(ARCEUS);
    assert.equal(p.price, 169.99);
    assert.equal(p.usedLastSale, true);
    // the median is still reported, so the working stays checkable
    assert.equal(p.priceFromSales, 120);
    assert.equal(p.freshCount, 3);
  });

  // Machamp (Prime). Newest sale is the low straggler, median is the cluster.
  it("ignores a fresh sale below the median", () => {
    const MACHAMP = [s("2026-09-10", 74.99), s("2026-09-06", 115), s("2026-09-03", 60.88), s("2026-08-22", 118), s("2026-08-21", 118)];
    const p = pick(MACHAMP);
    assert.equal(p.price, 115);
    assert.ok(!p.usedLastSale);
  });

  it("will not lift off a sale that is no longer fresh", () => {
    // same shape as Arceus, but the high sale is 20 days old: that is the top
    // of a thin scatter, not a market that moved
    const stale = [s("2026-08-28", 169.99), s("2026-08-27", 120), s("2026-08-26", 115)];
    const p = pick(stale);
    assert.equal(p.price, 120);
    assert.ok(!p.usedLastSale);
  });

  it("caps a single sale at twice the median", () => {
    const pumped = [s("2026-09-15", 400), s("2026-09-10", 100), s("2026-09-05", 100)];
    const p = pick(pumped);
    assert.equal(p.price, 200);
    assert.equal(p.usedLastSale, true);
  });

  // A known limit, written down rather than left to be discovered. dropWashSales
  // decides which sales are fake by distance from the HIGHEST one, so it assumes
  // the high sale is the real one. Push a card far enough in one trade and the
  // honest sales are the ones discarded, and the median that the cap is measured
  // against is poisoned along with them. The cap cannot save a card from this,
  // because both numbers come from the same poisoned set.
  it("cannot cap a pump extreme enough to wash out the real sales", () => {
    const extreme = [s("2026-09-15", 900), s("2026-09-10", 100), s("2026-09-05", 100)];
    assert.deepEqual(dropWashSales(extreme).map((x) => x.price), [900]);
    assert.equal(pick(extreme).price, 900);
  });

  it("holds the line exactly at the freshness gate", () => {
    const at10 = [s("2026-09-07", 200), s("2026-09-06", 100), s("2026-09-05", 100)];
    const at11 = [s("2026-09-06", 200), s("2026-09-05", 100), s("2026-09-04", 100)];
    assert.equal(pick(at10).price, 200);
    assert.equal(pick(at11).price, 100);
  });

  it("leaves a card with nothing in the window to the old rule", () => {
    const old = [s("2026-07-10", 200)];
    const p = pick(old, f(88, 3));
    assert.equal(p.staleSales, true);
    assert.ok(!p.usedLastSale);
    assert.equal(p.price, 200);
  });
});
