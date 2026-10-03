import { test } from "node:test";
import assert from "node:assert/strict";
import { committed, committedByProduct, splitFor, totalSplit, OpenLine } from "../stockSplit";

const line = (o: Partial<OpenLine> = {}): OpenLine => ({ productId: "p1", qty: 1, qtyHit: 0, returned: false, ...o });

test("an open line commits its unhit remainder", () => {
  assert.equal(committed([line({ qty: 5, qtyHit: 2 })]), 3);
});

test("a closed show commits nothing - its remainder is already back on the shelf", () => {
  // The double-count this prevents is the whole point: the return route has
  // already added these units to Qty On Hand.
  assert.equal(committed([line({ qty: 5, qtyHit: 2, returned: true })]), 0);
});

test("a fully hit line commits nothing", () => {
  assert.equal(committed([line({ qty: 3, qtyHit: 3 })]), 0);
});

test("hits beyond the line quantity never go negative", () => {
  assert.equal(committed([line({ qty: 2, qtyHit: 5 })]), 0);
});

test("store purchases are not committed stock", () => {
  // Bought off the shelf during the show, never on the wheel.
  assert.equal(committed([line({ qty: 4, isStore: true })]), 0);
});

test("committed sums across several open shows", () => {
  assert.equal(committed([line({ qty: 10, qtyHit: 4 }), line({ qty: 3 }), line({ qty: 2, returned: true })]), 9);
});

test("grouping keeps products apart and skips the blanks", () => {
  const m = committedByProduct([
    line({ productId: "a", qty: 5, qtyHit: 1 }),
    line({ productId: "a", qty: 2 }),
    line({ productId: "b", qty: 7, qtyHit: 7 }),
    line({ productId: "", qty: 9 }),
    line({ productId: "c", qty: 4, returned: true }),
  ]);
  assert.equal(m.get("a"), 6);
  assert.equal(m.get("b"), undefined);
  assert.equal(m.get("c"), undefined);
  assert.equal(m.has(""), false);
});

test("the split adds up, and total is what you own", () => {
  assert.deepEqual(splitFor(12, 5), { onHand: 12, onShows: 5, total: 17 });
});

test("a negative shelf count reads as zero rather than eating committed units", () => {
  assert.deepEqual(splitFor(-4, 3), { onHand: 0, onShows: 3, total: 3 });
});

test("junk on hand is zero, not NaN", () => {
  assert.deepEqual(splitFor(undefined, 0), { onHand: 0, onShows: 0, total: 0 });
  assert.deepEqual(splitFor("", 0), { onHand: 0, onShows: 0, total: 0 });
});

test("table totals combine the shelf and the shows", () => {
  const byProduct = new Map([["a", 3], ["b", 1]]);
  const t = totalSplit([{ id: "a", onHand: 10 }, { id: "b", onHand: 0 }, { id: "c", onHand: 2 }], byProduct);
  assert.deepEqual(t, { onHand: 12, onShows: 4, total: 16 });
});

test("a product with everything out on shows still shows what it owns", () => {
  // The case that reads as "we have none" today and causes a re-buy.
  assert.deepEqual(splitFor(0, 6), { onHand: 0, onShows: 6, total: 6 });
});
