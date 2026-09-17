import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { judgeSales } from "../salesWindow";

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
