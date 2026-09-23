import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { slotAddress, nextFreeSlots, slotFields, slotFieldsFor, POCKETS_PER_PAGE, SLOTS_PER_BINDER } from "../slots";

describe("slotAddress", () => {
  it("puts the first pocket on page 1 of binder 1", () => {
    assert.equal(slotAddress(1), "B1-P1-1");
  });

  it("fills a page before starting the next", () => {
    assert.equal(slotAddress(POCKETS_PER_PAGE), "B1-P1-16");
    assert.equal(slotAddress(POCKETS_PER_PAGE + 1), "B1-P2-1");
  });

  it("reads 412 as page 26 pocket 12", () => {
    assert.equal(slotAddress(412), "B1-P26-12");
  });

  it("fills a binder before starting the next", () => {
    assert.equal(slotAddress(SLOTS_PER_BINDER), "B1-P80-16");
    assert.equal(slotAddress(SLOTS_PER_BINDER + 1), "B2-P1-1");
  });

  it("has nothing to say about a card that is not in a binder", () => {
    assert.equal(slotAddress(null), "");
    assert.equal(slotAddress(0), "");
    assert.equal(slotAddress(undefined), "");
  });
});

describe("nextFreeSlots", () => {
  it("starts at 1 when the binder is empty", () => {
    assert.deepEqual(nextFreeSlots([], 3), [1, 2, 3]);
  });

  it("takes the gap a sold card left before adding to the end", () => {
    // 1 through 5 filed, then 3 sells
    assert.deepEqual(nextFreeSlots([1, 2, 4, 5], 2), [3, 6]);
  });

  it("works through several gaps in order, low first", () => {
    assert.deepEqual(nextFreeSlots([2, 5], 4), [1, 3, 4, 6]);
  });

  it("ignores blanks and junk in the pool", () => {
    assert.deepEqual(nextFreeSlots([1, null, undefined, 0, -4, 2], 1), [3]);
  });

  it("never hands out the same pocket twice in one batch", () => {
    const got = nextFreeSlots([1, 3], 5);
    assert.equal(new Set(got).size, got.length);
    assert.deepEqual(got, [2, 4, 5, 6, 7]);
  });

  it("asked for none, hands out none", () => {
    assert.deepEqual(nextFreeSlots([1, 2], 0), []);
  });
});

describe("slotFields", () => {
  it("writes the number and the address together", () => {
    assert.deepEqual(slotFields(412), { Slot: 412, Location: "B1-P26-12" });
  });

  it("writes nothing at all when there is no pocket, rather than blanking one", () => {
    assert.deepEqual(slotFieldsFor(null), {});
    assert.deepEqual(slotFieldsFor(0), {});
    assert.deepEqual(slotFieldsFor(7), { Slot: 7, Location: "B1-P1-7" });
  });
});
