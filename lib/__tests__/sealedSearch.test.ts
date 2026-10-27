import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  cleanTcgUrl,
  groupNameScore,
  isSealedProduct,
  parseTcgUrl,
  rankSealedGroups,
  sealedMatches,
  sealedTokens,
  sealedUrlSlug,
  slugifyGroup,
  sortSealedHits,
} from "../tcgMap";

// sl-v1. Sealed product was searchable by pasted link and by nothing else,
// because the only name search in the app drops every product with no
// collector number - which is every box, tin, bundle and blister in the
// mirror. These tests pin the three pieces that replaced that: what counts as
// sealed, which group files are worth opening for a given query, and the fact
// that a search result's rebuilt link resolves back to the set it came from.
//
// Product and group shapes below are the real tcgcsv spellings.
const card = (name: string, number: string, rarity: string) => ({
  productId: 1,
  name,
  imageUrl: "x.jpg",
  extendedData: [
    { name: "Number", value: number },
    { name: "Rarity", value: rarity },
  ],
});

const sealed = (productId: number, name: string) => ({
  productId,
  name,
  imageUrl: `${productId}.jpg`,
  extendedData: [{ name: "Description", value: "Each box contains..." }],
});

describe("telling sealed product from cards", () => {
  it("a card with a number and a rarity is not sealed", () => {
    assert.equal(isSealedProduct(card("Umbreon ex", "161/131", "Special Illustration Rare")), false);
  });

  it("a card with only a number is still not sealed", () => {
    assert.equal(isSealedProduct({ name: "Pikachu", extendedData: [{ name: "Number", value: "25" }] }), false);
  });

  it("a box with neither is sealed", () => {
    assert.equal(isSealedProduct(sealed(1, "Prismatic Evolutions Elite Trainer Box")), true);
  });

  it("code cards are neither, and never wanted", () => {
    assert.equal(isSealedProduct({ name: "Code Card - Prismatic Evolutions", extendedData: [] }), false);
  });

  it("a nameless row is not a product", () => {
    assert.equal(isSealedProduct({ productId: 9, extendedData: [] }), false);
  });
});

describe("reading a sealed query", () => {
  it("drops filler that would make a real query match nothing", () => {
    // "pokemon" appears in no group name and in few product names, so
    // requiring it would turn a good query into zero results.
    assert.deepEqual(sealedTokens("Pokemon Surging Sparks Booster Box").need, ["surging", "sparks", "booster", "box"]);
  });

  it("a dropped word still steers the ranking it no longer gates", () => {
    // "pack" is not required, so a search for a booster pack also surfaces the
    // box and the bundle rather than nothing when TCGplayer named it
    // differently. It stays in the full token list, which is what decides
    // which of the three comes first.
    const t = sealedTokens("Surging Sparks Booster Pack");
    assert.equal(t.need.includes("pack"), false);
    assert.equal(t.all.includes("pack"), true);
  });

  it("keeps filler when filler is all there is", () => {
    assert.deepEqual(sealedTokens("pokemon tcg").need, ["pokemon", "tcg"]);
  });

  it("spells out the ampersand, the way TCGplayer does", () => {
    assert.deepEqual(sealedTokens("Scarlet & Violet ETB").need, ["scarlet", "and", "violet", "etb"]);
  });

  it("an empty query asks for nothing", () => {
    assert.deepEqual(sealedTokens("  ").need, []);
  });
});

describe("scoring group names before opening their files", () => {
  const pe = { groupId: 23821, name: "SV: Prismatic Evolutions" };
  const ss = { groupId: 23537, name: "SV08: Surging Sparks" };

  it("a whole word in the set name is worth more than a substring", () => {
    assert.ok(groupNameScore(pe, ["prismatic", "evolutions"]) > groupNameScore(pe, ["prism"]));
  });

  it("the set the query named outscores the set it did not", () => {
    const need = sealedTokens("Prismatic Evolutions Elite Trainer Box").need;
    assert.ok(groupNameScore(pe, need) > groupNameScore(ss, need));
  });

  it("an abbreviation the user typed counts", () => {
    assert.ok(groupNameScore({ groupId: 1, name: "SV: Shrouded Fable", abbreviation: "SFA" }, ["sfa"]) > 0);
  });

  it("product-type words score nothing, since no set is named after them", () => {
    assert.equal(groupNameScore(pe, ["elite", "trainer", "box"]), 0);
  });
});

describe("choosing which group files to open", () => {
  const pool = [
    { group: { groupId: 23821, name: "SV: Prismatic Evolutions" }, categoryId: 3 },
    { group: { groupId: 23537, name: "SV08: Surging Sparks" }, categoryId: 3 },
    { group: { groupId: 604, name: "Base Set" }, categoryId: 3 },
    { group: { groupId: 23900, name: "ME01: Mega Evolution" }, categoryId: 3 },
    { group: { groupId: 24050, name: "Prismatic Evolutions (Japanese)" }, categoryId: 85 },
    { group: { groupId: 3000, name: "Base Set (Japanese)" }, categoryId: 85 },
  ];

  it("opens the named set first", () => {
    const picked = rankSealedGroups(pool, sealedTokens("Prismatic Evolutions Elite Trainer Box").need, 3);
    assert.equal(picked[0].group.groupId, 23821);
  });

  it("falls back to the newest English sets when the query names no set", () => {
    const picked = rankSealedGroups(pool, ["elite", "trainer", "box"], 3);
    assert.deepEqual(picked.map((p) => p.group.groupId), [23900, 23821, 23537]);
    assert.ok(picked.every((p) => p.categoryId === 3));
  });

  it("does not let a Japanese set outrank its English namesake unasked", () => {
    const picked = rankSealedGroups(pool, ["base", "set", "booster", "box"], 1);
    assert.equal(picked[0].group.groupId, 604);
  });

  it("opens Japanese sets when the query asks for Japanese", () => {
    const picked = rankSealedGroups(pool, sealedTokens("Japanese Base Set Booster Box").need, 2);
    assert.ok(picked.some((p) => p.categoryId === 85));
  });

  it("always opens the junk drawers, whatever set the query named", () => {
    // A Costco or Pokemon Center exclusive names its set in its own name but
    // is filed under Miscellaneous Cards & Products, so scoring alone sends
    // the search to the wrong file and finds nothing.
    const withMisc = [
      ...pool,
      { group: { groupId: 2, name: "Miscellaneous Cards & Products" }, categoryId: 3 },
      { group: { groupId: 1800, name: "Blister Exclusives" }, categoryId: 3 },
    ];
    const picked = rankSealedGroups(withMisc, sealedTokens("Costco Prismatic Evolutions 8-Pack Mini Tins").need, 6);
    const names = picked.map((p) => p.group.name);
    assert.ok(names.includes("SV: Prismatic Evolutions"), "still opens the named set first");
    assert.ok(names.includes("Miscellaneous Cards & Products"), "and the junk drawer it is actually in");
    assert.ok(names.includes("Blister Exclusives"));
  });

  it("keeps the named set even when the junk drawers eat the budget", () => {
    const withMisc = [
      ...pool,
      { group: { groupId: 2, name: "Miscellaneous Cards & Products" }, categoryId: 3 },
      { group: { groupId: 1800, name: "Blister Exclusives" }, categoryId: 3 },
      { group: { groupId: 1801, name: "Deck Exclusives" }, categoryId: 3 },
    ];
    const picked = rankSealedGroups(withMisc, sealedTokens("Prismatic Evolutions Elite Trainer Box").need, 2);
    assert.equal(picked[0].group.groupId, 23821);
    assert.equal(picked.length, 2);
  });

  it("never opens more files than the budget allows", () => {
    assert.equal(rankSealedGroups(pool, ["booster"], 2).length, 2);
  });

  it("backfills without repeating a set it already picked", () => {
    const picked = rankSealedGroups(pool, sealedTokens("Prismatic Evolutions Booster Bundle").need, 6);
    const ids = picked.map((p) => p.group.groupId);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("matching products inside a group", () => {
  const group = { groupId: 23821, name: "SV: Prismatic Evolutions" };
  const prods = [
    card("Umbreon ex", "161/131", "Special Illustration Rare"),
    sealed(601, "Prismatic Evolutions Elite Trainer Box"),
    sealed(602, "Prismatic Evolutions Booster Bundle"),
    sealed(603, "Prismatic Evolutions Super-Premium Collection"),
    { productId: 604, name: "Code Card - Prismatic Evolutions", extendedData: [] },
  ];
  const market = new Map<number, number>([[601, 160.56], [602, 64.0]]);

  it("returns sealed product and no cards", () => {
    const hits = sealedMatches(prods, market, group, 3, sealedTokens("prismatic evolutions"));
    assert.deepEqual(hits.map((h) => h.productId), [601, 602, 603]);
  });

  it("matches on the set name alone, so a bare product type works", () => {
    const hits = sealedMatches(prods, market, group, 3, sealedTokens("elite trainer box"));
    assert.deepEqual(hits.map((h) => h.productId), [601]);
  });

  it("carries today's market price through, and says so when there is none", () => {
    const hits = sealedMatches(prods, market, group, 3, sealedTokens("prismatic evolutions"));
    assert.equal(hits.find((h) => h.productId === 601)!.market, 160.56);
    assert.equal(hits.find((h) => h.productId === 603)!.market, null);
  });

  it("strips the catalog prefix off the set name for display", () => {
    const hits = sealedMatches(prods, market, group, 3, sealedTokens("booster bundle"));
    assert.equal(hits[0].groupName, "Prismatic Evolutions");
  });

  it("does not match a query with a word that is in neither name", () => {
    assert.equal(sealedMatches(prods, market, group, 3, sealedTokens("surging sparks etb")).length, 0);
  });
});

describe("ordering what came back", () => {
  const group = { groupId: 23537, name: "SV08: Surging Sparks" };
  const prods = [sealed(701, "Surging Sparks Booster Bundle"), sealed(702, "Surging Sparks Booster Box")];
  const market = new Map<number, number>([[701, 64.0], [702, 412.5]]);

  it("the box beats the bundle when the query said box", () => {
    const hits = sortSealedHits(sealedMatches(prods, market, group, 3, sealedTokens("Surging Sparks Booster Box")));
    assert.equal(hits[0].productId, 702);
  });

  it("the bundle beats the box when the query said bundle", () => {
    const hits = sortSealedHits(sealedMatches(prods, market, group, 3, sealedTokens("Surging Sparks Booster Bundle")));
    assert.equal(hits[0].productId, 701);
  });

  it("a priced product comes before an unpriced one on an equal name", () => {
    const two = [sealed(801, "Surging Sparks Booster Box"), sealed(802, "Surging Sparks Booster Box")];
    const hits = sortSealedHits(
      sealedMatches(two, new Map([[802, 412.5]]), group, 3, sealedTokens("Surging Sparks Booster Box")),
    );
    assert.equal(hits[0].productId, 802);
  });

  it("prefers the plain name over one with extra words bolted on", () => {
    const two = [
      sealed(901, "Surging Sparks Elite Trainer Box [Pokemon Center Exclusive]"),
      sealed(902, "Surging Sparks Elite Trainer Box"),
    ];
    const hits = sortSealedHits(sealedMatches(two, new Map(), group, 3, sealedTokens("Surging Sparks Elite Trainer Box")));
    assert.equal(hits[0].productId, 902);
  });
});

describe("a search result's link resolves back to its own set", () => {
  // This is the invariant that lets a picked search result go through the same
  // save path as a pasted link: the slug we rebuild has to name the category
  // and prefix the group, or the mapping would land in the wrong set.
  const cases: { groupName: string; productName: string; categoryId: number }[] = [
    { groupName: "SV: Prismatic Evolutions", productName: "Prismatic Evolutions Elite Trainer Box", categoryId: 3 },
    { groupName: "SV: Scarlet & Violet 151", productName: "Scarlet & Violet 151 Ultra-Premium Collection", categoryId: 3 },
    { groupName: "Base Set", productName: "Base Set Booster Box", categoryId: 3 },
    { groupName: "Pokemon Card 151 (Japanese)", productName: "Pokemon Card 151 Booster Box", categoryId: 85 },
  ];

  for (const c of cases) {
    it(`${c.productName} lands in ${c.groupName}`, () => {
      const slug = sealedUrlSlug(c.groupName, c.productName, c.categoryId);
      const url = cleanTcgUrl("", 123456, slug);
      const parsed = parseTcgUrl(url);
      assert.ok(parsed, "rebuilt link must be readable");
      assert.equal(parsed!.productId, 123456);
      assert.equal(parsed!.categoryId, c.categoryId);
      const groupSlug = slugifyGroup(c.groupName);
      assert.ok(
        parsed!.rest === groupSlug || parsed!.rest.startsWith(groupSlug + "-"),
        `${parsed!.rest} must start with ${groupSlug}`,
      );
    });
  }

  it("a Japanese product is not read as English", () => {
    const slug = sealedUrlSlug("Pokemon Card 151 (Japanese)", "Pokemon Card 151 Booster Box", 85);
    assert.equal(parseTcgUrl(cleanTcgUrl("", 1, slug))!.categoryId, 85);
  });
});
