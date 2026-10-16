import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { basisOf } from "../pricingHealth";
import {
  fallbackCompSource,
  importCompSource,
  listingCompSource,
  soldsCompSource,
} from "../comp";
import { slabComp, slabCompSource } from "../slabComp";

// im-v1 / sl-v1. basisOf reads a comp's provenance back off a string, so every
// builder in lib/comp has to land in the bucket it means and the order of the
// checks has to hold. Both have broken before: the fallback once shipped
// without "est." and its amber warning silently stopped firing.

const rec = (source: string, comp: number | null = 10) =>
  ({ id: "rec1", fields: { Comp: comp, "Comp Source": source } }) as any;

describe("every comp source lands in its own bucket", () => {
  it("an import comp is imported, not an estimate", () => {
    // The bug this marker exists for. 108 CSV-imported cards carried the
    // fallback's own string, so a market price for the right printing AND
    // condition read as "NM market times a guess at the condition".
    const s = importCompSource("2026-10-16", "Holofoil", "Moderately Played");
    assert.equal(basisOf(rec(s)), "imported");
    assert.doesNotMatch(s, /est\./);
  });

  it("an import comp is not mistaken for hand-priced either", () => {
    // Before the marker it fell through to "manual", which claimed somebody
    // had chosen the number.
    assert.notEqual(basisOf(rec(importCompSource("2026-10-16"))), "manual");
  });

  it("the condition estimate is still an estimate", () => {
    assert.equal(basisOf(rec(fallbackCompSource("Holofoil", 0.8, "MP"))), "estimate");
  });

  it("sales and listings are unchanged", () => {
    assert.equal(basisOf(rec(soldsCompSource("NM", 4, "", "Holofoil"))), "solds");
    assert.equal(basisOf(rec(listingCompSource("NM", "Holofoil", 3))), "listing");
  });

  it("a slab comp reads as sales-derived", () => {
    const r = slabComp([
      { date: "2026-10-14", price: 100, title: "t", url: "u", format: "", bestOffer: false },
      { date: "2026-10-12", price: 120, title: "t", url: "u", format: "", bestOffer: false },
    ], new Date("2026-10-16T12:00:00Z"))!;
    assert.equal(basisOf(rec(slabCompSource({ grader: "PSA", grade: "10" }, r))), "solds");
  });

  it("a hand-typed source is still manual", () => {
    assert.equal(basisOf(rec("eBay sold listings, entered by hand")), "manual");
  });

  it("no comp beats every marker", () => {
    assert.equal(basisOf(rec(soldsCompSource("NM", 4), null)), "none");
  });
});

describe("the order of the checks", () => {
  it("a repriced card reads as repriced even if it mentions an import", () => {
    // A reprice overwrites the whole string, so this should not occur in the
    // data. Pinned anyway, because the import check sitting above the solds
    // check would freeze a third of the collection as "imported" forever and
    // the symptom would be a dashboard number rather than a visible break.
    const s = `${soldsCompSource("NM", 4, "", "Holofoil")} at import 2026-10-16`;
    assert.equal(basisOf(rec(s)), "solds");
  });

  it("an import string carrying the word estimate still reads as an estimate", () => {
    // est. is the most serious claim of the three and keeps priority, so a
    // string that somehow has both is classified by the worse one.
    assert.equal(basisOf(rec("est. from TCGplayer market at import 2026-10-16")), "estimate");
  });
});
