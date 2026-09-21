import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { clampStock, takeStock } from "../stock";

describe("stock never goes negative", () => {
  it("takes stock off normally when there is enough", () => {
    assert.equal(takeStock(10, 3), 7);
    assert.equal(takeStock(3, 3), 0);
  });
  it("bottoms out at zero when a show pulls more than the app knew about", () => {
    assert.equal(takeStock(0, 270), 0);
    assert.equal(takeStock(5, 8), 0);
  });
  it("treats a missing count as zero", () => {
    assert.equal(takeStock(undefined, 1), 0);
    assert.equal(clampStock(undefined), 0);
    assert.equal(clampStock(null), 0);
  });
  it("clamps a typed-in negative and keeps whole units", () => {
    assert.equal(clampStock(-4), 0);
    assert.equal(clampStock("12"), 12);
    assert.equal(clampStock(2.7), 2);
  });
});
