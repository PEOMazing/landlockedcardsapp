import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { clampStock, takeStock } from "../stock";

// Stock conservation.
//
// Every bug in this file is the same sentence: a unit was counted onto the
// shelf that is not on the shelf, or taken off one that never left. They are
// not arithmetic mistakes, they are bookkeeping mistakes, and they share two
// shapes.
//
// SHAPE ONE: a loop computes a new total from a value it read before the loop
// started, so the second write overwrites the first instead of building on it.
// This was in four places: the bulk paste route, the Collectr import, the
// portfolio import, and the rollover claim.
//
// SHAPE TWO: a restore credits the line's whole quantity when part of it was
// hit on stream and physically mailed to a buyer. This was in the purge and in
// the pre-return line delete.
//
// The arithmetic below is the contract. The source assertions underneath check
// that the call sites still obey it, because the arithmetic was never wrong:
// the call sites were.

describe("a running total, not a stale one", () => {
  it("two rows of the same product add up", () => {
    // Collectr exports do this routinely: one row under a product's current
    // name, one under a name it was renamed away from, both resolving to the
    // same record through the alias index.
    let onHand = 10;
    for (const add of [3, 2]) onHand = onHand + add;
    assert.equal(onHand, 15, "15 units arrived, so the shelf holds 15");
  });

  it("a weighted buy price folds in each lot once", () => {
    // Stale-base: lot two recomputed from the original 10 @ $22 and produced a
    // number that reflected neither lot. Running: each lot folds into the
    // average that already contains the one before it.
    const fold = (qty: number, buy: number, addQty: number, addBuy: number) =>
      Math.round(((qty * buy + addQty * addBuy) / (qty + addQty)) * 100) / 100;

    let qty = 10, buy = 22;
    buy = fold(qty, buy, 3, 20); qty += 3;
    buy = fold(qty, buy, 2, 25); qty += 2;

    assert.equal(qty, 15);
    // 10@22 + 3@20 + 2@25 = 220 + 60 + 50 = 330 over 15 units
    assert.equal(buy, 22);
    assert.equal(Math.round((330 / 15) * 100) / 100, 22);
  });

  it("claiming two copies of one card takes two off its quantity", () => {
    // Rollover read the card once above the loop, so both lines wrote Qty - 1
    // from the same original and one copy moved shows without being given up.
    let qty = 3;
    for (let i = 0; i < 2; i++) qty = qty - 1;
    assert.equal(qty, 1);
  });

  it("the shelf still cannot go negative across a run of lines", () => {
    let onHand = 4;
    for (const qty of [3, 3]) onHand = takeStock(onHand, qty);
    assert.equal(onHand, 0);
  });
});

describe("only what is still here comes back", () => {
  // One rule, three callers. `back` is what the return route has always used,
  // and the other two now agree with it.
  const back = (qty: number, hit: number) => Math.max(0, qty - hit);

  it("a part-hit line returns its remainder, not its whole quantity", () => {
    // 40 packs on the wheel, 12 ripped and mailed. 28 are in the box.
    assert.equal(back(40, 12), 28);
  });

  it("a fully hit line returns nothing", () => {
    assert.equal(back(40, 40), 0);
  });

  it("a line hit beyond its quantity does not return a negative", () => {
    assert.equal(back(5, 7), 0);
    assert.equal(clampStock(10 + back(5, 7)), 10);
  });

  it("an untouched line returns in full", () => {
    assert.equal(back(40, 0), 40);
  });
});

describe("the call sites still obey it", () => {
  // Source assertions, because the arithmetic above passed happily while the
  // callers did something else. These name the exact regression each one was.

  const src = (p: string) => readFileSync(p, "utf8");

  it("the purge nets off hits and skips store lines", () => {
    const s = src("lib/streamsTrash.ts");
    assert.match(
      s,
      /Qty Hit/,
      "the purge must subtract hit units; crediting a line's full Qty puts packs that were mailed to buyers back on the shelf",
    );
    assert.match(
      s,
      /Is Store Purchase/,
      "the purge must skip store lines; a pending store sale took nothing off the shelf, so crediting it invents stock",
    );
  });

  it("deleting a line before the return restores only the remainder", () => {
    const s = src("app/api/lines/[id]/route.ts");
    assert.match(
      s,
      /Math\.max\(qty - hit, 0\)/,
      "pre-return delete must restore qty - hit, matching what the return route does with the same line",
    );
  });

  it("the imports write the new quantity back onto the cached record", () => {
    for (const p of ["lib/importPortfolio.ts", "app/api/import/collectr/route.ts"]) {
      assert.match(
        src(p),
        /hit\.fields\["Qty On Hand"\]\s*=/,
        `${p}: without writing back, a second row for the same product reads the pre-loop quantity and overwrites the first row's units`,
      );
    }
  });

  it("the rollover writes the claim back onto the cached card", () => {
    assert.match(
      src("app/api/streams/[id]/rollover/route.ts"),
      /Object\.assign\(card\.fields, c\.fields\)/,
      "without this, two lines of one card both decrement from the same original quantity",
    );
  });

  it("no expired rebuild window is still in the tree", () => {
    // Three routes carried a hand-dated window that lapsed in July and went on
    // shipping as dead branches, with comments advertising behaviour the code
    // no longer had.
    for (const p of [
      "app/api/lines/route.ts",
      "app/api/lines/[id]/route.ts",
      "app/api/lines/bulk/route.ts",
    ]) {
      assert.doesNotMatch(src(p), /rebuildWindow/, `${p} still references the expired rebuild window`);
    }
  });
});
