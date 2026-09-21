import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { priceBound, inPriceRange, rangeBackwards } from "../priceRange";

// The range quietly decides which cards a person can see, so a wrong answer
// here reads as "my card disappeared". Every branch gets pinned.

describe("priceBound", () => {
  it("reads a plain number", () => {
    assert.equal(priceBound("25"), 25);
    assert.equal(priceBound("25.50"), 25.5);
  });
  it("forgives the way people type money", () => {
    assert.equal(priceBound("$25"), 25);
    assert.equal(priceBound(" 1,250 "), 1250);
  });
  it("treats an empty or half-typed box as no bound", () => {
    assert.equal(priceBound(""), null);
    assert.equal(priceBound("   "), null);
    assert.equal(priceBound("$"), null);
    assert.equal(priceBound("abc"), null);
    assert.equal(priceBound("."), null);
  });
  it("refuses a negative price", () => {
    assert.equal(priceBound("-5"), null);
  });
  it("keeps zero, which is a real bound", () => {
    assert.equal(priceBound("0"), 0);
  });
});

describe("inPriceRange", () => {
  it("passes everything when neither end is set", () => {
    assert.equal(inPriceRange(10, null, null), true);
    assert.equal(inPriceRange(null, null, null), true);
  });
  it("honours a max on its own", () => {
    assert.equal(inPriceRange(10, null, 25), true);
    assert.equal(inPriceRange(30, null, 25), false);
  });
  it("honours a min on its own", () => {
    assert.equal(inPriceRange(30, 25, null), true);
    assert.equal(inPriceRange(10, 25, null), false);
  });
  it("includes both ends", () => {
    assert.equal(inPriceRange(5, 5, 20), true);
    assert.equal(inPriceRange(20, 5, 20), true);
  });
  it("drops an unpriced card out of any range", () => {
    assert.equal(inPriceRange(null, null, 25), false);
    assert.equal(inPriceRange(undefined, 5, null), false);
  });
  it("keeps an unpriced card when no range is set", () => {
    assert.equal(inPriceRange(null, null, null), true);
  });
  it("matches nothing when the range is backwards", () => {
    assert.equal(inPriceRange(30, 50, 10), false);
    assert.equal(inPriceRange(5, 50, 10), false);
  });
  it("handles a zero max, which means free cards only", () => {
    assert.equal(inPriceRange(0, null, 0), true);
    assert.equal(inPriceRange(1, null, 0), false);
  });
});

describe("rangeBackwards", () => {
  it("is only true with both ends set the wrong way round", () => {
    assert.equal(rangeBackwards(50, 10), true);
    assert.equal(rangeBackwards(10, 50), false);
    assert.equal(rangeBackwards(10, 10), false);
    assert.equal(rangeBackwards(null, 10), false);
    assert.equal(rangeBackwards(50, null), false);
    assert.equal(rangeBackwards(null, null), false);
  });
});
