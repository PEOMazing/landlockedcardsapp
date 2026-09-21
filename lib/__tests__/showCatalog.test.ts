import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { groupCards, formatNos, matchesQuery, sortGroups, formatPrice, displayName, isGraded, type ShowCard } from "../showCatalog";

const C = (o: Partial<ShowCard> & { id: string }): ShowCard => ({
  no: null, name: "Card", set: "Set", num: "1/100", cond: "NM", variant: "", price: 1, img: "", qty: 1, lang: "", ...o,
});

describe("groupCards", () => {
  it("collapses identical copies into one tile with every sticker number", () => {
    const g = groupCards([
      C({ id: "a", no: 581, name: "Charmander" }),
      C({ id: "b", no: 579, name: "Charmander" }),
      C({ id: "c", no: 580, name: "Charmander" }),
    ]);
    assert.equal(g.length, 1);
    assert.equal(g[0].count, 3);
    assert.deepEqual(g[0].nos, [579, 580, 581]);
    assert.equal(g[0].first.id, "b"); // opens the lowest-numbered copy
  });
  it("keeps copies apart when condition or price differs", () => {
    const g = groupCards([
      C({ id: "a", no: 1, name: "Eevee", cond: "NM" }),
      C({ id: "b", no: 2, name: "Eevee", cond: "LP" }),
      C({ id: "c", no: 3, name: "Eevee", cond: "NM", price: 5 }),
    ]);
    assert.equal(g.length, 3);
  });
  it("counts every copy on a multi-copy record", () => {
    const g = groupCards([C({ id: "a", no: 10, name: "Pikachu", qty: 3 }), C({ id: "b", no: 11, name: "Pikachu" })]);
    assert.equal(g[0].count, 4);
    assert.deepEqual(g[0].nos, [10, 11]);
  });
  it("keeps a Japanese copy apart from an English one", () => {
    const g = groupCards([C({ id: "a", name: "Mew" }), C({ id: "b", name: "Mew", lang: "Japanese" })]);
    assert.equal(g.length, 2);
  });
  it("keeps same-name cards from different sets apart", () => {
    const g = groupCards([C({ id: "a", name: "Raticate", set: "Secret Wonders" }), C({ id: "b", name: "Raticate", set: "Boundaries Crossed" })]);
    assert.equal(g.length, 2);
  });
});

describe("formatNos", () => {
  it("collapses a run into a range", () => {
    assert.equal(formatNos([579, 580, 581, 582]), "0579-0582");
  });
  it("lists two neighbours plainly rather than as a range", () => {
    assert.equal(formatNos([614, 615]), "0614, 0615");
  });
  it("mixes singles and runs", () => {
    assert.equal(formatNos([5, 7, 8, 9]), "0005, 0007-0009");
  });
  it("shortens a long scattered list", () => {
    assert.equal(formatNos([1, 3, 5, 7, 9]), "0001, 0003, 0005 +2 more");
  });
  it("is empty with no numbers", () => {
    assert.equal(formatNos([]), "");
  });
});

describe("matchesQuery", () => {
  const [um] = groupCards([C({ id: "a", no: 161, name: "Umbreon ex", set: "Prismatic Evolutions", num: "161/131" })]);
  const [ch] = groupCards([C({ id: "b", no: 579, name: "Charmander", set: "Obsidian Flames" }), C({ id: "c", no: 580, name: "Charmander", set: "Obsidian Flames" })]);
  it("matches every word, in any order, ignoring case", () => {
    assert.equal(matchesQuery(um, "umbreon prismatic"), true);
    assert.equal(matchesQuery(um, "PRISMATIC umbreon"), true);
    assert.equal(matchesQuery(um, "umbreon obsidian"), false);
  });
  it("finds a card by its set alone", () => {
    assert.equal(matchesQuery(ch, "obsidian flames"), true);
  });
  it("finds any copy by sticker number, with or without padding or #", () => {
    assert.equal(matchesQuery(ch, "580"), true);
    assert.equal(matchesQuery(ch, "0580"), true);
    assert.equal(matchesQuery(ch, "#579"), true);
  });
  it("still matches the number printed on the card", () => {
    assert.equal(matchesQuery(um, "161/131"), true);
  });
  it("matches everything when empty", () => {
    assert.equal(matchesQuery(um, "  "), true);
  });
});

describe("sortGroups", () => {
  const gs = groupCards([
    C({ id: "a", no: 3, name: "Zebstrika", price: 1 }),
    C({ id: "b", no: 1, name: "Arceus", price: 50 }),
    C({ id: "c", no: 2, name: "Mew", price: null }),
  ]);
  const names = (x: typeof gs) => x.map((g) => g.first.name);
  it("sorts A to Z", () => assert.deepEqual(names(sortGroups(gs, "az")), ["Arceus", "Mew", "Zebstrika"]));
  it("sorts dearest first with unpriced last", () => assert.deepEqual(names(sortGroups(gs, "priceDesc")), ["Arceus", "Zebstrika", "Mew"]));
  it("sorts cheapest first with unpriced last", () => assert.deepEqual(names(sortGroups(gs, "priceAsc")), ["Zebstrika", "Arceus", "Mew"]));
  it("sorts by sticker number", () => assert.deepEqual(names(sortGroups(gs, "no")), ["Arceus", "Mew", "Zebstrika"]));
});

describe("formatting", () => {
  it("shows whole dollars without cents and asks when unpriced", () => {
    assert.equal(formatPrice(37), "$37");
    assert.equal(formatPrice(1250), "$1,250");
    assert.equal(formatPrice(2.5), "$2.50");
    assert.equal(formatPrice(null), "Ask");
  });
  it("drops the printed number out of a name", () => {
    assert.equal(displayName("Charmander - 020/217 (Cosmos Holo)"), "Charmander (Cosmos Holo)");
    assert.equal(displayName("Eevee - 84/108 (City Championships)"), "Eevee (City Championships)");
    assert.equal(displayName("Arceus - DP50"), "Arceus - DP50");
    assert.equal(displayName("Umbreon ex"), "Umbreon ex");
  });
  it("recognises graded slabs", () => {
    assert.equal(isGraded("PSA 10"), true);
    assert.equal(isGraded("CGC 9.5"), true);
    assert.equal(isGraded("NM"), false);
  });
});
