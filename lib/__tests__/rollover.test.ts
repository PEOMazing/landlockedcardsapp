import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rollDecision, claimFields, sourceLineFix } from "../rollover";

const A = "recStreamAAAAAAAAA";
const B = "recStreamBBBBBBBBB";
const SID = "recCardAAAAAAAAAA";

const line = (f: Record<string, any> = {}) => ({ fields: { Qty: 1, "Qty Hit": 0, "Single Rec Id": SID, ...f } });
const card = (f: Record<string, any> = {}) => ({ id: SID, fields: { Status: "In Stream", "Stream Rec Id": A, Qty: 1, ...f } });

describe("what rolling a line onto the next show does", () => {
  it("repoints a card still sitting on the old show", () => {
    // Nothing physical moves and nothing goes back on the shelf: the card was
    // never off the pile, only pointed at a show that is over.
    assert.deepEqual(rollDecision(line(), card(), A, false), { action: "repoint" });
  });

  it("claims a card the old show already handed back", () => {
    const d = rollDecision(line(), card({ Status: "In Stock", "Stream Rec Id": "" }), A, true);
    assert.equal(d.action, "claim");
  });

  it("leaves a card that has been won alone", () => {
    assert.equal(rollDecision(line({ "Qty Hit": 1 }), card(), A, false).reason, "already hit");
    assert.equal(rollDecision(line({ Qty: 3, "Qty Hit": 3 }), card(), A, false).action, "skip");
  });

  it("rolls the copies that are left on a part-hit line", () => {
    assert.equal(rollDecision(line({ Qty: 3, "Qty Hit": 1 }), card(), A, false).action, "repoint");
  });

  it("leaves giveaways, store sales and sealed product out of it", () => {
    assert.equal(rollDecision(line({ "Is Giveaway": true }), card(), A, false).reason, "giveaway");
    assert.equal(rollDecision(line({ "Is Store Purchase": true }), card(), A, false).reason, "store sale");
    assert.equal(rollDecision(line({ "Single Rec Id": "" }), card(), A, false).reason, "sealed product");
  });

  it("will not take a card that is sold or already on someone else's show", () => {
    assert.equal(rollDecision(line(), card({ Status: "Sold" }), A, false).reason, "sold");
    assert.equal(rollDecision(line(), card({ "Stream Rec Id": "recStreamCCCCCCCCC" }), A, false).reason, "already on another show");
  });

  it("skips a card that has been deleted since the show", () => {
    assert.equal(rollDecision(line(), null, A, false).reason, "card no longer exists");
  });
});

describe("copy lines, which are the ones that can double up", () => {
  const copy = () => line({ "Single Copy": true });

  it("moves the line rather than the record, while the old show is still open", () => {
    // The record never left stock - its Qty was decremented and the copy lives
    // only as the line. So the move is a line move and the card is untouched.
    assert.deepEqual(rollDecision(copy(), card({ Status: "In Stock", Qty: 2 }), A, false), { action: "move-copy" });
  });

  it("cuts the old line's link so the close cannot hand the copy back", () => {
    // closeActionFor returns copy-return off the line alone, without reading
    // the card. A copy line left intact would put a copy back on the shelf
    // that the next show is already holding.
    const fix = sourceLineFix(line({ "Single Copy": true, Line: "1x [0361] NM Charmander" }), { action: "move-copy" });
    assert.equal(fix!["Single Rec Id"], "");
    assert.equal(fix!["Single Copy"], false);
    assert.equal(fix!["Line"], "1x [0361] NM Charmander (rolled over)");
  });

  it("does not mark the same line twice if it is rolled on again", () => {
    const once = sourceLineFix(line({ "Single Copy": true, Line: "1x Charmander (rolled over)" }), { action: "move-copy" });
    assert.equal(once!["Line"], "1x Charmander (rolled over)");
  });

  it("takes a fresh copy off the shelf once the old show has closed", () => {
    // The close already ran Qty + 1, so there is a real copy to claim and
    // moving the line would take a second one.
    assert.equal(rollDecision(copy(), card({ Status: "In Stock", Qty: 3 }), A, true).action, "claim");
  });

  it("refuses when the copy is not back on the shelf", () => {
    assert.equal(rollDecision(copy(), card({ Status: "Sold" }), A, true).reason, "the copy did not come back in stock");
  });

  it("leaves every other line untouched at the source", () => {
    assert.equal(sourceLineFix(line(), { action: "repoint" }), null);
    assert.equal(sourceLineFix(line(), { action: "claim" }), null);
    assert.equal(sourceLineFix(line(), { action: "skip", reason: "sold" }), null);
  });
});

describe("taking the card onto the new show", () => {
  it("moves a one-copy record wholesale", () => {
    assert.deepEqual(claimFields(card({ Qty: 1 }), B), { copy: false, fields: { "Status": "In Stream", "Stream Rec Id": B } });
  });

  it("takes one copy off a record holding several", () => {
    assert.deepEqual(claimFields(card({ Qty: 4 }), B), { copy: true, fields: { "Qty": 3 } });
  });

  it("matches what the singles picker does, so a rolled card is not a special case", () => {
    assert.equal(claimFields(card({ Qty: 1 }), B).copy, false);
    assert.equal(claimFields(card({}), B).copy, false);
  });
});
