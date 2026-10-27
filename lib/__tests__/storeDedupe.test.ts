import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  STORE_FAN_IN_MAX,
  alreadyBooked,
  buildBookedIndex,
  fanInViolation,
  noteBooked,
  duplicateStoreLines,
  storeFingerprint,
} from "../storeSales";
import { retryDelayMs } from "../airtable";

// sd-v1. A real accident on the 2026-10-22 surprise set show: 134 shelf sales
// of 134 different listings were booked against one Ultra Premium Collection,
// $225.24 of product cost each, on a show that took $3,492.94. Deleting them
// did not stick - 598 of these lines have been deleted off that one stream -
// because none carried a Whatnot order id, the dedupe guard reads order ids
// only, and so every re-apply of the report booked the whole set again.
//
// These tests pin both halves: a repeat is recognised without an order id,
// and a batch that funnels into one product is refused before it writes.

const line = (productId: string, qty: number, soldPrice: number, orderId?: string) => ({
  fields: {
    "Product": [productId],
    "Qty": qty,
    "Sold Price": soldPrice,
    ...(orderId ? { "Whatnot Order Id": orderId } : {}),
  },
});

describe("recognising a store sale already booked", () => {
  it("skips a row whose order id is already on the stream", () => {
    const index = buildBookedIndex([line("recA", 1, 15.99, "1467791388")]);
    assert.equal(alreadyBooked(index, { productId: "recB", units: 2, soldPrice: 4.99, orderId: "1467791388" }), true);
  });

  it("skips a repeat of a line that has NO order id, which is the bug", () => {
    const index = buildBookedIndex([line("recA", 1, 15.99)]);
    assert.equal(alreadyBooked(index, { productId: "recA", units: 1, soldPrice: 15.99, orderId: "1467791388" }), true);
  });

  it("books a genuinely different sale of the same product", () => {
    const index = buildBookedIndex([line("recA", 1, 15.99)]);
    assert.equal(alreadyBooked(index, { productId: "recA", units: 1, soldPrice: 17.99 }), false);
  });

  it("two identical real sales absorb two rows and no more", () => {
    // Two buyers each took one pack at $15.99. Both are real, so a report
    // holding three of them must book the third.
    const index = buildBookedIndex([line("recA", 1, 15.99), line("recA", 1, 15.99)]);
    assert.equal(alreadyBooked(index, { productId: "recA", units: 1, soldPrice: 15.99 }), true);
    assert.equal(alreadyBooked(index, { productId: "recA", units: 1, soldPrice: 15.99 }), true);
    assert.equal(alreadyBooked(index, { productId: "recA", units: 1, soldPrice: 15.99 }), false);
  });

  it("units are part of what makes two sales the same", () => {
    const index = buildBookedIndex([line("recA", 6, 15.99)]);
    assert.equal(alreadyBooked(index, { productId: "recA", units: 1, soldPrice: 15.99 }), false);
  });

  it("a line with no product cannot absorb anything", () => {
    const index = buildBookedIndex([{ fields: { "Qty": 1, "Sold Price": 15.99 } }]);
    assert.equal(alreadyBooked(index, { productId: "recA", units: 1, soldPrice: 15.99 }), false);
  });

  it("the same batch cannot book one row twice", () => {
    const index = buildBookedIndex([]);
    const row = { productId: "recA", units: 1, soldPrice: 15.99, orderId: "1467791388" };
    assert.equal(alreadyBooked(index, row), false);
    noteBooked(index, row);
    assert.equal(alreadyBooked(index, row), true);
  });

  it("re-applying the whole report books nothing the second time", () => {
    const rows = [
      { productId: "recA", units: 1, soldPrice: 15.99, orderId: "1" },
      { productId: "recA", units: 1, soldPrice: 15.99, orderId: "2" },
      { productId: "recB", units: 5, soldPrice: 4.99, orderId: "3" },
    ];
    const first = buildBookedIndex([]);
    const booked = rows.filter((r) => !alreadyBooked(first, r));
    for (const r of booked) noteBooked(first, r);
    assert.equal(booked.length, 3);

    // Second apply, against lines that were written WITHOUT order ids.
    const stored = booked.map((r) => line(r.productId, r.units, r.soldPrice));
    const second = buildBookedIndex(stored);
    assert.equal(rows.filter((r) => !alreadyBooked(second, r)).length, 0);
  });

  it("prices that differ by a cent are different sales", () => {
    assert.notEqual(storeFingerprint("recA", 1, 15.99), storeFingerprint("recA", 1, 16.0));
  });
});

describe("refusing a batch that funnels into one product", () => {
  const rows = (productId: string, n: number) => Array.from({ length: n }, () => ({ productId }));

  it("catches the real accident", () => {
    const fan = fanInViolation(rows("recIJL2rvjVhaZcMx", 134));
    assert.equal(fan?.rows, 134);
    assert.equal(fan?.productId, "recIJL2rvjVhaZcMx");
  });

  it("lets a normal upload through", () => {
    const mixed = [...rows("recA", 12), ...rows("recB", 8), ...rows("recC", 20)];
    assert.equal(fanInViolation(mixed), null);
  });

  it("allows exactly the maximum", () => {
    assert.equal(fanInViolation(rows("recA", STORE_FAN_IN_MAX)), null);
    assert.notEqual(fanInViolation(rows("recA", STORE_FAN_IN_MAX + 1)), null);
  });

  it("names the worst offender when several are over", () => {
    const both = [...rows("recA", 30), ...rows("recB", 60)];
    assert.equal(fanInViolation(both)?.productId, "recB");
  });

  it("ignores rows with no product rather than counting them together", () => {
    assert.equal(fanInViolation(rows("", 200)), null);
  });
});

describe("picking out a mass mis-booking", () => {
  const store = (id: string, productId: string, orderId?: string, hit = 0) => ({
    id,
    fields: {
      "Is Store Purchase": true,
      "Product": [productId],
      "Qty": 1,
      "Qty Hit": hit,
      "Sold Price": 15.99,
      ...(orderId ? { "Whatnot Order Id": orderId } : {}),
    },
  });
  const many = (productId: string, n: number, orderId?: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => store(`rec${productId}${i}`, productId, orderId?.(i)));

  it("finds the 134 and nothing else on that show", () => {
    const lines = [
      ...many("recUPC", 134),
      store("recReal1", "recGem", "1467791388"),
      store("recReal2", "recGlory", "1467792121"),
    ];
    const dupes = duplicateStoreLines(lines);
    assert.equal(dupes.length, 134);
    assert.ok(dupes.every((l) => l.fields["Product"][0] === "recUPC"));
  });

  it("leaves a handful of hand-entered store sales alone", () => {
    // No order id, same product, but nowhere near a mis-booking in size.
    assert.equal(duplicateStoreLines(many("recUPC", 3)).length, 0);
  });

  it("will not touch lines that carry order ids, however many there are", () => {
    assert.equal(duplicateStoreLines(many("recGem", 100, (i) => `order${i}`)).length, 0);
  });

  it("ignores lines that are not store purchases", () => {
    const setLines = many("recUPC", 50).map((l) => ({ ...l, fields: { ...l.fields, "Is Store Purchase": false } }));
    assert.equal(duplicateStoreLines(setLines).length, 0);
  });

  it("separates two mis-bookings on different products", () => {
    const dupes = duplicateStoreLines([...many("recUPC", 40), ...many("recETB", 30)]);
    assert.equal(dupes.length, 70);
  });

  it("counts only the hit units as stock to put back", () => {
    const lines = [...many("recUPC", 30), store("recUPCx", "recUPC", undefined, 1)];
    const dupes = duplicateStoreLines(lines);
    assert.equal(dupes.reduce((s, l) => s + (Number(l.fields["Qty Hit"]) || 0), 0), 1);
  });
});

describe("backing off a rate limit", () => {
  it("honours a sane Retry-After", () => {
    assert.equal(retryDelayMs(0, "2"), 2000);
  });

  it("ignores an absurd Retry-After rather than sleeping for an hour", () => {
    assert.ok(retryDelayMs(0, "3600") < 2000);
  });

  it("grows with each attempt", () => {
    // Jittered, so compare the floors rather than exact values.
    assert.ok(retryDelayMs(3) > retryDelayMs(0));
  });

  it("never returns zero, which would be a tight retry loop", () => {
    for (let i = 0; i < 5; i++) assert.ok(retryDelayMs(i) > 0);
  });
});
