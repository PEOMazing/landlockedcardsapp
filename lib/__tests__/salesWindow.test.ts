import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { judgeSales, roundUpDollar } from "../salesWindow";

const NOW = new Date("2026-09-17T00:00:00Z");
const s = (date: string, price: number) => ({ date, price });

// The scan page renders this to explain a price to someone about to say it out
// loud, so it has to agree with the pricing exactly. Same module, same rules.
describe("judgeSales", () => {
  const machamp = judgeSales([
    s("2026-09-10", 74.99), s("2026-09-06", 115), s("2026-09-03", 60.88),
    s("2026-08-22", 118), s("2026-08-21", 118),
  ], NOW);

  it("counts every sale inside the window", () => {
    assert.equal(machamp.filter((j) => j.used).length, 5);
  });

  it("marks the sale the median landed on", () => {
    const m = machamp.filter((j) => j.isMedian);
    assert.equal(m.length, 1);
    assert.equal(m[0].price, 115);
  });

  it("returns newest first", () => {
    assert.deepEqual(machamp.map((j) => j.date), [
      "2026-09-10", "2026-09-06", "2026-09-03", "2026-08-22", "2026-08-21",
    ]);
  });

  it("shows sales that fell out of the window rather than hiding them", () => {
    const j = judgeSales([s("2026-09-10", 100), s("2026-07-01", 50)], NOW);
    assert.equal(j.length, 2);
    assert.equal(j[1].used, false);
    assert.equal(j[1].excluded, "old");
  });

  it("shows a dropped wash trade as an outlier, not as a normal sale", () => {
    const j = judgeSales([s("2026-09-10", 1), s("2026-09-08", 200)], NOW);
    const washed = j.find((x) => x.price === 1)!;
    assert.equal(washed.used, false);
    assert.equal(washed.excluded, "outlier");
    assert.equal(j.find((x) => x.price === 200)!.used, true);
  });

  it("marks nothing as the median on an even count, because it is between two", () => {
    const j = judgeSales([s("2026-09-10", 100), s("2026-09-08", 200)], NOW);
    assert.equal(j.filter((x) => x.isMedian).length, 0);
  });

  it("handles an empty or junk list", () => {
    assert.deepEqual(judgeSales([], NOW), []);
    assert.deepEqual(judgeSales(null as any, NOW), []);
    assert.equal(judgeSales([s("2026-09-10", 0)], NOW).length, 0);
  });
});

// Whole dollars on the sticker. A comp is a number said out loud across a
// table and the cents on it are noise nobody collects.
describe("roundUpDollar", () => {
  it("takes $94.24 to $95", () => {
    assert.equal(roundUpDollar(94.24), 95);
  });

  it("rounds up even when it is barely over", () => {
    assert.equal(roundUpDollar(94.01), 95);
    assert.equal(roundUpDollar(0.5), 1);
  });

  it("leaves a whole dollar where it is", () => {
    assert.equal(roundUpDollar(95), 95);
    assert.equal(roundUpDollar(250), 250);
  });

  it("does not let float dust walk a whole dollar up", () => {
    assert.equal(roundUpDollar(95.0000001), 95);
    assert.equal(roundUpDollar(0.1 + 0.2 + 94.7), 95);
  });

  it("never rounds down, which would ask less than the evidence supports", () => {
    for (const n of [1.01, 12.5, 94.99, 187.84, 245.5]) {
      assert.ok(roundUpDollar(n) >= n, `${n} must not round down`);
    }
  });

  it("leaves nothing and nonsense alone rather than inventing a dollar", () => {
    assert.equal(roundUpDollar(0), 0);
    assert.equal(roundUpDollar(NaN as any), NaN);
  });
});
