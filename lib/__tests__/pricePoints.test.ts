import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bucketPriceGuide, guideKey, splitGuideCondition } from "../tcgPricePoints";

// Real rows from the Undaunted price guide, product 90145 (Umbreon 10/90).
// The card that started this: Near Mint Reverse Holofoil is $199.99 and the
// Moderately Played copy is $39.93, a spread no condition-blind number can
// describe.
const UMBREON = [
  { productID: 90145, condition: "Near Mint Reverse Holofoil", printing: "Reverse Holofoil", marketPrice: 199.99, lowPrice: 17.57, sales: 0 },
  { productID: 90145, condition: "Lightly Played Reverse Holofoil", printing: "Reverse Holofoil", marketPrice: 54.91, lowPrice: 17.57, sales: 0 },
  { productID: 90145, condition: "Moderately Played Reverse Holofoil", printing: "Reverse Holofoil", marketPrice: 39.93, lowPrice: 17.57, sales: 0 },
  { productID: 90145, condition: "Heavily Played Reverse Holofoil", printing: "Reverse Holofoil", marketPrice: 36.75, lowPrice: 17.57, sales: 0 },
  { productID: 90145, condition: "Damaged Reverse Holofoil", printing: "Reverse Holofoil", marketPrice: 17.57, lowPrice: 17.57, sales: 0 },
  { productID: 90145, condition: "Near Mint Holofoil", printing: "Holofoil", marketPrice: 96.83, lowPrice: 17.57, sales: 0 },
  { productID: 90145, condition: "Moderately Played Holofoil", printing: "Holofoil", marketPrice: 51.17, lowPrice: 17.57, sales: 0 },
];

describe("recovering the condition from the guide's joined label", () => {
  it("strips the printing off the end, not out of the middle", () => {
    // "Holofoil" appears in both halves of "Near Mint Holofoil". A replace
    // would eat the wrong one and leave "Near Mint" looking like a printing.
    assert.equal(splitGuideCondition("Near Mint Holofoil", "Holofoil"), "Near Mint");
    assert.equal(splitGuideCondition("Moderately Played Reverse Holofoil", "Reverse Holofoil"), "Moderately Played");
    assert.equal(splitGuideCondition("Damaged Normal", "Normal"), "Damaged");
  });

  it("leaves a label alone when the printing is not its suffix", () => {
    assert.equal(splitGuideCondition("Near Mint", ""), "Near Mint");
    assert.equal(splitGuideCondition("Near Mint", "Holofoil"), "Near Mint");
  });

  it("does not eat a label that is exactly the printing", () => {
    assert.equal(splitGuideCondition("Holofoil", "Holofoil"), "Holofoil");
  });
});

describe("reading condition-specific market prices", () => {
  it("keys on product, printing and condition together", () => {
    const m = bucketPriceGuide(UMBREON);
    assert.equal(m.get(guideKey(90145, "Reverse Holofoil", "Moderately Played"))?.market, 39.93);
    assert.equal(m.get(guideKey(90145, "Reverse Holofoil", "Near Mint"))?.market, 199.99);
    assert.equal(m.size, 7);
  });

  it("keeps the two printings apart at the same condition", () => {
    // $96.83 against $199.99 for the same card in the same condition. Reading
    // the printing off the wrong row is a 2x error before condition is even
    // considered.
    const m = bucketPriceGuide(UMBREON);
    assert.equal(m.get(guideKey(90145, "Holofoil", "Near Mint"))?.market, 96.83);
    assert.equal(m.get(guideKey(90145, "Holofoil", "Moderately Played"))?.market, 51.17);
  });

  it("carries the sale count, because zero sales is worth knowing", () => {
    // Every one of these is a modelled price with no sales under it. That does
    // not make it wrong, but it is not the same claim as a sold median and the
    // caller should be able to tell the difference.
    const m = bucketPriceGuide(UMBREON);
    assert.equal(m.get(guideKey(90145, "Reverse Holofoil", "Near Mint"))?.sales, 0);
    assert.equal(
      bucketPriceGuide([{ productID: 1, condition: "Near Mint Normal", printing: "Normal", marketPrice: 2, sales: 14 }])
        .get(guideKey(1, "Normal", "Near Mint"))?.sales,
      14,
    );
  });

  it("drops a row with no market price rather than storing a zero", () => {
    // A condition nobody has ever listed comes back empty. Storing that would
    // read as "this card is worth nothing in MP", which a sticker would carry.
    const m = bucketPriceGuide([
      { productID: 90145, condition: "Damaged Holofoil", printing: "Holofoil", marketPrice: null },
      ...UMBREON,
    ]);
    assert.equal(m.has(guideKey(90145, "Holofoil", "Damaged")), false);
    assert.equal(m.size, 7);
  });

  it("skips rows with no usable product id", () => {
    const m = bucketPriceGuide([
      { condition: "Near Mint Normal", printing: "Normal", marketPrice: 5 },
      { productID: 0, condition: "Near Mint Normal", printing: "Normal", marketPrice: 5 },
    ]);
    assert.equal(m.size, 0);
  });

  it("has nothing to say about an empty guide", () => {
    assert.equal(bucketPriceGuide([]).size, 0);
    assert.equal(bucketPriceGuide(null as any).size, 0);
  });
});
