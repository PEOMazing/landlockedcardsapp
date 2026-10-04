import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HIT_MARK, conditionInText, leadBracket, missingCondition, whatnotDescription, whatnotLine, whatnotTitle,
} from "../showSetTitle";

// Built from a real policy violation and the sale report that explained it.
//
// Whatnot flagged a show set for listings with no condition. The app's own
// lines all had one; the listings did not. Comparing the two showed what
// survives the trip and what does not: bracketed text and emoji came through
// verbatim, bare words in the middle of the title did not.

describe("the title that gets pasted into Whatnot", () => {
  const eevee = { slot: 368, condition: "NM", name: "Eevee - 200 (Cosmos Holo)", cardNumber: "SVP 200" };

  it("puts the condition inside the bracket with the slot", () => {
    // The bracket is the part that came through untouched on all 44 listings
    // in the report, so it is where the condition is safest.
    assert.equal(whatnotTitle(eevee), "[0368 NM] Eevee - 200 (Cosmos Holo) #SVP 200");
  });

  it("keeps the slot first, so packing is unchanged", () => {
    assert.match(whatnotTitle(eevee), /^\[0368 /);
  });

  it("leaves the set name out of the title", () => {
    // It was being stripped by Whatnot anyway, and the description carries it.
    assert.equal(whatnotTitle(eevee).includes("Scarlet"), false);
    assert.equal(whatnotDescription("SV: Scarlet & Violet Promo Cards"), "Pokemon - SV: Scarlet & Violet Promo Cards");
  });

  it("pads the slot to four digits, the way the sticker prints it", () => {
    assert.equal(leadBracket({ slot: 7, condition: "LP", name: "x" }), "[0007 LP]");
  });

  it("still carries the condition when the card has no slot yet", () => {
    assert.equal(whatnotTitle({ slot: null, condition: "PSA 10", name: "Charizard", cardNumber: "4/102" }),
      "[PSA 10] Charizard #4/102");
  });

  it("calls sealed product Sealed, because that is its condition", () => {
    assert.equal(whatnotTitle({ name: "30th Celebration Booster Bundle", sealed: true }),
      "[Sealed] 30th Celebration Booster Bundle");
  });

  it("never emits an empty bracket", () => {
    assert.equal(whatnotTitle({ name: "Mystery thing" }), "Mystery thing");
    assert.equal(leadBracket({ name: "Mystery thing" }), "");
  });
});

describe("the pasted line", () => {
  const eevee = { slot: 368, condition: "NM", name: "Eevee - 200 (Cosmos Holo)", cardNumber: "SVP 200", qty: 1 };

  it("wraps a hit in the mark, which is what survives into the listing", () => {
    // In the report every emoji-wrapped listing kept its full text, including
    // the set names that the bare ones lost. Prefixing alone was not what the
    // surviving listings did; wrapping was.
    assert.equal(
      whatnotLine({ ...eevee, isHit: true }),
      `1x ${HIT_MARK}[0368 NM] Eevee - 200 (Cosmos Holo) #SVP 200${HIT_MARK}`,
    );
  });

  it("leaves everything else unmarked, so the mark still means something", () => {
    assert.equal(whatnotLine(eevee), "1x [0368 NM] Eevee - 200 (Cosmos Holo) #SVP 200");
  });

  it("leads with the quantity Whatnot expects", () => {
    assert.match(whatnotLine({ ...eevee, qty: 12 }), /^12x /);
    assert.match(whatnotLine({ ...eevee, qty: 0 }), /^1x /);
    assert.match(whatnotLine({ ...eevee, qty: undefined as any }), /^1x /);
  });
});

describe("spotting a title that would go out uncompliant", () => {
  it("finds the condition wherever it sits", () => {
    assert.equal(conditionInText("[0368 NM] Eevee - 200"), "NM");
    assert.equal(conditionInText("1x [0368] NM Eevee - 200 (Cosmos Holo)"), "NM");
    assert.equal(conditionInText("[Sealed] 30th Celebration Booster Bundle"), "Sealed");
    assert.equal(conditionInText("[0872 PSA 10] Reshiram & Zekrom GX"), "PSA 10");
  });

  it("reads PSA 10 as PSA 10 and not as PSA 1", () => {
    assert.equal(conditionInText("[0872 PSA 10] Reshiram"), "PSA 10");
  });

  it("does not invent one that is not there", () => {
    // The exact title Whatnot complained about.
    assert.equal(conditionInText("[0368] EEVEE - 200 COSMOS HOLO #SVP 200"), null);
    assert.equal(conditionInText(""), null);
    assert.equal(conditionInText(undefined), null);
  });

  it("does not match a condition buried inside a word", () => {
    assert.equal(conditionInText("Hidden Fates Tin"), null);
    assert.equal(conditionInText("Champion's Path"), null);
  });

  it("picks out exactly the lines that would be flagged", () => {
    const lines = [
      { exportTitle: "[0368 NM] Eevee - 200 (Cosmos Holo) #SVP 200" },
      { exportTitle: "[0368] EEVEE - 200 COSMOS HOLO #SVP 200" },
      { exportTitle: "[Sealed] 30th Celebration Booster Bundle" },
      { exportTitle: "Brilliant Fantasy pack" },
    ];
    assert.deepEqual(missingCondition(lines).map((l) => l.exportTitle), [
      "[0368] EEVEE - 200 COSMOS HOLO #SVP 200",
      "Brilliant Fantasy pack",
    ]);
  });
});
