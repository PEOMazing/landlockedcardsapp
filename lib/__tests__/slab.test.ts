import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isSlab, SLAB_CONDITIONS } from "../slab";
import { nextFreeSlots } from "../slots";

// lb-v2. A slab has no binder pocket, so it gets no slot and is owed no
// sticker. This existed as two separate opinions - the slot pool's and the
// singles page's - and they disagreed, which is how 37 graded cards took
// pockets 853 to 889, made the binder appear to jump from 852 to 890, and
// parked a permanent "37 labels never printed" on a view that could not show
// a single one of them.

describe("telling a slab from a sleeved card", () => {
  it("knows every graded condition in the table", () => {
    for (const c of ["PSA 10", "PSA 9", "PSA 8", "BGS 9.5", "CGC 10", "CGC 9.5", "Other Graded"]) {
      assert.equal(isSlab(c), true, c);
    }
  });

  it("counts Other as a slab, the way the singles page always has", () => {
    // five of the 37 were entered this way and they really were slabs
    assert.equal(isSlab("Other"), true);
  });

  it("leaves raw grades alone", () => {
    for (const c of ["Raw", "NM", "LP", "MP", "HP", "DM"]) {
      assert.equal(isSlab(c), false, c);
    }
  });

  it("treats a card with no condition as sleeved", () => {
    // a blank condition is an unfinished raw entry, not a slab, and it still
    // needs a pocket to sit in
    assert.equal(isSlab(""), false);
    assert.equal(isSlab(null), false);
    assert.equal(isSlab(undefined), false);
  });

  it("is not fooled by stray whitespace", () => {
    assert.equal(isSlab(" PSA 10 "), true);
  });

  it("does not match on a near miss", () => {
    // deliberately an exact list rather than a substring or regex test: "PSA 10"
    // is a condition, "PSA 10 (qualifier)" is somebody typing in a field that
    // is a select, and silently treating it as graded hides the data problem
    assert.equal(isSlab("PSA"), false);
    assert.equal(isSlab("psa 10"), false);
  });

  it("covers every condition the page splits on", () => {
    // sl-v3. Was pinned at 8, which was the whole list while every slab in the
    // collection was a gem-mint modern card. A real slabs export arrived with
    // PSA 7, 6, 5, 2 and 1, plus CGC 9 and BGS 9, and isSlab said false for all
    // of them - which would have handed a PSA 1 a binder pocket and let the raw
    // TCGplayer rotation price it off NM market.
    //
    // A count is the wrong guard anyway: it fails when the list grows on
    // purpose and passes when two entries are swapped. Assert the shape.
    assert.equal(new Set(SLAB_CONDITIONS).size, SLAB_CONDITIONS.length, "no duplicates");
    for (const g of ["PSA 10", "PSA 1", "CGC 9", "BGS 9", "Other Graded", "Other"]) {
      assert.ok(SLAB_CONDITIONS.includes(g), `${g} is missing`);
    }
  });

  it("knows the whole PSA ladder, not just the top of it", () => {
    // The low grades are where pricing a slab as a raw card goes most wrong: a
    // PSA 1 is a fraction of NM, not a multiple of it.
    for (let n = 1; n <= 10; n++) {
      assert.equal(isSlab(`PSA ${n}`), true, `PSA ${n} should be a slab`);
    }
  });

  it("never calls a raw condition a slab", () => {
    for (const c of ["NM", "LP", "MP", "HP", "DM", "Raw"]) {
      assert.equal(isSlab(c), false, `${c} is not a slab`);
    }
  });
});

describe("the pockets a slab leaves behind", () => {
  it("hands released pockets to the next sleeved cards", () => {
    // the 37 released 853 to 889, which must now be fillable rather than a
    // permanent hole in the middle of the binder
    const taken = new Set<number>();
    for (let s = 1; s <= 852; s++) taken.add(s);
    for (let s = 890; s <= 1134; s++) taken.add(s);
    const next = nextFreeSlots(taken, 3);
    assert.deepEqual(next, [853, 854, 855]);
  });

  it("still goes past the top once the gap is filled", () => {
    const taken = new Set<number>();
    for (let s = 1; s <= 1134; s++) taken.add(s);
    assert.deepEqual(nextFreeSlots(taken, 2), [1135, 1136]);
  });
});
