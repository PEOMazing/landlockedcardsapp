import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { slotAddress, slotPagePocket, nextFreeSlots, slotFields, slotFieldsFor, POCKETS_PER_PAGE, SLOTS_PER_BINDER } from "../slots";
import { slotOrder } from "../labelOrder";

describe("slotAddress", () => {
  it("is the binder and the pocket, counted straight through", () => {
    assert.equal(slotAddress(1), "B1-1");
    assert.equal(slotAddress(412), "B1-412");
  });

  it("starts a second binder once the first is full", () => {
    assert.equal(slotAddress(SLOTS_PER_BINDER), "B1-1280");
    assert.equal(slotAddress(SLOTS_PER_BINDER + 1), "B2-1281");
  });

  it("has nothing to say about a card that is not in a binder", () => {
    assert.equal(slotAddress(null), "");
    assert.equal(slotAddress(0), "");
    assert.equal(slotAddress(undefined), "");
  });
});

describe("slotPagePocket", () => {
  it("turns the pocket into somewhere to put your thumb", () => {
    assert.equal(slotPagePocket(1), "page 1, pocket 1");
    assert.equal(slotPagePocket(POCKETS_PER_PAGE), "page 1, pocket 16");
    assert.equal(slotPagePocket(POCKETS_PER_PAGE + 1), "page 2, pocket 1");
    assert.equal(slotPagePocket(412), "page 26, pocket 12");
  });

  it("counts pages from the front of each binder", () => {
    assert.equal(slotPagePocket(SLOTS_PER_BINDER), "page 80, pocket 16");
    assert.equal(slotPagePocket(SLOTS_PER_BINDER + 1), "page 1, pocket 1");
  });

  it("says nothing for a card with no pocket", () => {
    assert.equal(slotPagePocket(0), "");
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
    assert.deepEqual(slotFields(412), { Slot: 412, Location: "B1-412" });
  });

  it("writes nothing at all when there is no pocket, rather than blanking one", () => {
    assert.deepEqual(slotFieldsFor(null), {});
    assert.deepEqual(slotFieldsFor(0), {});
    assert.deepEqual(slotFieldsFor(7), { Slot: 7, Location: "B1-7" });
  });
});

describe("slotOrder", () => {
  it("prints in the order the binder fills", () => {
    const got = slotOrder([{ slot: 12 }, { slot: 1 }, { slot: 7 }]);
    assert.deepEqual(got.map((x) => x.slot), [1, 7, 12]);
  });

  it("leaves a card with no pocket to the end of the run", () => {
    const got = slotOrder([{ slot: null }, { slot: 3 }, { slot: 0 }, { slot: 1 }]);
    assert.deepEqual(got.map((x) => x.slot), [1, 3, null, 0]);
  });

  it("does not disturb the list it was handed", () => {
    const list = [{ slot: 2 }, { slot: 1 }];
    slotOrder(list);
    assert.deepEqual(list.map((x) => x.slot), [2, 1]);
  });
});
