import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { splitByKind } from "./calc";

// The two numbers under the P&L have to add back up to the product value
// printed above them. If they ever disagree, the panel is quietly telling the
// streamer that money went missing, so the total is asserted in every case.

const single = (qty: number, market: number) => ({ qty, market, singleRecId: "recCardAAAAAAAAAA" });
const sealed = (qty: number, market: number) => ({ qty, market });

const total = (lines: any[]) => lines.reduce((a, l) => a + (l.qty || 0) * (l.market || 0), 0);

describe("splitting a set into singles and sealed", () => {
  it("counts a card line as singles and a product line as sealed", () => {
    const lines = [single(1, 12.5), sealed(4, 25)];
    const s = splitByKind(lines);
    assert.deepEqual(s, { singlesValue: 12.5, singlesQty: 1, sealedValue: 100, sealedQty: 4 });
    assert.equal(s.singlesValue + s.sealedValue, total(lines));
  });

  it("adds up to the product value on a mixed set", () => {
    const lines = [single(1, 340), single(1, 12.13), sealed(6, 4.5), sealed(2, 119.99)];
    const s = splitByKind(lines);
    assert.equal(Math.round((s.singlesValue + s.sealedValue) * 100) / 100, total(lines));
    assert.equal(s.singlesQty + s.sealedQty, 10);
  });

  it("multiplies by quantity rather than counting lines", () => {
    // A sealed line holding six packs is six items on the wheel, not one.
    const s = splitByKind([sealed(6, 4.5)]);
    assert.equal(s.sealedQty, 6);
    assert.equal(s.sealedValue, 27);
  });

  it("reads a set with nothing on it as zero rather than blank", () => {
    assert.deepEqual(splitByKind([]), { singlesValue: 0, singlesQty: 0, sealedValue: 0, sealedQty: 0 });
    assert.deepEqual(splitByKind(undefined as any), { singlesValue: 0, singlesQty: 0, sealedValue: 0, sealedQty: 0 });
  });

  it("puts an all-sealed show entirely on one side", () => {
    const s = splitByKind([sealed(12, 5), sealed(1, 200)]);
    assert.equal(s.singlesValue, 0);
    assert.equal(s.singlesQty, 0);
    assert.equal(s.sealedValue, 260);
  });

  it("treats a blank or whitespace card link as sealed", () => {
    // Every line predates the Single Rec Id field, and an empty Airtable cell
    // comes back as "" rather than missing. Those are sealed product, not
    // cards with a lost link.
    assert.equal(splitByKind([{ qty: 1, market: 10, singleRecId: "" }]).sealedValue, 10);
    assert.equal(splitByKind([{ qty: 1, market: 10, singleRecId: "   " }]).sealedValue, 10);
    assert.equal(splitByKind([{ qty: 1, market: 10, singleRecId: null }]).sealedValue, 10);
  });

  it("treats a line with no price as zero value but still counts the item", () => {
    // An unpriced card is a real thing sitting on the wheel; dropping it from
    // the count would make the item totals disagree with the set above.
    const s = splitByKind([{ qty: 1, singleRecId: "recCardAAAAAAAAAA" }]);
    assert.equal(s.singlesQty, 1);
    assert.equal(s.singlesValue, 0);
  });

  it("ignores junk in the numbers instead of printing NaN across the panel", () => {
    const s = splitByKind([{ qty: "two" as any, market: "lots" as any }]);
    assert.equal(s.sealedQty, 0);
    assert.equal(s.sealedValue, 0);
  });
});
