import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { slotAddress, nextFreeSlots, slotFields, slotFieldsFor, pickSlot, clearedSlotFields } from "../slots";
import { slotOrder } from "../labelOrder";

describe("slotAddress", () => {
  it("is the pocket, counted from 1 across everything", () => {
    assert.equal(slotAddress(1), "1");
    assert.equal(slotAddress(412), "412");
    assert.equal(slotAddress(1281), "1281");
  });

  it("names no binder, because binders hold different amounts", () => {
    assert.equal(slotAddress(1000).includes("B"), false);
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
    assert.deepEqual(slotFields(412), { Slot: 412, Location: "412" });
  });

  it("writes nothing at all when there is no pocket, rather than blanking one", () => {
    assert.deepEqual(slotFieldsFor(null), {});
    assert.deepEqual(slotFieldsFor(0), {});
    assert.deepEqual(slotFieldsFor(7), { Slot: 7, Location: "7" });
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

describe("clearedSlotFields", () => {
  it("frees the pocket but remembers which one it was", () => {
    assert.deepEqual(clearedSlotFields(412), { Slot: null, Location: "", "Last Slot": 412 });
  });

  it("remembers nothing about a card that was not in a pocket", () => {
    assert.deepEqual(clearedSlotFields(null), { Slot: null, Location: "" });
    assert.deepEqual(clearedSlotFields(0), { Slot: null, Location: "" });
  });
});

describe("pickSlot", () => {
  it("gives a returning card its own pocket back when it is still empty", () => {
    // 412 sold, so it is not in the taken list; nobody has moved in
    assert.equal(pickSlot([1, 2, 3], 412), 412);
  });

  it("gives it the lowest empty pocket when someone took its old one", () => {
    assert.equal(pickSlot([1, 3, 412], 412), 2);
  });

  it("falls back to the lowest empty pocket when it never had one", () => {
    assert.equal(pickSlot([1, 2, 4], null), 3);
    assert.equal(pickSlot([1, 2, 3], 0), 4);
  });

  it("does not hand back a pocket that is taken just because it was asked for", () => {
    const got = pickSlot([5], 5);
    assert.notEqual(got, 5);
    assert.equal(got, 1);
  });
});
