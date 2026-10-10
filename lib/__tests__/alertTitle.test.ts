import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { stockAlertTitle } from "../alerts";

// Every stock alert on the login banner opened with "Whatnot sync:", whatever
// had actually moved the stock, and put the real cause in brackets at the end.
// None of the seven callers is a Whatnot sync: they are set builds, store
// sales, returns, approvals and hand corrections. When a count looks wrong,
// which of those it was is the first thing worth knowing, so it leads now.

const one = [{ name: "Brilliant Fantasy pack", qtyNow: 54, delta: -171 }];
const many = [
  { name: "Brilliant Fantasy pack", qtyNow: 54, delta: -171 },
  { name: "30th Celebration Booster Pack CN", qtyNow: 11, delta: -9 },
];

describe("what a stock alert says", () => {
  it("leads with what moved the stock", () => {
    assert.equal(stockAlertTitle(one, "set build"), "Set build: Brilliant Fantasy pack now 54 on hand");
  });

  it("no longer claims a Whatnot sync did it", () => {
    for (const source of ["store sale", "items returned - relist on Whatnot", "hit corrected on a closed show"]) {
      assert.ok(!stockAlertTitle(one, source).startsWith("Whatnot sync"), source);
    }
  });

  it("keeps a source that already mentions Whatnot honest about the cause", () => {
    assert.equal(
      stockAlertTitle(one, "items returned - relist on Whatnot"),
      "Items returned - relist on Whatnot: Brilliant Fantasy pack now 54 on hand",
    );
  });

  it("counts the listings when several moved", () => {
    assert.equal(stockAlertTitle(many, "stream approved"), "Stream approved: 2 listings changed");
  });

  it("says something sane when the caller gives it nothing", () => {
    assert.equal(stockAlertTitle(one, ""), "Stock change: Brilliant Fantasy pack now 54 on hand");
    assert.equal(stockAlertTitle(one, "   "), "Stock change: Brilliant Fantasy pack now 54 on hand");
  });

  it("does not print a blank name or NaN when a record is thin", () => {
    // a line whose product has been renamed or deleted still raises an alert
    assert.equal(
      stockAlertTitle([{ name: "", qtyNow: NaN, delta: 1 }], "set build"),
      "Set build: an item now 0 on hand",
    );
  });
});
