import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { trimSnapItems, topMovers, type SnapItem, type Snapshot } from "../priceRefresh";

// The daily Price History row carries a map of every priced item so the next
// day's refresh can work out what moved. It lives in one Airtable long text
// cell, which holds 100,000 characters, and the real collection outgrew that:
// 760 singles plus 338 sealed products, each with a name and an image URL.
//
// The failure was quiet in the worst way. Prices were written first and the
// snapshot last, so the shelf repriced correctly and then the write threw a
// 422, the route turned it into a 502, and the portfolio chart silently
// stopped recording. The button had been returning an error for weeks.

const shelf = (n: number, price = (i: number) => i + 1): Record<string, SnapItem> => {
  const out: Record<string, SnapItem> = {};
  for (let i = 0; i < n; i++) {
    out[`s:rec${String(i).padStart(14, "0")}`] = {
      n: `A card with a reasonably long name ${i}`,
      p: price(i),
      img: `https://tcgplayer-cdn.tcgplayer.com/product/${500000 + i}_200w.jpg`,
    };
  }
  return out;
};

describe("fitting the snapshot item map in one cell", () => {
  it("leaves a map that already fits completely alone", () => {
    const items = shelf(50);
    assert.equal(trimSnapItems(items), items, "should be the same object, not a copy");
  });

  it("gets a real-sized collection under the cell limit", () => {
    const items = shelf(1100);
    assert.ok(JSON.stringify(items).length > 100000, "the fixture should be too big to start with");
    const out = trimSnapItems(items);
    assert.ok(JSON.stringify(out).length <= 90000, `still ${JSON.stringify(out).length} characters`);
    assert.ok(Object.keys(out).length > 300, `only kept ${Object.keys(out).length} items`);
  });

  it("keeps the dear end and drops the cheap tail", () => {
    const out = trimSnapItems(shelf(1100));
    const kept = Object.values(out).map((v) => v.p);
    assert.ok(Math.min(...kept) > 100, `kept something worth ${Math.min(...kept)}`);
    assert.ok(kept.includes(1100), "the dearest item has to survive");
  });

  it("keeps the same items across two days, which is the only way movers work", () => {
    // Trimming at random would mean yesterday and today held different items
    // and nothing could be compared. Value ordering is stable, so the
    // expensive stock is in both snapshots even as prices drift.
    const prev: Snapshot = { date: "2026-10-03", total: 0, sealed: 0, singles: 0, items: trimSnapItems(shelf(1100)) };
    const latest: Snapshot = {
      date: "2026-10-04", total: 0, sealed: 0, singles: 0,
      items: trimSnapItems(shelf(1100, (i) => (i === 1099 ? i + 80 : i + 1))),
    };
    const shared = Object.keys(latest.items).filter((k) => k in prev.items);
    assert.ok(shared.length > 300, `only ${shared.length} items in common`);
    const movers = topMovers(prev, latest, 3);
    assert.equal(movers.length, 1);
    assert.equal(movers[0].delta, 79);
  });

  it("survives a budget too small for even one item", () => {
    const out = trimSnapItems(shelf(10), 5);
    assert.deepEqual(out, {});
  });

  it("survives an empty map", () => {
    assert.deepEqual(trimSnapItems({}), {});
  });
});
