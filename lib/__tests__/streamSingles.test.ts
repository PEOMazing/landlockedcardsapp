import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { claimForStream, closeActionFor, releaseActionFor, hitsDecideSingles, soldAtClose, unavailableReason, wheelPriceUpdate } from "../streamSingles";

// These rules decide whether a card is Sold or back on the shelf when a show
// closes. Getting one wrong silently corrupts inventory - which is exactly the
// mess that took a full night of sticker-by-sticker counting to clean up - so
// every branch gets pinned here.

const S = "recStreamAAAAAAAAA";
const OTHER = "recStreamBBBBBBBBB";

const line = (f: Record<string, any> = {}) => ({ fields: { "Single Rec Id": "recCardAAAAAAAAAAA", "Qty Hit": 0, ...f } });
const card = (f: Record<string, any> = {}) => ({ fields: { "Status": "In Stream", "Stream Rec Id": S, ...f } });

describe("which shows let a hit decide", () => {
  it("a Surprise Set sells only what a spin landed on", () => {
    assert.equal(hitsDecideSingles("Surprise Set"), true);
  });
  it("a Single Stream auctions every card, so every card sells", () => {
    assert.equal(hitsDecideSingles("Single Stream"), false);
  });
  it("a stream with no type recorded is treated as a Surprise Set", () => {
    assert.equal(hitsDecideSingles(""), true);
  });
  it("an auction card counts as sold even with no hit logged", () => {
    assert.equal(soldAtClose(line({ "Qty Hit": 0 }), "Single Stream"), true);
  });
});

describe("closing a show - a whole record on the wheel", () => {
  it("a hit card is sold", () => {
    assert.equal(closeActionFor(line({ "Qty Hit": 1 }), card(), S, "Surprise Set"), "sold");
  });
  it("an unhit card goes back to stock", () => {
    assert.equal(closeActionFor(line({ "Qty Hit": 0 }), card(), S, "Surprise Set"), "return");
  });
  it("on an auction show an unhit card still sells, as it always has", () => {
    assert.equal(closeActionFor(line({ "Qty Hit": 0 }), card(), S, "Single Stream"), "sold");
  });
  it("leaves alone a card that has since been moved to another show", () => {
    assert.equal(closeActionFor(line(), card({ "Stream Rec Id": OTHER }), S, "Surprise Set"), "skip");
  });
  it("leaves alone a card someone already put back by hand", () => {
    assert.equal(closeActionFor(line(), card({ "Status": "In Stock", "Stream Rec Id": "" }), S, "Surprise Set"), "skip");
  });
  it("leaves alone a card that was deleted", () => {
    assert.equal(closeActionFor(line(), null, S, "Surprise Set"), "skip");
  });
});

describe("closing a show - one copy off a multi-copy record", () => {
  it("an unhit copy comes back as Qty + 1", () => {
    assert.equal(closeActionFor(line({ "Single Copy": true, "Qty Hit": 0 }), null, S, "Surprise Set"), "copy-return");
  });
  it("a hit copy stays gone - Qty already came down when it went on", () => {
    assert.equal(closeActionFor(line({ "Single Copy": true, "Qty Hit": 1 }), null, S, "Surprise Set"), "copy-sold");
  });
  it("an auctioned copy stays gone", () => {
    assert.equal(closeActionFor(line({ "Single Copy": true, "Qty Hit": 0 }), null, S, "Single Stream"), "copy-sold");
  });
});

describe("taking a card's line off a show", () => {
  it("before the show closes the card always comes back", () => {
    assert.equal(releaseActionFor(line(), card(), S, "Surprise Set", false), "restore");
  });
  it("before close a copy comes back as Qty + 1", () => {
    assert.equal(releaseActionFor(line({ "Single Copy": true }), null, S, "Surprise Set", false), "copy-restore");
  });
  it("after close a hit card that was marked Sold comes back", () => {
    assert.equal(releaseActionFor(line({ "Qty Hit": 1 }), card({ "Status": "Sold" }), S, "Surprise Set", true), "restore");
  });
  it("after close an unhit card was already returned, so nothing happens twice", () => {
    assert.equal(releaseActionFor(line({ "Qty Hit": 0 }), card({ "Status": "In Stock", "Stream Rec Id": "" }), S, "Surprise Set", true), "skip");
  });
  it("after close an unhit copy was already put back, so Qty is not bumped twice", () => {
    assert.equal(releaseActionFor(line({ "Single Copy": true, "Qty Hit": 0 }), null, S, "Surprise Set", true), "skip");
  });
  it("after close an auctioned card comes back even with no hit logged", () => {
    assert.equal(releaseActionFor(line({ "Qty Hit": 0 }), card({ "Status": "Sold" }), S, "Single Stream", true), "restore");
  });
  it("never pulls a card off a different show it has since moved to", () => {
    assert.equal(releaseActionFor(line(), card({ "Stream Rec Id": OTHER }), S, "Surprise Set", false), "skip");
  });
});

describe("wheelPriceUpdate", () => {
  const line = (snap: any, sid: any = "recAAAAAAAAAAAAAA") => ({ fields: { "Single Rec Id": sid, "Market Price Snapshot": snap } });
  const card = (comp: any) => ({ fields: { Comp: comp } });
  it("follows the card's comp on a wheel", () => {
    assert.equal(wheelPriceUpdate(line(130), card(125), "Surprise Set"), 125);
    assert.equal(wheelPriceUpdate(line(120), card(125), "Surprise Set"), 125);
  });
  it("leaves a line alone when it already matches", () => {
    assert.equal(wheelPriceUpdate(line(125), card(125), "Surprise Set"), null);
  });
  it("fills in a line that had no price", () => {
    assert.equal(wheelPriceUpdate(line(undefined), card(40), "Surprise Set"), 40);
  });
  it("never touches an auction", () => {
    assert.equal(wheelPriceUpdate(line(1), card(125), "Single Stream"), null);
  });
  it("ignores sealed lines and cards with no comp", () => {
    assert.equal(wheelPriceUpdate(line(10, ""), card(125), "Surprise Set"), null);
    assert.equal(wheelPriceUpdate(line(10), card(null), "Surprise Set"), null);
    assert.equal(wheelPriceUpdate(line(10), null, "Surprise Set"), null);
  });
});

describe("claiming a card for a show", () => {
  const card = (f: Record<string, any>) => ({ fields: f });

  it("lets an in-stock card on", () => {
    assert.equal(unavailableReason(card({ Status: "In Stock", Qty: 1 })), null);
    // Records predate both fields; a blank one has always meant one copy in stock.
    assert.equal(unavailableReason(card({})), null);
  });

  it("turns away a card that is already on a set", () => {
    // This is the message a second click gets, so it has to read like an
    // explanation rather than an error.
    assert.equal(
      unavailableReason(card({ Status: "In Stream", Qty: 1 })),
      "that card is already on a show set",
    );
  });

  it("turns away a card that has left the building", () => {
    assert.equal(unavailableReason(card({ Status: "Sold" })), "that card is sold, not in stock");
    assert.equal(unavailableReason(null), "that card no longer exists");
  });

  it("turns away a record with no copies left", () => {
    assert.equal(
      unavailableReason(card({ Status: "In Stock", Qty: 0 })),
      "there are no copies of that card left in stock",
    );
  });

  it("moves a one-copy record onto the stream whole", () => {
    const c = claimForStream(card({ Status: "In Stock", Qty: 1 }), S);
    assert.equal(c.copy, false);
    assert.deepEqual(c.fields, { "Status": "In Stream", "Stream Rec Id": S });
  });

  it("takes one copy off a record holding several and leaves it in stock", () => {
    const c = claimForStream(card({ Status: "In Stock", Qty: 3 }), S);
    assert.equal(c.copy, true);
    assert.deepEqual(c.fields, { "Qty": 2 });
  });

  it("treats the last copy of a multi-copy record as the whole record", () => {
    // Qty 1 is Qty 1 however it got there, and the close has to be able to flip
    // it back. A copy claim here would decrement to zero and strand the record
    // In Stock with nothing in it.
    const c = claimForStream(card({ Status: "In Stock", Qty: 1 }), S);
    assert.equal(c.copy, false);
  });

  it("claims a blank-Qty record whole", () => {
    assert.equal(claimForStream(card({}), S).copy, false);
  });

  it("writes nothing the close does not know how to undo", () => {
    // closeActionFor and releaseActionFor both key off Single Copy plus the
    // card's Status and Stream Rec Id. Claim and undo have to move exactly
    // those, or a card comes back from a show in a state nothing reads.
    const whole = claimForStream(card({ Qty: 1 }), S);
    assert.deepEqual(Object.keys(whole.fields).sort(), ["Status", "Stream Rec Id"]);
    const copy = claimForStream(card({ Qty: 2 }), S);
    assert.deepEqual(Object.keys(copy.fields), ["Qty"]);
  });
});
