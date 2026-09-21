import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { closeActionFor, releaseActionFor, hitsDecideSingles, soldAtClose, wheelPriceUpdate } from "../streamSingles";

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
