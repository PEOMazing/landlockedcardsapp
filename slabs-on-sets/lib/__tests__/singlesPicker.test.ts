import { describe, it } from "node:test";
import assert from "node:assert";
import {
  compAgeDays, matchesKind, needsRecheck, slabCompCold, SLAB_COMP_STALE_DAYS,
} from "../singlesPicker";

const NOW = new Date("2026-10-18T14:00:00Z");
const card = (condition: string, compDate = "") => ({ condition, compDate });

describe("singles picker: splitting raw from graded", () => {
  it("lets everything through on all", () => {
    assert.equal(matchesKind("NM", "all"), true);
    assert.equal(matchesKind("PSA 10", "all"), true);
    assert.equal(matchesKind("", "all"), true);
  });
  it("keeps slabs out of raw and raw out of graded", () => {
    for (const c of ["NM", "LP", "MP", "HP", "DM", "Raw"]) {
      assert.equal(matchesKind(c, "raw"), true, c);
      assert.equal(matchesKind(c, "graded"), false, c);
    }
    for (const c of ["PSA 10", "PSA 1", "BGS 9.5", "CGC 9", "SGC 10", "Other Graded"]) {
      assert.equal(matchesKind(c, "graded"), true, c);
      assert.equal(matchesKind(c, "raw"), false, c);
    }
  });
  it("treats a blank or unknown condition as raw, matching the slot pool", () => {
    // lib/slab is the one list both sides read. A condition it does not know is
    // a sleeved card everywhere else in the app, so it is one here too.
    assert.equal(matchesKind("", "raw"), true);
    assert.equal(matchesKind("PSA 11", "raw"), true);
  });
});

describe("singles picker: comp age", () => {
  it("counts whole days and floors at zero", () => {
    assert.equal(compAgeDays("2026-10-18", NOW), 0);
    assert.equal(compAgeDays("2026-10-17", NOW), 1);
    assert.equal(compAgeDays("2026-09-18", NOW), 30);
    assert.equal(compAgeDays("2026-10-20", NOW), 0); // dated ahead, not negative
  });
  it("reads a full timestamp by its date part", () => {
    assert.equal(compAgeDays("2026-10-16T05:56:17.811Z", NOW), 2);
  });
  it("returns null rather than a number for anything unusable", () => {
    assert.equal(compAgeDays("", NOW), null);
    assert.equal(compAgeDays(null, NOW), null);
    assert.equal(compAgeDays("last Tuesday", NOW), null);
  });
});

describe("singles picker: what the Recheck button may touch", () => {
  it("offers a raw card not priced today", () => {
    assert.equal(needsRecheck(card("NM", "2026-10-17"), NOW), true);
    assert.equal(needsRecheck(card("LP", ""), NOW), true);
  });
  it("leaves a raw card priced today alone", () => {
    assert.equal(needsRecheck(card("NM", "2026-10-18"), NOW), false);
  });
  // The bug this file exists for. /api/singles/comps -> recompSingle returns
  // "graded comps are manual - no free feed covers graded pricing" for every
  // slab, so offering them to the button put a warning on screen that the
  // button could not clear, however many times it was pressed.
  it("NEVER offers a slab, however old its comp", () => {
    assert.equal(needsRecheck(card("PSA 10", "2026-10-18"), NOW), false);
    assert.equal(needsRecheck(card("PSA 10", "2020-01-01"), NOW), false);
    assert.equal(needsRecheck(card("BGS 9.5", ""), NOW), false);
  });
});

describe("singles picker: when a slab's hand-set comp has gone cold", () => {
  it("is fine inside the window", () => {
    assert.equal(slabCompCold(card("PSA 9", "2026-10-18"), NOW), false);
    assert.equal(slabCompCold(card("PSA 9", "2026-09-18"), NOW), false); // exactly 30
  });
  it("is cold past it", () => {
    assert.equal(slabCompCold(card("PSA 9", "2026-09-17"), NOW), true);
    assert.equal(SLAB_COMP_STALE_DAYS, 30);
  });
  it("counts never priced as cold", () => {
    assert.equal(slabCompCold(card("PSA 9", ""), NOW), true);
  });
  it("says nothing about raw cards - that is needsRecheck's job", () => {
    assert.equal(slabCompCold(card("NM", "2020-01-01"), NOW), false);
  });
  it("takes a caller-supplied window", () => {
    assert.equal(slabCompCold(card("PSA 9", "2026-10-11"), NOW, 5), true);
    assert.equal(slabCompCold(card("PSA 9", "2026-10-11"), NOW, 10), false);
  });
});

describe("singles picker: the two rules never both fire on one card", () => {
  it("a card is either raw and recheckable or graded and coldable", () => {
    const cards = [
      card("NM", "2026-10-01"), card("PSA 10", "2026-01-01"),
      card("Raw", ""), card("CGC 9", ""), card("LP", "2026-10-18"),
    ];
    for (const c of cards) {
      assert.ok(!(needsRecheck(c, NOW) && slabCompCold(c, NOW)), JSON.stringify(c));
    }
  });
});
