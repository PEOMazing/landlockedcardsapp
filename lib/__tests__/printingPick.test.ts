import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickPrinting, subTypeForVariant } from "../tcgcsvCards";

// The two WotC shapes that actually occur on tcgcsv. Some old products split
// into "1st Edition Holofoil" / "Unlimited Holofoil"; others just into
// "1st Edition" / "Unlimited" with the holo-ness left in the card itself.
const WOTC_FOIL: [string, number][] = [
  ["1st Edition Holofoil", 210.44],
  ["Unlimited Holofoil", 22.41],
];
const WOTC_PLAIN: [string, number][] = [
  ["1st Edition", 22.61],
  ["Unlimited", 8.96],
];
const MODERN: [string, number][] = [
  ["Holofoil", 12.5],
  ["Reverse Holofoil", 4.1],
];

describe("what an imported variant means as a TCGplayer printing", () => {
  it("keeps Unlimited rather than quietly upgrading it", () => {
    assert.equal(subTypeForVariant("Unlimited Holofoil", ""), "Unlimited Holofoil");
    assert.equal(subTypeForVariant("Unlimited", ""), "Unlimited");
  });

  it("does not attach Holofoil to a 1st Edition common", () => {
    assert.equal(subTypeForVariant("1st Edition", ""), "1st Edition");
    assert.equal(subTypeForVariant("1st Edition Holofoil", ""), "1st Edition Holofoil");
  });

  it("leaves the modern vocabulary alone", () => {
    assert.equal(subTypeForVariant("Reverse Holofoil", ""), "Reverse Holofoil");
    assert.equal(subTypeForVariant("Holofoil", ""), "Holofoil");
    assert.equal(subTypeForVariant("", "Rare Holo"), "Holofoil");
    assert.equal(subTypeForVariant("", "Common"), "Normal");
  });

  it("reads reverse before print run, since a reverse is never 1st Edition here", () => {
    assert.equal(subTypeForVariant("Reverse Holofoil 1st Edition", ""), "Reverse Holofoil");
  });
});

describe("picking a printing when the exact name is not on offer", () => {
  it("prices Lapras Fossil as Unlimited, not as the 1st Edition copy", () => {
    // The bug this replaces: a $22 Unlimited Lapras came back at $210.44
    // because 1st Edition happened to be first in the price file.
    const hit = pickPrinting(WOTC_FOIL, "Unlimited Holofoil");
    assert.equal(hit?.sub, "Unlimited Holofoil");
    assert.equal(hit?.price, 22.41);
  });

  it("reads a bare Holofoil on an old set as the Unlimited run", () => {
    // Nothing said 1st Edition, and 1st Edition is the claim that needs saying.
    const hit = pickPrinting(WOTC_FOIL, "Holofoil");
    assert.equal(hit?.sub, "Unlimited Holofoil");
  });

  it("still finds 1st Edition when that is what the card is", () => {
    const hit = pickPrinting(WOTC_FOIL, "1st Edition Holofoil");
    assert.equal(hit?.price, 210.44);
  });

  it("matches a holo 1st Edition to a set that only names the print run", () => {
    // Flareon, Jungle 19: a holo rare, but the product splits 1st Edition /
    // Unlimited with no "Holofoil" in either name.
    const hit = pickPrinting(WOTC_PLAIN, "1st Edition Holofoil");
    assert.equal(hit?.sub, "1st Edition");
  });

  it("falls to the cheaper run when nothing in the name matches", () => {
    // "Normal" against 1st Edition / Unlimited shares no word with either.
    // Guessing high writes a price we would have to honour; guessing low costs
    // margin on a card someone can still look at.
    const hit = pickPrinting(WOTC_PLAIN, "Normal");
    assert.equal(hit?.sub, "Unlimited");
    assert.equal(hit?.price, 8.96);
  });

  it("does not let Reverse win a plain Holofoil request", () => {
    assert.equal(pickPrinting(MODERN, "Holofoil")?.price, 12.5);
    assert.equal(pickPrinting(MODERN, "Reverse Holofoil")?.price, 4.1);
  });

  it("returns the only printing there is", () => {
    assert.equal(pickPrinting([["Normal", 3.25]], "Reverse Holofoil")?.price, 3.25);
  });

  it("has nothing to say about a product with no prices", () => {
    assert.equal(pickPrinting([], "Holofoil"), null);
  });
});
