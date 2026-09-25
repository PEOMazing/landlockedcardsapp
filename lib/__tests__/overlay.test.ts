import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boardKinds, boardLayout, boardSpeed, isOverlayKey, isSingleLine, newOverlayKey, onBoard } from "../overlay";

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

describe("showing singles, sealed, or both", () => {
  const single = { fields: { Qty: 1, "Qty Hit": 0, "Single Rec Id": "recAbc123" } };
  const sealed = { fields: { Qty: 1, "Qty Hit": 0 } };

  it("tells a single card from sealed product by what the line points at", () => {
    assert.equal(isSingleLine(single), true);
    assert.equal(isSingleLine(sealed), false);
    assert.equal(isSingleLine({ fields: { "Single Rec Id": "  " } }), false);
  });

  it("includes both on a stream nobody has touched the setting on", () => {
    // The flags are stored inverted for exactly this: every show that existed
    // before the toggles did still shows everything.
    assert.deepEqual(boardKinds({ fields: {} }), { singles: true, sealed: true });
    assert.equal(onBoard(single), true);
    assert.equal(onBoard(sealed), true);
  });

  it("reads the stored flags as hide, not show", () => {
    assert.deepEqual(boardKinds({ fields: { "Board Hide Sealed": true } }), { singles: true, sealed: false });
    assert.deepEqual(boardKinds({ fields: { "Board Hide Singles": true } }), { singles: false, sealed: true });
  });

  it("drops sealed product from a singles-only board", () => {
    const kinds = { singles: true, sealed: false };
    assert.equal(onBoard(single, kinds), true);
    assert.equal(onBoard(sealed, kinds), false);
  });

  it("drops singles from a sealed-only board", () => {
    const kinds = { singles: false, sealed: true };
    assert.equal(onBoard(single, kinds), false);
    assert.equal(onBoard(sealed, kinds), true);
  });

  it("shows an empty board when both are off rather than falling back to all", () => {
    const kinds = { singles: false, sealed: false };
    assert.equal(onBoard(single, kinds), false);
    assert.equal(onBoard(sealed, kinds), false);
  });

  it("still drops a hit card whatever the kind filter says", () => {
    assert.equal(onBoard({ fields: { Qty: 1, "Qty Hit": 1, "Single Rec Id": "recX" } }, { singles: true, sealed: true }), false);
  });
});

describe("only hits go on the board", () => {
  const worth = (n: number) => ({ fields: { Qty: 1, "Qty Hit": 0, "Market Price Snapshot": n } });
  const both = { singles: true, sealed: true };

  it("keeps a card at or above the threshold", () => {
    // "Ten dollars or more", so exactly ten counts. The whole app reads the
    // same setting, and an off-by-a-penny rule here would put the board and
    // the hit stats out of step where nobody would think to look.
    assert.equal(onBoard(worth(10), both, 10), true);
    assert.equal(onBoard(worth(10.01), both, 10), true);
    assert.equal(onBoard(worth(340), both, 10), true);
  });

  it("drops a card under it", () => {
    assert.equal(onBoard(worth(9.99), both, 10), false);
    assert.equal(onBoard(worth(2), both, 10), false);
    assert.equal(onBoard(worth(0), both, 10), false);
  });

  it("treats a line with no price as under the threshold", () => {
    assert.equal(onBoard({ fields: { Qty: 1, "Qty Hit": 0 } }, both, 10), false);
  });

  it("shows everything when no threshold is given", () => {
    // The default has to be permissive: a settings read that failed must not
    // silently blank the board mid-show.
    assert.equal(onBoard(worth(0.25)), true);
    assert.equal(onBoard(worth(0.25), both, 0), true);
  });

  it("still drops a hit card however valuable it was", () => {
    assert.equal(onBoard({ fields: { Qty: 1, "Qty Hit": 1, "Market Price Snapshot": 500 } }, both, 10), false);
  });
});

describe("board layout", () => {
  it("is the grid unless the stream says banner", () => {
    assert.equal(boardLayout({ fields: {} }), "grid");
    assert.equal(boardLayout({ fields: { "Board Banner": false } }), "grid");
    assert.equal(boardLayout({ fields: { "Board Banner": true } }), "banner");
  });
});

describe("banner scroll speed", () => {
  it("is 1x on a stream nobody has set it on", () => {
    assert.equal(boardSpeed({ fields: {} }), 1);
    assert.equal(boardSpeed({ fields: { "Board Speed": null } }), 1);
  });

  it("reads a multiplier back as given", () => {
    assert.equal(boardSpeed({ fields: { "Board Speed": 1.25 } }), 1.25);
    assert.equal(boardSpeed({ fields: { "Board Speed": 2 } }), 2);
  });

  it("refuses to stop the banner or run it backwards", () => {
    // Zero would freeze it and a negative would scroll it the wrong way.
    // Either is a worse outcome than ignoring the value.
    assert.equal(boardSpeed({ fields: { "Board Speed": 0 } }), 1);
    assert.equal(boardSpeed({ fields: { "Board Speed": -2 } }), 1);
  });

  it("clamps a value that would strobe a live audience", () => {
    assert.equal(boardSpeed({ fields: { "Board Speed": 40 } }), 4);
    assert.equal(boardSpeed({ fields: { "Board Speed": 0.01 } }), 0.25);
  });

  it("ignores junk", () => {
    assert.equal(boardSpeed({ fields: { "Board Speed": "fast" } }), 1);
  });
});
