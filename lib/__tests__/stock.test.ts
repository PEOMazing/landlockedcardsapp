import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { clampStock, takeStock, shortBy } from "../stock";

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

describe("shortBy", () => {
  it("is zero when there is enough on hand", () => {
    assert.equal(shortBy(10, 10), 0);
    assert.equal(shortBy(10, 3), 0);
  });
  it("counts how many units are missing", () => {
    assert.equal(shortBy(0, 270), 270);
    assert.equal(shortBy(2, 5), 3);
  });
  it("treats a negative or missing count as nothing on hand", () => {
    assert.equal(shortBy(-40, 1), 1);
    assert.equal(shortBy(undefined, 2), 2);
  });
});
