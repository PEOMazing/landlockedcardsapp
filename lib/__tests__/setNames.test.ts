import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { setNameCandidates, stripCatalogPrefix, stripSetQualifier, subsetSuffix } from "../setNames";

// sn-v1. Every set name in here is one that actually failed to resolve in the
// binder, taken off the image fill pass that filled zero of twenty-four.
describe("set names with the printing written into them", () => {
  it("takes a bracketed print run off", () => {
    assert.equal(stripSetQualifier("Base Set (Unlimited)"), "Base Set");
    assert.equal(stripSetQualifier("Base Set (1st Edition & Shadowless)"), "Base Set");
    assert.equal(stripSetQualifier("Base Set (Shadowless)"), "Base Set");
  });

  it("takes a bracketed language off", () => {
    assert.equal(stripSetQualifier("Base Set (German)"), "Base Set");
    assert.equal(stripSetQualifier("Base Set (Traditional Chinese)"), "Base Set");
  });

  it("takes a bare trailing qualifier off too", () => {
    assert.equal(stripSetQualifier("Base Set Unlimited"), "Base Set");
  });

  it("says so with an empty string when there was nothing to take off", () => {
    // The caller uses this to decide whether a second candidate is worth
    // offering at all, so "nothing changed" has to be distinguishable.
    assert.equal(stripSetQualifier("Crown Zenith"), "");
    assert.equal(stripSetQualifier(""), "");
  });

  it("leaves brackets that belong to the set alone", () => {
    // An allowlist rather than a general strip-the-brackets rule, because
    // plenty of real set names carry brackets of their own and the printing
    // already lives in the Printing and Variant columns.
    assert.equal(stripSetQualifier("Pokemon Futsal Collection (Promo)"), "");
    assert.equal(stripSetQualifier("McDonald's Collection (2021)"), "");
  });
});

describe("a catalog marker on the front of the name", () => {
  it("comes off", () => {
    // setKey already drops a TRAILING "(Japanese)" because that is the shape
    // the older imports used. Collectr writes it on the front and that form
    // was never handled, which is three cards in the binder on its own.
    assert.equal(stripCatalogPrefix("Japanese Ultra Shiny GX"), "Ultra Shiny GX");
    assert.equal(stripCatalogPrefix("Japanese Neo 3"), "Neo 3");
    assert.equal(stripCatalogPrefix("Japanese Fossil"), "Fossil");
  });

  it("does not eat a set that merely starts with a similar word", () => {
    assert.equal(stripCatalogPrefix("Koreanish Legends"), "");
    assert.equal(stripCatalogPrefix("Fossil"), "");
  });
});

describe("subsets you can only see in the collector number", () => {
  it("reads the Galarian Gallery off a GG number", () => {
    // Verified against the live mirror: both Crown Zenith cards in the binder
    // resolve exactly once "Galarian Gallery" is on the end of the set name,
    // and neither resolves without it.
    assert.equal(subsetSuffix("GG40"), "Galarian Gallery");
    assert.equal(subsetSuffix("GG38"), "Galarian Gallery");
  });

  it("reads the other three the same way", () => {
    assert.equal(subsetSuffix("TG23"), "Trainer Gallery");
    assert.equal(subsetSuffix("RC24"), "Radiant Collection");
    assert.equal(subsetSuffix("SV49"), "Shiny Vault");
  });

  it("ignores a plain number", () => {
    assert.equal(subsetSuffix("15"), "");
    assert.equal(subsetSuffix("077/173"), "");
    assert.equal(subsetSuffix(""), "");
  });

  it("reads the prefix off the left of a fraction", () => {
    assert.equal(subsetSuffix("GG40/GG70"), "Galarian Gallery");
  });

  it("does not fire on a letter prefix that is not a subset", () => {
    assert.equal(subsetSuffix("SM162"), "");
    assert.equal(subsetSuffix("DP47"), "");
    assert.equal(subsetSuffix("XY99"), "");
  });
});

describe("the candidates offered to the resolver", () => {
  it("offers the name as written first, always", () => {
    // The ordering guarantee that makes this safe to add: a set that already
    // resolved resolves the same way it always did, and nothing downstream
    // can start picking a different product than it picked yesterday.
    assert.equal(setNameCandidates("Crown Zenith", "GG40")[0], "Crown Zenith");
    assert.equal(setNameCandidates("Base Set (Unlimited)", "15")[0], "Base Set (Unlimited)");
  });

  it("is a single entry for a set that needs nothing", () => {
    // Which matters for the common case: most of the binder resolves, and for
    // those cards this must stay the one upstream call it always was.
    assert.deepEqual(setNameCandidates("Prismatic Evolutions", "131"), ["Prismatic Evolutions"]);
  });

  it("adds the subset form for a GG number", () => {
    const c = setNameCandidates("Crown Zenith", "GG40");
    assert.ok(c.includes("Crown Zenith Galarian Gallery"), c.join(" / "));
    // Both spellings, since the mirror writes it without a colon and
    // TCGplayer's own site writes it with one.
    assert.ok(c.includes("Crown Zenith: Galarian Gallery"), c.join(" / "));
  });

  it("puts the subset guess ahead of the qualifier strip", () => {
    // A GG number inside Crown Zenith is a near-certainty. Dropping
    // "(German)" is a compromise that gets you English art. The certain guess
    // goes first.
    const c = setNameCandidates("Crown Zenith (Unlimited)", "GG40");
    const sub = c.findIndex((x) => x === "Crown Zenith (Unlimited) Galarian Gallery");
    const strip = c.findIndex((x) => x === "Crown Zenith");
    assert.ok(sub >= 0 && strip >= 0);
    assert.ok(sub < strip, c.join(" / "));
  });

  it("strips a qualifier and a catalog prefix together", () => {
    const c = setNameCandidates("Japanese Neo 3 (Unlimited)", "245");
    assert.ok(c.includes("Neo 3"), c.join(" / "));
  });

  it("never repeats a candidate", () => {
    for (const set of ["Base Set (Unlimited)", "Crown Zenith", "Japanese Fossil", "Base Set"]) {
      const c = setNameCandidates(set, "GG40");
      assert.equal(new Set(c.map((x) => x.toLowerCase())).size, c.length, set);
    }
  });

  it("handles the real failures from the binder", () => {
    const cases: [string, string, string][] = [
      ["Base Set (Unlimited)", "15", "Base Set"],
      ["Base Set (1st Edition & Shadowless)", "13", "Base Set"],
      ["Base Set (German)", "42/102", "Base Set"],
      ["Base Set (Traditional Chinese)", "63/102", "Base Set"],
      ["Crown Zenith", "GG40", "Crown Zenith Galarian Gallery"],
      ["Brilliant Stars", "TG23", "Brilliant Stars Trainer Gallery"],
      ["Japanese Ultra Shiny GX", "249", "Ultra Shiny GX"],
      ["Japanese Neo 3", "245", "Neo 3"],
      ["Japanese Fossil", "97", "Fossil"],
    ];
    for (const [set, num, want] of cases) {
      assert.ok(setNameCandidates(set, num).includes(want), `${set} #${num} -> ${want}`);
    }
  });

  it("offers nothing extra for the Japanese era codes, which it cannot fix", () => {
    // M2a, SV8a, ASC, MEG are era codes rather than names and there is no
    // mechanical route from one to the other. Guessing would attach the wrong
    // card, so these stay blank until somebody pastes a TCGplayer link or
    // corrects the set by hand. Said out loud here so the gap is a known
    // limitation rather than a mystery.
    assert.deepEqual(setNameCandidates("M2a", "199"), ["M2a"]);
    assert.deepEqual(setNameCandidates("ASC", "238"), ["ASC"]);
  });
});
