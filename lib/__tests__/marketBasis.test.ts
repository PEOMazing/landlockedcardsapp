import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  OVERRIDE_GAP_FRACTION, OVERRIDE_MIN_GAP, OVERRIDE_MIN_SALES,
  marketCompSource, pickMarketComp, salesOverMarketSource,
} from "../comp";

const NOW = new Date("2026-10-23T12:00:00Z");
const day = (back: number) =>
  new Date(NOW.getTime() - back * 86400000).toISOString().slice(0, 10);
const sales = (...xs: number[]) => ({ price: 0, detail: xs.map((p, i) => ({ date: day(i + 1), price: p })) });

// cb-v1. Market first, sales as a check on it.
describe("market sets the price by default", () => {
  it("uses TCGplayer market for an NM card", () => {
    const r = pickMarketComp(40, "NM", null, NOW)!;
    assert.equal(r.basis, "market");
    assert.equal(r.price, 40);
    assert.equal(r.mult, 1);
  });

  it("applies the condition multiplier to a played copy", () => {
    // Market is an NM-basis figure, so this half is an estimate and the comp
    // source says so. Stated rather than hidden.
    assert.equal(pickMarketComp(40, "LP", null, NOW)!.price, 36);
    assert.equal(pickMarketComp(40, "MP", null, NOW)!.price, 32);
    assert.equal(pickMarketComp(40, "DM", null, NOW)!.price, 20);
  });

  it("ignores a lone sale however wild it is", () => {
    // The whole point. Under the old rule a single fresh sale above the
    // median became the comp; here nothing under OVERRIDE_MIN_SALES can
    // outvote market at all.
    const r = pickMarketComp(40, "NM", sales(150), NOW)!;
    assert.equal(r.basis, "market");
    assert.equal(r.price, 40);
    assert.equal(r.freshCount, 1);
  });

  it("ignores two sales that disagree, which is still not a market", () => {
    assert.equal(pickMarketComp(40, "NM", sales(150, 160), NOW)!.basis, "market");
  });

  it("returns null with no market to work from, so the caller can fall back", () => {
    assert.equal(pickMarketComp(0, "NM", sales(10, 10, 10), NOW), null);
    assert.equal(pickMarketComp(NaN, "NM", null, NOW), null);
  });

  it("returns null on a graded card, which has no multiplier", () => {
    assert.equal(pickMarketComp(40, "PSA 10", null, NOW), null);
  });
});

describe("sales outvote market only when they agree with each other", () => {
  it("takes the sales when enough of them sit well above market", () => {
    // Market stale on a card that has genuinely run. Three sales agreeing at
    // $90 against a $40 market is three votes, not one print.
    const r = pickMarketComp(40, "NM", sales(88, 90, 92), NOW)!;
    assert.equal(r.basis, "sales");
    assert.equal(r.price, 90);
    assert.equal(r.conditioned, 40);
  });

  it("marks a card DOWN just as readily", () => {
    // The old lift could only ever raise a price. This is symmetric, which is
    // the half that was missing: a binder-wide one-way ratchet is what made
    // every streamer's profit over market look smaller than it was.
    const r = pickMarketComp(40, "NM", sales(18, 20, 22), NOW)!;
    assert.equal(r.basis, "sales");
    assert.equal(r.price, 20);
  });

  it("uses their median, so one wild sale among them cannot carry it", () => {
    const r = pickMarketComp(40, "NM", sales(88, 90, 900), NOW)!;
    assert.equal(r.basis, "sales");
    assert.equal(r.price, 90);
  });

  it("leaves market alone when the sales are close to it", () => {
    // Ordinary noise between two measures of the same thing. Market is the
    // steadier, so it keeps the card.
    const r = pickMarketComp(40, "NM", sales(38, 42, 44), NOW)!;
    assert.equal(r.basis, "market");
    assert.equal(r.price, 40);
    assert.equal(r.soldMedian, 42);
  });

  it("needs the gap in dollars as well as in percent", () => {
    // A 40 cent common whose sales median is 55 cents is a 37% gap and
    // nothing worth having an opinion about.
    const r = pickMarketComp(0.4, "NM", sales(0.5, 0.55, 0.6), NOW)!;
    assert.equal(r.basis, "market");
    assert.ok(OVERRIDE_MIN_GAP > 0);
  });

  it("needs the gap in percent as well as in dollars", () => {
    // $100 market against a $103 sales median clears the $2 floor and is
    // plainly the same price.
    assert.equal(pickMarketComp(100, "NM", sales(102, 103, 104), NOW)!.basis, "market");
  });

  it("counts only sales inside the window", () => {
    const stale = { price: 0, detail: [90, 90, 90].map((p, i) => ({ date: day(40 + i), price: p })) };
    const r = pickMarketComp(40, "NM", stale, NOW)!;
    assert.equal(r.basis, "market");
    assert.equal(r.freshCount, 0);
  });

  it("fires on a played card too, where it beats the multiplier estimate", () => {
    // A played copy with real sales behind it should be priced off them
    // rather than off market times a flat guess.
    const r = pickMarketComp(40, "MP", sales(10, 11, 12), NOW)!;
    assert.equal(r.basis, "sales");
    assert.equal(r.price, 11);
    assert.equal(r.conditioned, 32);
  });

  it("holds the bar at exactly the thresholds", () => {
    assert.equal(OVERRIDE_MIN_SALES, 3);
    assert.equal(OVERRIDE_GAP_FRACTION, 0.25);
    // 100 market, sales median 125 is exactly the fraction and does fire
    assert.equal(pickMarketComp(100, "NM", sales(125, 125, 125), NOW)!.basis, "sales");
    // 124 is just under and does not
    assert.equal(pickMarketComp(100, "NM", sales(124, 124, 124), NOW)!.basis, "market");
  });
});

describe("what a market comp says about itself", () => {
  it("does not claim to be an estimate on an NM card", () => {
    // EST_MARKER drives the amber unverified-comp warning on the singles
    // table, so an NM market comp must not carry it: TCGplayer's market price
    // is their own figure, not a multiplier applied to someone else's.
    const s = marketCompSource("Holofoil", "NM", 1);
    assert.ok(!s.includes("est."), s);
    assert.ok(s.includes("Holofoil"), s);
  });

  it("does claim to be one on a played card", () => {
    const s = marketCompSource("Holofoil", "MP", 0.8);
    assert.ok(s.includes("est."), s);
    assert.ok(s.includes("80%"), s);
  });

  it("names both numbers when the sales win", () => {
    const s = salesOverMarketSource("NM", 4, 40, "Holofoil");
    assert.ok(s.includes("solds"), s);
    assert.ok(s.includes("median of 4"), s);
    assert.ok(s.includes("$40.00"), s);
  });
});
