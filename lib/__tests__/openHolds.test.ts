import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { committedByProduct, committedHoldsByProduct, OpenLine } from "../stockSplit";

// Breaking the on-shows number down by show.
//
// The number already existed and was trusted. The risk in opening it up is not
// that the list is wrong in some new way, it is that the list and the number
// stop agreeing: the row says 9 are out, the panel shows 7, and now neither can
// be believed. So the number is computed from the breakdown rather than beside
// it, and most of what follows is holding that property down.

const line = (o: Partial<OpenLine> = {}): OpenLine =>
  ({ productId: "p1", qty: 1, qtyHit: 0, returned: false, streamId: "s1", ...o });

const holdsFor = (lines: OpenLine[], pid = "p1") =>
  Object.fromEntries(committedHoldsByProduct(lines).get(pid) ?? new Map());

test("one product on two shows is split by show", () => {
  const holds = holdsFor([
    line({ qty: 6, streamId: "s1" }),
    line({ qty: 3, streamId: "s2" }),
  ]);
  assert.deepEqual(holds, { s1: 6, s2: 3 });
});

test("two lines of the same product on the same show add up", () => {
  // Sealed gets added to a set in batches, so a wheel can carry the same
  // product on more than one line. The panel should say "9 on Friday", not
  // list Friday twice.
  const holds = holdsFor([
    line({ qty: 6, streamId: "s1" }),
    line({ qty: 3, streamId: "s1" }),
  ]);
  assert.deepEqual(holds, { s1: 9 });
});

test("only the unhit remainder is held, per show", () => {
  const holds = holdsFor([
    line({ qty: 6, qtyHit: 4, streamId: "s1" }),
    line({ qty: 3, qtyHit: 3, streamId: "s2" }),
  ]);
  // s2 is fully hit, so it is gone rather than held, and it should not appear
  // as a show with zero on it.
  assert.deepEqual(holds, { s1: 2 });
});

test("a closed show holds nothing", () => {
  assert.deepEqual(holdsFor([line({ qty: 5, returned: true })]), {});
});

test("store purchases are not held by a show", () => {
  assert.deepEqual(holdsFor([line({ qty: 5, isStore: true })]), {});
});

test("a line with no stream id is still counted, under the empty key", () => {
  // These units are demonstrably off the shelf. Dropping them because their
  // provenance is incomplete would make the panel add up to less than the
  // number that opened it, which is the one failure that makes the whole
  // feature untrustworthy.
  assert.deepEqual(holdsFor([line({ qty: 4, streamId: undefined })]), { "": 4 });
});

test("products are kept apart", () => {
  const all = committedHoldsByProduct([
    line({ productId: "p1", qty: 2, streamId: "s1" }),
    line({ productId: "p2", qty: 7, streamId: "s1" }),
  ]);
  assert.deepEqual(Object.fromEntries(all.get("p1")!), { s1: 2 });
  assert.deepEqual(Object.fromEntries(all.get("p2")!), { s1: 7 });
});

test("the breakdown always sums to the number shown on the row", () => {
  // The invariant the feature rests on. Run over a spread of awkward lines
  // rather than one tidy case, because the cases that break this are the
  // partial hits and the mixed sources, not the simple ones.
  const lines: OpenLine[] = [
    line({ productId: "p1", qty: 6, qtyHit: 1, streamId: "s1" }),
    line({ productId: "p1", qty: 6, qtyHit: 6, streamId: "s1" }),
    line({ productId: "p1", qty: 4, streamId: "s2" }),
    line({ productId: "p1", qty: 9, returned: true, streamId: "s3" }),
    line({ productId: "p1", qty: 2, isStore: true, streamId: "s4" }),
    line({ productId: "p1", qty: 3, streamId: undefined }),
    line({ productId: "p2", qty: 5, qtyHit: 2, streamId: "s1" }),
    line({ productId: "p2", qty: 1, qtyHit: 4, streamId: "s2" }),
  ];
  const totals = committedByProduct(lines);
  const holds = committedHoldsByProduct(lines);
  for (const [pid, total] of totals) {
    let summed = 0;
    for (const qty of holds.get(pid)!.values()) summed += qty;
    assert.equal(summed, total, `product ${pid}: panel would show ${summed}, row shows ${total}`);
  }
  // and the values themselves, so a bug that made both sides equally wrong
  // would still be caught
  assert.equal(totals.get("p1"), 5 + 4 + 3);
  assert.equal(totals.get("p2"), 3);
});

test("a product with nothing out does not appear at all", () => {
  // Rather than appearing with an empty list, which the API would then ship as
  // dead weight on every one of 1,200 rows.
  const holds = committedHoldsByProduct([line({ productId: "p1", qty: 3, qtyHit: 3 })]);
  assert.equal(holds.has("p1"), false);
  assert.equal(holds.size, 0);
});

test("empty and junk input do not throw", () => {
  assert.equal(committedHoldsByProduct([]).size, 0);
  assert.equal(committedHoldsByProduct(null as any).size, 0);
  assert.equal(committedHoldsByProduct([line({ productId: "" })]).size, 0);
});

// The invariant above holds inside stockSplit, and it still shipped broken.
//
// The tile said 491 and the panel listed 478. Nothing in stockSplit was wrong:
// the number was summed over `searched` (every product matching the search box)
// while the panel was handed `filtered`, which also applies the stock tab. The
// default tab is In stock, so a product whose entire quantity is out on a show
// has nothing on hand, drops out of `filtered`, and is counted but not listed.
//
// A pure-function test cannot see that, because the defect is which collection
// the component passed, not what the function did with it. So this reads the
// component. It is a source assertion and it is narrow on purpose: it checks
// that the number and the list name the same binding, which is the only thing
// that has to stay true.
test("the on-shows tile and its panel read the same collection", () => {
  const src = readFileSync("app/admin/inventory/InventoryClient.tsx", "utf8");

  const totals = /const stockTotals = useMemo\(\(\) => \{[\s\S]*?for \(const i of (\w+)\)/.exec(src);
  assert.ok(totals, "could not find the stockTotals loop; update this test with the code");

  const panel = /title: "Out on shows", products: (\w+)\.filter/.exec(src);
  assert.ok(panel, "could not find the on-shows panel call; update this test with the code");

  assert.equal(
    panel[1],
    totals[1],
    `The tile counts "${totals[1]}" but the panel lists "${panel[1]}". ` +
      "Whichever is right, they have to be the same collection, or the number " +
      "and the breakdown behind it will disagree on screen.",
  );
});

test("a product fully out on a show is not filtered out of its own breakdown", () => {
  // The shape of the row that exposed it: nothing on hand, everything on a show.
  const holds = committedHoldsByProduct([line({ qty: 13, qtyHit: 0, streamId: "s1" })]);
  assert.deepEqual(Object.fromEntries(holds.get("p1")!), { s1: 13 });
  assert.equal(committedByProduct([line({ qty: 13, streamId: "s1" })]).get("p1"), 13);
});
