import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NOTE_MAX, money, orderNote, orderTotal, venmoUrl } from "../venmo";

describe("money", () => {
  it("always gives two decimals", () => {
    assert.equal(money(12), "12.00");
    assert.equal(money(12.5), "12.50");
    assert.equal(money(12.345), "12.35");
    assert.equal(money(0), "0.00");
  });
});

describe("orderTotal", () => {
  it("adds the prices", () => {
    assert.equal(orderTotal([1, 2, 3]), 6);
    assert.equal(orderTotal([10.1, 20.2]), 30.3);
  });

  it("treats a card with no price as free rather than as a NaN", () => {
    assert.equal(orderTotal([5, null, undefined, 5]), 10);
    assert.equal(orderTotal([]), 0);
  });
});

describe("orderNote", () => {
  it("lists the card numbers", () => {
    assert.equal(orderNote(["0751", "0802"]), "LandLocked Cards: 0751, 0802");
  });

  it("counts the ones that do not fit instead of getting cut off", () => {
    const many = Array.from({ length: 200 }, (_, i) => String(1000 + i));
    const note = orderNote(many);
    assert.ok(note.length <= NOTE_MAX, `note was ${note.length} chars`);
    assert.match(note, / \+\d+ more$/);
    // the overflow count has to be right, or the note lies about the order size
    const listed = note.replace("LandLocked Cards: ", "").replace(/ \+\d+ more$/, "").split(", ").length;
    const left = Number(note.match(/\+(\d+) more$/)![1]);
    assert.equal(listed + left, 200);
  });

  it("survives an empty cart", () => {
    assert.equal(orderNote([]), "LandLocked Cards:");
    assert.equal(orderNote(["", "  "]), "LandLocked Cards:");
  });
});

describe("venmoUrl", () => {
  it("points at the handle with the amount and note attached", () => {
    const u = new URL(venmoUrl(43.5, "LandLocked Cards: 0751"));
    assert.equal(u.hostname, "venmo.com");
    assert.equal(u.pathname, "/landlockedcards");
    assert.equal(u.searchParams.get("txn"), "pay");
    assert.equal(u.searchParams.get("amount"), "43.50");
    assert.equal(u.searchParams.get("note"), "LandLocked Cards: 0751");
  });

  it("escapes a note rather than breaking the query string", () => {
    const u = new URL(venmoUrl(1, "a&b=c d"));
    assert.equal(u.searchParams.get("note"), "a&b=c d");
  });
});
