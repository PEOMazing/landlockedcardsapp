import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  GRADE_LOOKUP_FLOOR, PSA_GRADES, cardFromParams, foldNumber, gradedParams,
  gradedQuery, latestByGrade, printingKind, saleMatches, upside, wantsGradedSales,
  worthGradedLookup, type CardLike,
} from "../gradedSales";
import { isSlab } from "../slab";

// gs-v1. "This raw card is $20, what did a PSA 10 of it last sell for."
//
// The hard part is not the request, it is that eBay titles are typed by hand.
// Most of these tests are about refusing the wrong card without also refusing
// every honest listing, which is the failure that makes a panel like this
// useless: too strict and every column reads "no sales", too loose and it
// quotes you a reprint.

const card = (over: Partial<CardLike> = {}): CardLike => ({
  name: "Charizard", setName: "Base Set", number: "4/102", language: "English", ...over,
});

const sale = (over: any = {}) => ({
  title: "Pokemon Charizard Base Set PSA 10", price: 420, last_sold: "2026-10-11T14:02:00Z",
  url: "https://ebay.com/itm/1", format: "FIXED_PRICE", best_offer: false,
  card: { graded: true, grader: "PSA", grade: "10", card_number: "4/102" },
  ...over,
});

describe("the search words", () => {
  it("is the card and the set, and deliberately not the number", () => {
    // sellers mostly do not type the collector number, so including it would
    // throw away nearly every real sale
    assert.equal(gradedQuery(card()), "Charizard Base Set");
  });

  it("drops our own name bookkeeping", () => {
    assert.equal(
      gradedQuery({ name: "Charmander - 004/165 (Cosmos Holo)", setName: "Obsidian Flames" }),
      "Charmander Obsidian Flames",
    );
    assert.equal(gradedQuery({ name: "Moltres (Cosmos Holo)", setName: "Misc" }), "Moltres Misc");
  });

  it("drops the set code nobody lists under", () => {
    assert.equal(gradedQuery({ name: "Giratina V", setName: "SWSH11: Lost Origin" }), "Giratina V Lost Origin");
    assert.equal(gradedQuery({ name: "Pikachu", setName: "SV: Scarlet & Violet 151" }), "Pikachu Scarlet & Violet 151");
  });

  it("keeps a name suffix that is part of the card", () => {
    // "LV.X" and "ex" are printed on the card and sellers do type them
    assert.equal(gradedQuery({ name: "Leafeon LV.X", setName: "Majestic Dawn" }), "Leafeon LV.X Majestic Dawn");
  });

  it("survives a card with no set", () => {
    assert.equal(gradedQuery({ name: "Pikachu" }), "Pikachu");
  });
});

describe("the request", () => {
  it("asks for PSA slabs across all five grades in one call", () => {
    const p = gradedParams(card());
    assert.equal(p.grader, "PSA");
    assert.equal(p.grade, "10,9,8,7,6");
    assert.equal(p.graded, "true");
    assert.equal(p.cards, "1");
    assert.equal(p.exclude, "junk", "lots and sealed are wrong numbers, not weak ones");
  });

  it("leaves English unset, because setting it drops untitled languages", () => {
    assert.equal(gradedParams(card({ language: "English" })).lang, undefined);
  });

  it("names a language that is not English", () => {
    assert.equal(gradedParams(card({ language: "Japanese" })).lang, "ja");
  });

  it("asks for first edition only when the card is one", () => {
    assert.equal(gradedParams(card({ printing: "1st Edition" })).first_edition, "true");
    assert.equal(gradedParams(card({ printing: "Unlimited" })).first_edition, undefined);
    assert.equal(gradedParams(card()).first_edition, undefined);
  });
});

describe("collector numbers across a hand-typed title", () => {
  it("reads leading zeros as the same card", () => {
    assert.equal(foldNumber("004/102"), "4/102");
    assert.equal(foldNumber("4/102"), "4/102");
    assert.equal(foldNumber(" 004 / 0102 "), "4/102");
  });

  it("keeps a promo number as written", () => {
    assert.equal(foldNumber("SVP 170"), "SVP170");
    assert.equal(foldNumber("SM20"), "SM20");
  });

  it("is blank for nothing", () => {
    assert.equal(foldNumber(""), "");
    assert.equal(foldNumber(null), "");
  });
});

describe("deciding a sale is really this card", () => {
  it("takes a PSA slab in a wanted grade", () => {
    assert.equal(saleMatches(sale(), card()), true);
  });

  it("takes a listing whose title never mentioned a number", () => {
    // this is most honest listings, so refusing them empties the panel
    assert.equal(saleMatches(sale({ card: { graded: true, grader: "PSA", grade: "9", card_number: null } }), card()), true);
  });

  it("refuses a different card in the same set", () => {
    assert.equal(saleMatches(sale({ card: { graded: true, grader: "PSA", grade: "10", card_number: "11/102" } }), card()), false);
  });

  it("matches across a leading zero", () => {
    assert.equal(saleMatches(sale({ card: { graded: true, grader: "PSA", grade: "10", card_number: "004/102" } }), card()), true);
  });

  it("refuses another grader", () => {
    // a CGC 10 is not a PSA 10 and the two do not trade at the same money
    assert.equal(saleMatches(sale({ card: { graded: true, grader: "CGC", grade: "10" } }), card()), false);
  });

  it("refuses a grade outside the five", () => {
    for (const g of ["5", "1", "9.5"]) {
      assert.equal(saleMatches(sale({ card: { graded: true, grader: "PSA", grade: g } }), card()), false, g);
    }
  });

  it("refuses a raw sale", () => {
    assert.equal(saleMatches(sale({ card: { graded: false, grader: "PSA", grade: "10" } }), card()), false);
  });

  it("refuses a sale the feed could not read a grade off", () => {
    assert.equal(saleMatches(sale({ card: { graded: true, grader: "PSA", grade: null } }), card()), false);
  });

  it("refuses a sale with no price or no date", () => {
    assert.equal(saleMatches(sale({ price: 0 }), card()), false);
    assert.equal(saleMatches(sale({ last_sold: null }), card()), false);
  });

  it("refuses junk with no card object at all", () => {
    assert.equal(saleMatches({ price: 10, last_sold: "2026-10-01" }, card()), false);
    assert.equal(saleMatches(null, card()), false);
  });
});

describe("one column per grade", () => {
  it("takes the newest sale in each grade, not the first in the page", () => {
    const rows = latestByGrade([
      sale({ price: 300, last_sold: "2026-09-01T00:00:00Z" }),
      sale({ price: 420, last_sold: "2026-10-11T00:00:00Z" }),
      sale({ price: 118, last_sold: "2026-10-09T00:00:00Z", card: { graded: true, grader: "PSA", grade: "9", card_number: "4/102" } }),
    ], card());
    assert.equal(rows["10"]!.price, 420);
    assert.equal(rows["10"]!.date, "2026-10-11");
    assert.equal(rows["9"]!.price, 118);
  });

  it("leaves a grade null rather than borrowing from another", () => {
    // a blank 6 column is the honest answer; filling it with the 8 would be a lie
    const rows = latestByGrade([sale()], card());
    assert.equal(rows["10"]!.price, 420);
    for (const g of ["9", "8", "7", "6"]) assert.equal(rows[g], null, g);
  });

  it("has every grade as a key even on no sales at all", () => {
    const rows = latestByGrade([], card());
    assert.deepEqual(new Set(Object.keys(rows)), new Set(PSA_GRADES));
    assert.equal(Object.values(rows).every((v) => v === null), true);
  });

  it("must be read through PSA_GRADES, because the object reorders itself", () => {
    // "10" and "9" are integer-like keys, so JavaScript sorts them ascending no
    // matter what order they went in. Anything rendering Object.keys would show
    // 6,7,8,9,10 - the columns backwards. PSA_GRADES is the order of record and
    // the UI iterates that, not the object.
    const rows = latestByGrade([], card());
    assert.deepEqual(Object.keys(rows), ["6", "7", "8", "9", "10"], "this is JS, not a bug");
    assert.deepEqual([...PSA_GRADES], ["10", "9", "8", "7", "6"], "and this is what to render");
  });

  it("drops the wrong card without dropping the right one", () => {
    const rows = latestByGrade([
      sale({ price: 9999, card: { graded: true, grader: "PSA", grade: "10", card_number: "11/102" } }),
      sale({ price: 420 }),
    ], card());
    assert.equal(rows["10"]!.price, 420, "the 11/102 must not set this card's price");
  });

  it("survives junk in place of a list", () => {
    assert.equal(Object.values(latestByGrade(null as any, card())).every((v) => v === null), true);
  });

  it("carries what makes a sale believable", () => {
    const row = latestByGrade([sale({ format: "AUCTION", best_offer: true })], card())["10"]!;
    assert.equal(row.format, "AUCTION");
    assert.equal(row.bestOffer, true);
    assert.equal(row.url, "https://ebay.com/itm/1");
  });
});

describe("the multiple that makes it a decision", () => {
  it("says how many times raw a grade sold for", () => {
    assert.equal(upside(20, 420), 21);
    assert.equal(upside(20, 26), 1.3);
  });

  it("is null when either side is unknown", () => {
    // "no sale found" and "worth nothing graded" are opposite conclusions and
    // must not both render as 0x
    assert.equal(upside(20, null), null);
    assert.equal(upside(null, 420), null);
    assert.equal(upside(0, 420), null);
    assert.equal(upside(20, 0), null);
  });
});

describe("telling the print run apart", () => {
  it("reads 1st Edition out of either field", () => {
    assert.equal(printingKind({ printing: "1st Edition" }), "first");
    assert.equal(printingKind({ variant: "1st Edition Holofoil" }), "first");
  });

  it("reads Unlimited out of either field", () => {
    assert.equal(printingKind({ printing: "Unlimited" }), "unlimited");
    assert.equal(printingKind({ variant: "Unlimited Holofoil" }), "unlimited");
  });

  it("says nothing about a modern card", () => {
    // no print run to speak of; guessing one would empty the panel
    assert.equal(printingKind({ variant: "Holofoil" }), "");
    assert.equal(printingKind({}), "");
  });
});

describe("keeping print runs out of each other's prices", () => {
  // A Gym Heroes Lt. Surge in PSA 10 is a different card in 1st Edition than in
  // Unlimited. Quoting one against the other overstates the upside by multiples,
  // which is exactly what happened the first time this shipped.
  const firstEd = (over: any = {}) =>
    sale({ card: { graded: true, grader: "PSA", grade: "10", card_number: "017/132", first_edition: true }, ...over });
  const unlimited = (over: any = {}) =>
    sale({ card: { graded: true, grader: "PSA", grade: "10", card_number: "017/132", first_edition: false }, ...over });
  const unlabelled = (over: any = {}) =>
    sale({ card: { graded: true, grader: "PSA", grade: "10", card_number: "017/132" }, ...over });

  const surge = (run: Partial<CardLike>): CardLike =>
    ({ name: "Lt. Surge", setName: "Gym Heroes", number: "017/132", ...run });

  it("refuses a 1st Edition sale for an Unlimited card", () => {
    assert.equal(saleMatches(firstEd(), surge({ variant: "Unlimited Holofoil" })), false);
  });

  it("takes an unlabelled sale for an Unlimited card", () => {
    // almost no Unlimited listing says so in the title, so demanding proof
    // would empty the panel on the cards it matters most for
    assert.equal(saleMatches(unlabelled(), surge({ variant: "Unlimited Holofoil" })), true);
    assert.equal(saleMatches(unlimited(), surge({ variant: "Unlimited Holofoil" })), true);
  });

  it("demands a 1st Edition sale for a 1st Edition card", () => {
    // the expensive direction to be wrong in: being quoted Unlimited money on
    // a 1st Edition card reads as "not worth grading" when it very much is
    assert.equal(saleMatches(firstEd(), surge({ printing: "1st Edition" })), true);
    assert.equal(saleMatches(unlimited(), surge({ printing: "1st Edition" })), false);
    assert.equal(saleMatches(unlabelled(), surge({ printing: "1st Edition" })), false);
  });

  it("takes either when the card does not say", () => {
    assert.equal(saleMatches(firstEd(), surge({})), true);
    assert.equal(saleMatches(unlimited(), surge({})), true);
  });

  it("only narrows upstream for 1st Edition, never for Unlimited", () => {
    assert.equal(gradedParams(surge({ printing: "1st Edition" })).first_edition, "true");
    assert.equal(gradedParams(surge({ variant: "Unlimited Holofoil" })).first_edition, undefined);
    assert.equal(gradedParams(surge({})).first_edition, undefined);
  });

  it("keeps the two apart in the grade columns", () => {
    const rows = latestByGrade(
      [firstEd({ price: 4000 }), unlabelled({ price: 300, last_sold: "2026-10-01T00:00:00Z" })],
      surge({ variant: "Unlimited Holofoil" }),
    );
    assert.equal(rows["10"]!.price, 300, "the 1st Edition sale must not price the Unlimited card");
  });
});

describe("a card off the scanner rather than out of the table", () => {
  it("builds the same card from loose fields", () => {
    const q: Record<string, string> = {
      name: "Charizard", setName: "Base Set", number: "4/102", language: "Japanese", printing: "1st Edition",
    };
    const c = cardFromParams((k) => q[k] ?? null);
    assert.equal(gradedQuery(c), "Charizard Base Set");
    assert.equal(gradedParams(c).lang, "ja");
    assert.equal(gradedParams(c).first_edition, "true");
  });

  it("defaults the fields a scan row may not have", () => {
    const c = cardFromParams((k) => (k === "name" ? "Pikachu" : null));
    assert.equal(c.language, "English");
    assert.equal(c.condition, "Raw");
    assert.equal(c.setName, "");
  });

  it("clamps what comes off a query string", () => {
    const c = cardFromParams((k) => (k === "name" ? "x".repeat(500) : null));
    assert.equal(c.name!.length, 120);
  });

  it("collapses the whitespace a model leaves behind", () => {
    const c = cardFromParams((k) => (k === "name" ? "  Leafeon   LV.X \n" : null));
    assert.equal(c.name, "Leafeon LV.X");
  });
});

describe("whether a scanned card is worth a lookup", () => {
  it("looks up a card worth grading", () => {
    assert.equal(worthGradedLookup(20, GRADE_LOOKUP_FLOOR), true);
    assert.equal(worthGradedLookup(5, GRADE_LOOKUP_FLOOR), true, "the floor itself counts");
  });

  it("skips a common that costs less than the grading fee", () => {
    assert.equal(worthGradedLookup(0.69, GRADE_LOOKUP_FLOOR), false);
  });

  it("looks up a card nobody has priced yet", () => {
    // unpriced is unknown, not cheap. Passing on a card because no comp came
    // back is the expensive mistake, not the lookup.
    assert.equal(worthGradedLookup(null, GRADE_LOOKUP_FLOOR), true);
    assert.equal(worthGradedLookup(undefined, GRADE_LOOKUP_FLOOR), true);
  });

  it("has a floor that is actually a floor", () => {
    assert.equal(GRADE_LOOKUP_FLOOR > 0, true);
  });
});

describe("which cards get the panel", () => {
  it("offers it on raw cards", () => {
    for (const c of ["Raw", "NM", "LP", "MP", "HP", "DM"]) {
      assert.equal(wantsGradedSales({ condition: c }, isSlab), true, c);
    }
  });

  it("withholds it from a slab", () => {
    // a PSA 10 already knows what it is; its own comp answers the question
    for (const c of ["PSA 10", "PSA 9", "CGC 10", "Other Graded"]) {
      assert.equal(wantsGradedSales({ condition: c }, isSlab), false, c);
    }
  });
});
