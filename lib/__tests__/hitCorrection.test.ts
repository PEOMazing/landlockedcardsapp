import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rehitActionFor } from "../streamSingles";
import { shelfDeltaForHitChange } from "../stock";

// Correcting what a show delivered AFTER it closed.
//
// The hit count is a counter right up until the close, then it stops being
// one. The close acts on it: unhit units go back on the shelf, hit cards are
// marked Sold. So a hit changed afterwards is a claim about where a physical
// object is, and the correction has to move the object or the show and the
// binder stop agreeing.
//
// Everything here is the arithmetic and the decisions, with no Airtable in
// sight, because this is the part that is expensive to get wrong: the session
// that prompted it ended with 275 units returned from a show that had already
// run, unwound by hand against a snapshot taken beforehand.

const STREAM = "recStream0000001";

describe("how the shelf moves when a hit is corrected after the close", () => {
  it("takes a unit off when a hit is added", () => {
    // 10 on the line, 2 hit. The close put 8 back. Say it was really 3 and one
    // of those 8 never came back: the shelf is holding a pack that is posted.
    assert.equal(shelfDeltaForHitChange(10, 2, 3), -1);
  });

  it("puts a unit back when a hit is undone", () => {
    assert.equal(shelfDeltaForHitChange(10, 2, 1), 1);
  });

  it("moves nothing when the count did not change", () => {
    assert.equal(shelfDeltaForHitChange(10, 2, 2), 0);
  });

  it("handles a whole line going from nothing hit to all hit", () => {
    assert.equal(shelfDeltaForHitChange(40, 0, 40), -40);
  });

  it("never pretends more came back than was on the line", () => {
    // A hit count above the line quantity is nonsense the route rejects, but
    // the arithmetic must not invent stock if one ever reaches it.
    assert.equal(shelfDeltaForHitChange(5, 9, 0), 5);
    assert.equal(shelfDeltaForHitChange(5, 0, 9), -5);
  });

  it("survives junk", () => {
    assert.equal(shelfDeltaForHitChange(undefined, null, "2"), 0);
    assert.equal(shelfDeltaForHitChange(3, "1", 2), -1);
  });
});

const line = (f: Record<string, any> = {}) => ({ fields: { "Qty": 1, "Qty Hit": 0, "Single Rec Id": "recCard00000001", ...f } });
const card = (f: Record<string, any> = {}) => ({ fields: { "Status": "In Stock", "Stream Rec Id": "", ...f } });

describe("what a corrected hit does to the card itself", () => {
  it("sells a card that the close put back in stock", () => {
    assert.equal(rehitActionFor(line({ "Qty Hit": 0 }), card({ "Status": "In Stock" }), STREAM, true), "sell");
  });

  it("puts a sold card back when the hit is undone", () => {
    assert.equal(
      rehitActionFor(line({ "Qty Hit": 1 }), card({ "Status": "Sold", "Stream Rec Id": STREAM }), STREAM, false),
      "unsell",
    );
  });

  it("sells a card that was held out of the return", () => {
    // Held means it never went back in the binder: it is still In Stream on
    // this show, waiting for the next one. If it turns out it was won, it is
    // sold from there.
    const held = card({ "Status": "In Stream", "Stream Rec Id": STREAM });
    assert.equal(rehitActionFor(line({ "Hold Out": true }), held, STREAM, true), "sell");
  });

  it("leaves a held card alone when the correction says it was not won", () => {
    const held = card({ "Status": "In Stream", "Stream Rec Id": STREAM });
    assert.equal(rehitActionFor(line({ "Hold Out": true }), held, STREAM, false), "skip");
  });

  it("does nothing the second time, so a re-uploaded export is safe", () => {
    // A Whatnot re-upload re-applies every hit it finds, including the ones
    // that were already right. Deciding from where the card IS rather than
    // from what the line used to say makes that a no-op instead of a second
    // sale.
    assert.equal(rehitActionFor(line({ "Qty Hit": 1 }), card({ "Status": "Sold", "Stream Rec Id": STREAM }), STREAM, true), "skip");
    assert.equal(rehitActionFor(line({ "Qty Hit": 0 }), card({ "Status": "In Stock" }), STREAM, false), "skip");
  });

  it("will not touch a card that has moved onto another show", () => {
    // Rollover or a hand correction put it on tonight's set. That decision is
    // newer than the one being corrected and it owns the card now.
    const elsewhere = card({ "Status": "In Stream", "Stream Rec Id": "recOtherShow0001" });
    assert.equal(rehitActionFor(line(), elsewhere, STREAM, true), "skip");
    assert.equal(rehitActionFor(line({ "Qty Hit": 1 }), elsewhere, STREAM, false), "skip");
  });

  it("survives a card that was deleted since the show", () => {
    assert.equal(rehitActionFor(line(), null, STREAM, true), "skip");
  });

  describe("a copy taken off a record holding several", () => {
    // There is no status to read: the record stayed In Stock the whole time
    // and only its count moved. So the line's own old value is the only
    // evidence of what the close did.
    const copy = (hit: number) => line({ "Single Copy": true, "Qty Hit": hit });

    it("takes a copy back off the count when a hit is added", () => {
      assert.equal(rehitActionFor(copy(0), null, STREAM, true), "copy-sell");
    });

    it("gives a copy back when a hit is undone", () => {
      assert.equal(rehitActionFor(copy(1), null, STREAM, false), "copy-unsell");
    });

    it("does nothing when the correction agrees with what is recorded", () => {
      assert.equal(rehitActionFor(copy(1), null, STREAM, true), "skip");
      assert.equal(rehitActionFor(copy(0), null, STREAM, false), "skip");
    });
  });
});
