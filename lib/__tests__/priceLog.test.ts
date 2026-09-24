import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MoverCard, PricePoint, logFields, rankMovers, valueAsOf, worthLogging } from "../priceLog";

const pt = (date: string, comp: number, prevComp = 0): PricePoint => ({ date, comp, prevComp });

describe("worthLogging", () => {
  it("logs a move that is both big enough in percent and in dollars", () => {
    assert.equal(worthLogging(100, 110), true);
    assert.equal(worthLogging(100, 90), true);
    assert.equal(worthLogging(20, 21), true);
  });

  it("ignores penny drift on a bulk card", () => {
    // 5% but only four cents
    assert.equal(worthLogging(0.8, 0.84), false);
    assert.equal(worthLogging(2, 2.2), false);
  });

  it("ignores a rounding wobble on an expensive card", () => {
    // $10 is real money but it is under 1% of a $1,400 card
    assert.equal(worthLogging(1416, 1426), false);
    assert.equal(worthLogging(1416, 1500), true);
  });

  it("logs nothing when there is no before or after to compare", () => {
    assert.equal(worthLogging(null, 40), false);
    assert.equal(worthLogging(40, null), false);
    assert.equal(worthLogging(0, 40), false);
    assert.equal(worthLogging(40, 0), false);
    assert.equal(worthLogging(undefined, undefined), false);
  });
});

describe("valueAsOf", () => {
  const entry = { date: "2026-01-01", comp: 50 };

  it("takes the newest point on or before the cutoff", () => {
    const pts = [pt("2026-03-01", 70), pt("2026-02-01", 60), pt("2026-04-01", 90)];
    assert.equal(valueAsOf(pts, entry, "2026-03-15"), 70);
    assert.equal(valueAsOf(pts, entry, "2026-03-01"), 70);
  });

  it("uses what the first later move came from when nothing is logged yet", () => {
    // the only row is after the cutoff, but it remembers the price it left
    const pts = [pt("2026-04-01", 90, 62)];
    assert.equal(valueAsOf(pts, entry, "2026-03-15"), 62);
  });

  it("falls back to the comp the card was added at", () => {
    assert.equal(valueAsOf([], entry, "2026-03-15"), 50);
    // a logged row with no remembered previous price is no help either
    assert.equal(valueAsOf([pt("2026-04-01", 90, 0)], entry, "2026-03-15"), 50);
  });

  it("refuses to price a card that did not exist yet", () => {
    assert.equal(valueAsOf([], { date: "2026-09-20", comp: 12 }, "2026-08-20"), null);
  });

  it("gives up rather than guess when there is nothing at all", () => {
    assert.equal(valueAsOf([], null, "2026-03-15"), null);
  });

  // The since-added window asks a different question: not "where was this a
  // month ago" but "where did it start". A cutoff of today lets every card
  // through the existence guard and lands on its entry comp, where a cutoff at
  // the beginning of time would say every card is too new to have a number.
  it("answers since-added when the cutoff is today", () => {
    assert.equal(valueAsOf([], { date: "2026-09-20", comp: 12 }, "2026-09-24"), 12);
    assert.equal(valueAsOf([], { date: "2026-09-24", comp: 12 }, "2026-09-24"), 12);
  });
});

describe("rankMovers", () => {
  const card = (over: Partial<MoverCard> & { id: string }): MoverCard => ({
    cardNo: 1,
    name: "Card",
    setName: "Set",
    condition: "NM",
    image: "",
    slot: null,
    comp: 100,
    entryComp: 50,
    dateAdded: "2026-01-01",
    ...over,
  });

  it("ranks by percent, biggest gain first", () => {
    const cards = [
      card({ id: "a", comp: 60, entryComp: 50 }), // +20%
      card({ id: "b", comp: 200, entryComp: 50 }), // +300%
      card({ id: "c", comp: 25, entryComp: 50 }), // -50%
    ];
    const out = rankMovers(cards, new Map(), "2026-06-01");
    assert.deepEqual(out.map((m) => m.id), ["b", "a", "c"]);
    assert.equal(out[0].pct, 300);
    assert.equal(out[2].delta, -25);
  });

  it("prefers a logged point over the entry comp", () => {
    const pts = new Map([["a", [pt("2026-05-01", 80)]]]);
    const out = rankMovers([card({ id: "a", comp: 100, entryComp: 50 })], pts, "2026-06-01");
    assert.equal(out[0].from, 80);
    assert.equal(out[0].delta, 20);
  });

  it("drops cards that have not moved", () => {
    const out = rankMovers([card({ id: "a", comp: 50, entryComp: 50 })], new Map(), "2026-06-01");
    assert.equal(out.length, 0);
  });

  it("drops a card too new to have a number for this window", () => {
    const out = rankMovers(
      [card({ id: "a", comp: 100, entryComp: 50, dateAdded: "2026-09-20" })],
      new Map(),
      "2026-08-20",
    );
    assert.equal(out.length, 0);
  });

  it("drops a card with no comp rather than ranking it at zero", () => {
    const out = rankMovers([card({ id: "a", comp: 0 })], new Map(), "2026-06-01");
    assert.equal(out.length, 0);
  });
});

describe("logFields", () => {
  const rec = { id: "rec1", fields: { "Card No": 142, "Card Name": "Umbreon ex" } };

  it("writes a readable key and keeps the day's opening price", () => {
    const f = logFields({ rec, before: 60, comp: 67, market: 63.5 }, "2026-09-24", 60);
    assert.equal(f["Entry"], "0142 2026-09-24");
    assert.equal(f["Card Rec Id"], "rec1");
    assert.equal(f["Card Name"], "Umbreon ex");
    assert.equal(f["Comp"], 67);
    assert.equal(f["Market"], 63.5);
    assert.equal(f["Prev Comp"], 60);
  });

  it("leaves market empty rather than writing a zero price", () => {
    const f = logFields({ rec, before: 60, comp: 67, market: null }, "2026-09-24", 60);
    assert.equal(f["Market"], null);
  });
});
