import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isOverlayKey, newOverlayKey, onBoard } from "../overlay";

const line = (f: Record<string, any>) => ({ fields: { Qty: 1, "Qty Hit": 0, ...f } });

describe("overlay keys", () => {
  it("makes a key of the right shape", () => {
    const k = newOverlayKey();
    assert.equal(k.length, 22);
    assert.equal(isOverlayKey(k), true);
  });

  it("makes a different key every time", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newOverlayKey()));
    assert.equal(seen.size, 200);
  });

  it("leaves out the characters people misread aloud", () => {
    // A key gets read off a screen and typed into OBS by hand, so l/1 and 0/o
    // are worth giving up.
    const all = Array.from({ length: 200 }, () => newOverlayKey()).join("");
    for (const c of ["l", "1", "0", "o"]) assert.equal(all.includes(c), false, `found ${c}`);
  });

  it("rejects anything that is not a key before it costs a query", () => {
    assert.equal(isOverlayKey(""), false);
    assert.equal(isOverlayKey("short"), false);
    assert.equal(isOverlayKey("A".repeat(22)), false);
    assert.equal(isOverlayKey("a".repeat(21)), false);
    assert.equal(isOverlayKey("a".repeat(23)), false);
    // the shape check is also the injection guard, since the key goes into an
    // Airtable filter formula
    assert.equal(isOverlayKey("abcdefghijkmnopqrstu'"), false);
    assert.equal(isOverlayKey(null as any), false);
  });
});

describe("what stays on the board", () => {
  it("shows a card nobody has hit yet", () => {
    assert.equal(onBoard(line({})), true);
  });

  it("drops a card once it is fully hit", () => {
    assert.equal(onBoard(line({ Qty: 1, "Qty Hit": 1 })), false);
    assert.equal(onBoard(line({ Qty: 3, "Qty Hit": 3 })), false);
  });

  it("keeps a multi-copy line up while copies remain", () => {
    assert.equal(onBoard(line({ Qty: 3, "Qty Hit": 2 })), true);
  });

  it("drops a card the streamer pulled by hand", () => {
    assert.equal(onBoard(line({ "Off Board": true })), false);
  });

  it("leaves giveaways and store sales off", () => {
    // Neither is something a viewer is spinning for.
    assert.equal(onBoard(line({ "Is Giveaway": true })), false);
    assert.equal(onBoard(line({ "Is Store Purchase": true })), false);
  });

  it("treats a missing Off Board as on the board", () => {
    // Every line that existed before the field did has no value for it, and
    // none of them should have vanished from the board.
    assert.equal(onBoard({ fields: { Qty: 1, "Qty Hit": 0 } }), true);
  });

  it("does not put a line with no quantity on the board", () => {
    assert.equal(onBoard({ fields: {} }), false);
  });
});
