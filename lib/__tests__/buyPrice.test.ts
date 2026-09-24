import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BUY_PCT, buyPriceFrom, buyPriceIsCurrent } from "../buyPrice";

describe("buyPriceFrom", () => {
  it("takes the share of the comp", () => {
    assert.equal(buyPriceFrom(100, 0.8), 80);
    assert.equal(buyPriceFrom(1, 0.8), 0.8);
    assert.equal(buyPriceFrom(219, DEFAULT_BUY_PCT), 175.2);
  });

  it("lands on the cent", () => {
    assert.equal(buyPriceFrom(53.91, 0.8), 43.13);
    assert.equal(buyPriceFrom(0.07, 0.8), 0.06);
  });

  it("gives nothing to a card with no comp, rather than a free card", () => {
    assert.equal(buyPriceFrom(null, 0.8), null);
    assert.equal(buyPriceFrom(undefined, 0.8), null);
    assert.equal(buyPriceFrom(0, 0.8), null);
    assert.equal(buyPriceFrom("" as any, 0.8), null);
  });

  it("refuses a percentage that is not one", () => {
    assert.equal(buyPriceFrom(100, 0), null);
    assert.equal(buyPriceFrom(100, -1), null);
    assert.equal(buyPriceFrom(100, NaN), null);
  });
});

describe("buyPriceIsCurrent", () => {
  it("skips a card already carried at the right number", () => {
    assert.equal(buyPriceIsCurrent(80, 80), true);
    assert.equal(buyPriceIsCurrent(43.13, 43.13), true);
  });

  it("catches a card a cent off", () => {
    assert.equal(buyPriceIsCurrent(43.12, 43.13), false);
    assert.equal(buyPriceIsCurrent(null, 80), false);
    assert.equal(buyPriceIsCurrent(0, 80), false);
  });

  it("counts a card with nothing to write as already done", () => {
    assert.equal(buyPriceIsCurrent(null, null), true);
    assert.equal(buyPriceIsCurrent(12, null), true);
  });
});
