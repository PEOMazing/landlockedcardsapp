import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { bucketListings, floorKey, CONDITION_NAMES } from "../tcgListings";

// Real rows pulled from mp-search-api on 2026-09-17 for Leafeon 7/100
// Majestic Dawn (productId 86677), trimmed to the fields we read. This card is
// the reason the module exists: one productId, two printings, and a condition
// spread that a single blended number cannot represent.
const LEAFEON = [
  { price: 23, printing: "Holofoil", condition: "Damaged" },
  { price: 29.95, printing: "Holofoil", condition: "Heavily Played" },
  { price: 28.99, printing: "Reverse Holofoil", condition: "Moderately Played" },
  { price: 47.89, printing: "Holofoil", condition: "Moderately Played" },
  { price: 47.99, printing: "Reverse Holofoil", condition: "Heavily Played" },
  { price: 61.37, printing: "Holofoil", condition: "Lightly Played" },
  { price: 44.99, printing: "Reverse Holofoil", condition: "Lightly Played" },
  { price: 94.24, printing: "Holofoil", condition: "Near Mint" },
  { price: 98.01, printing: "Reverse Holofoil", condition: "Near Mint" },
  // a second, pricier NM Reverse listing: the floor must stay the cheaper one
  { price: 120.0, printing: "Reverse Holofoil", condition: "Near Mint" },
];

describe("bucketListings", () => {
  const m = bucketListings(LEAFEON);

  it("keeps the two printings apart at the same condition", () => {
    assert.equal(m.get(floorKey("Holofoil", "Near Mint"))!.low, 94.24);
    assert.equal(m.get(floorKey("Reverse Holofoil", "Near Mint"))!.low, 98.01);
  });

  it("takes the cheapest listing in a bucket, not the first", () => {
    const nmRev = m.get(floorKey("Reverse Holofoil", "Near Mint"))!;
    assert.equal(nmRev.low, 98.01);
    assert.equal(nmRev.count, 2);
  });

  it("keeps conditions apart within one printing", () => {
    assert.equal(m.get(floorKey("Holofoil", "Lightly Played"))!.low, 61.37);
    assert.equal(m.get(floorKey("Holofoil", "Damaged"))!.low, 23);
  });

  it("does not invent a bucket that had no listings", () => {
    assert.equal(m.get(floorKey("Reverse Holofoil", "Damaged")), undefined);
    assert.equal(m.get(floorKey("Normal", "Near Mint")), undefined);
  });

  it("drops rows with junk prices or missing facets rather than bucketing them at zero", () => {
    const m2 = bucketListings([
      { price: 0, printing: "Holofoil", condition: "Near Mint" },
      { price: -5, printing: "Holofoil", condition: "Near Mint" },
      { price: null, printing: "Holofoil", condition: "Near Mint" },
      { price: 10, printing: "", condition: "Near Mint" },
      { price: 10, printing: "Holofoil", condition: "" },
      { price: 42, printing: "Holofoil", condition: "Near Mint" },
    ]);
    assert.equal(m2.size, 1);
    assert.deepEqual(m2.get(floorKey("Holofoil", "Near Mint")), { low: 42, count: 1 });
  });

  it("survives an empty or malformed response without throwing", () => {
    assert.equal(bucketListings([]).size, 0);
    assert.equal(bucketListings(null as any).size, 0);
  });
});

describe("condition names", () => {
  it("maps our codes to the strings TCGplayer puts on a listing", () => {
    // These exact strings came back on the live rows above, so a typo here
    // would silently return "no listings" for every card in that condition.
    const seen = new Set(LEAFEON.map((r) => r.condition));
    for (const code of ["NM", "LP", "MP", "HP", "DM"]) {
      assert.ok(seen.has(CONDITION_NAMES[code]), `${code} -> ${CONDITION_NAMES[code]} must match a real listing condition`);
    }
  });

  it("treats Raw as Near Mint, since that is how the table stores unspecified", () => {
    assert.equal(CONDITION_NAMES.Raw, CONDITION_NAMES.NM);
  });
});
