import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { EST_MARKER, fallbackCompSource } from "../comp";
import { setKey, subTypeForVariant, makeCardId, parseCardId, subSlug } from "../tcgcsvCards";

// The 30 set names actually sitting in the Singles table, paired with the
// exact group name tcgcsv publishes. If any of these stop matching, that set's
// cards silently drop out of every price refresh, which is the bug this whole
// change exists to fix - so it gets a test with the real strings in it.
const REAL_SETS: [string, string][] = [
  ["Platinum", "Platinum"],
  ["POP Series 5", "POP Series 5"],
  ["Dark Explorers", "Dark Explorers"],
  ["Nintendo Promos", "Nintendo Promos"],
  ["HeartGold SoulSilver", "HeartGold SoulSilver"],
  ["Diamond and Pearl Promos", "Diamond and Pearl Promos"],
  ["Arceus", "Arceus"],
  ["Rising Rivals", "Rising Rivals"],
  ["Supreme Victors", "Supreme Victors"],
  ["League & Championship Cards", "League & Championship Cards"],
  ["Secret Wonders", "Secret Wonders"],
  ["Majestic Dawn", "Majestic Dawn"],
  ["Legends Awakened", "Legends Awakened"],
  ["Unleashed", "Unleashed"],
  ["Triumphant", "Triumphant"],
  ["Black and White Promos", "Black and White Promos"],
  ["Professor Program Promos", "Professor Program Promos"],
  ["Stormfront", "Stormfront"],
  ["EX Delta Species", "EX Delta Species"],
  ["Undaunted", "Undaunted"],
  ["Emerging Powers", "Emerging Powers"],
  ["POP Series 2", "POP Series 2"],
  ["POP Series 3", "POP Series 3"],
  ["EX Dragon Frontiers", "EX Dragon Frontiers"],
  ["EX Power Keepers", "EX Power Keepers"],
  ["Black and White", "Black and White"],
  ["HGSS Promos", "HGSS Promos"],
  ["EX Crystal Guardians", "EX Crystal Guardians"],
  ["Diamond and Pearl", "Diamond and Pearl"],
  ["Paldean Fates", "SV: Paldean Fates"],
];

describe("setKey", () => {
  for (const [ours, theirs] of REAL_SETS) {
    it(`matches ${ours} to ${theirs}`, () => {
      assert.equal(setKey(ours), setKey(theirs));
    });
  }

  it("does not collapse genuinely different sets", () => {
    assert.notEqual(setKey("Diamond and Pearl"), setKey("Diamond and Pearl Promos"));
    assert.notEqual(setKey("Black and White"), setKey("Black and White Promos"));
    assert.notEqual(setKey("POP Series 2"), setKey("POP Series 3"));
  });

  it("treats & and 'and' as the same word", () => {
    assert.equal(setKey("League & Championship Cards"), setKey("League and Championship Cards"));
  });

  it("ignores a leading era code", () => {
    assert.equal(setKey("SV: Paldean Fates"), setKey("Paldean Fates"));
    assert.equal(setKey("SWSH: Shining Fates"), setKey("Shining Fates"));
  });
});

describe("subTypeForVariant", () => {
  it("reads the printing off the Variant column", () => {
    assert.equal(subTypeForVariant("Reverse", "Holo Rare"), "Reverse Holofoil");
    assert.equal(subTypeForVariant("Holo", "Holo Rare"), "Holofoil");
    assert.equal(subTypeForVariant("1st Edition", "Rare"), "1st Edition Holofoil");
  });

  it("falls back to rarity when the variant is blank", () => {
    // Charizard G Lv.X came in with no Variant but an Ultra Rare rarity, and
    // its only printing on TCGplayer is Holofoil
    assert.equal(subTypeForVariant("", "Ultra Rare"), "Holofoil");
    assert.equal(subTypeForVariant("", "Holo Rare"), "Holofoil");
    assert.equal(subTypeForVariant("", "Common"), "Normal");
  });

  it("keeps Reverse and Holo apart", () => {
    // The whole reason the Leafeon comp was wrong: one productId, two prices
    assert.notEqual(subTypeForVariant("Reverse", "Holo Rare"), subTypeForVariant("Holo", "Holo Rare"));
  });
});

describe("card ids", () => {
  it("round-trips a subtype", () => {
    const id = makeCardId(86677, 1390, "Reverse Holofoil");
    assert.equal(id, "tcg:86677:1390:reverse-holofoil");
    const p = parseCardId(id);
    assert.deepEqual(p, { productId: 86677, groupId: 1390, sub: "reverse-holofoil" });
  });

  it("still parses the old three-part ids already stored in Airtable", () => {
    assert.deepEqual(parseCardId("tcg:84201:1384"), { productId: 84201, groupId: 1384, sub: "" });
  });

  it("omits the subtype when there is none, so ids stay stable", () => {
    assert.equal(makeCardId(123, 456), "tcg:123:456");
    assert.equal(makeCardId(123, 456, ""), "tcg:123:456");
  });

  it("rejects junk rather than half-parsing it", () => {
    assert.equal(parseCardId(""), null);
    assert.equal(parseCardId("xy-1-25"), null);
    assert.equal(parseCardId("tcg:abc:1390"), null);
  });

  it("slugs subtypes the same way on both sides of a comparison", () => {
    assert.equal(subSlug("Reverse Holofoil"), subSlug("reverse holofoil"));
    assert.equal(subSlug("1st Edition Holofoil"), "1st-edition-holofoil");
  });
});

describe("fallback comp labelling", () => {
  // A comp derived from market rather than real sales is a guess, and the
  // singles table only warns about it when the source string says "est.".
  // These two facts live in different files, so the link gets a test.
  it("always marks a market-derived comp as an estimate", () => {
    for (const [mult, cond] of [[1, "NM"], [0.9, "LP"], [0.8, "MP"], [0.65, "HP"], [0.5, "DM"]] as [number, string][]) {
      assert.ok(
        fallbackCompSource("Holofoil", mult, cond).includes(EST_MARKER),
        `${cond} fallback must be flagged as an estimate`
      );
    }
  });

  it("names the printing and the discount it applied", () => {
    const s = fallbackCompSource("Reverse Holofoil", 0.9, "LP");
    assert.ok(s.includes("Reverse Holofoil"), s);
    assert.ok(s.includes("0.9"), s);
    assert.ok(s.includes("LP"), s);
  });

  it("does not claim a discount when none was applied", () => {
    assert.equal(fallbackCompSource("Holofoil", 1, "NM").includes("x1"), false);
  });
});
