import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  classifyCollectrCsv, isPokemonLine, languageFor, looksLikeCardCondition, tcgSlugFor,
} from "../collectr";

// cl-v2. Every fixture here is a row off a real 48-card TCGplayer export that
// this importer mishandled: 3 rows silently set aside, no languages, and not
// one of the 48 linked to the product id sitting in column one.
const HEADER =
  "Product ID,TCGplayer Id,Product Line,Set Name,Product Name,Title,Number,Rarity,Condition,Printing," +
  "TCG Market Price,TCG Direct Low,TCG Low Price With Shipping,TCG Low Price,Total Quantity,Add to Quantity," +
  "TCG Marketplace Price,Photo URL";

const row = (o: Partial<Record<string, string>>) =>
  [
    o.productId ?? "517046", o.tcgId ?? "7436752", o.line ?? "Pokemon",
    o.set ?? "SV: Scarlet & Violet 151", o.name ?? "Blastoise ex - 200/165", "",
    o.number ?? "200/165", o.rarity ?? "Special Illustration Rare",
    o.cond ?? "Near Mint", o.printing ?? "Holofoil",
    o.market ?? "107.52", "", "", "", o.totalQty ?? "", o.addQty ?? "1", "",
    o.photo ?? "https://tcgplayer-cdn.tcgplayer.com/product/517046_in_200x200.jpg",
  ].join(",");

const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
const singles = (text: string) => classifyCollectrCsv(text).portfolios["default"]?.singles ?? [];

describe("which product lines are Pokemon", () => {
  it("accepts the Japanese catalog, which is the same game", () => {
    // The bug. The check was `cat !== "pokemon"`, so "Pokemon Japan" was
    // counted as a different GAME and set aside next to a note about One
    // Piece support. On the file this was found with that was 4 cards and
    // $198.80 reported as "3 non-Pokemon rows".
    assert.equal(isPokemonLine("Pokemon Japan"), true);
    assert.equal(isPokemonLine("Pokemon"), true);
  });

  it("treats a blank line as Pokemon, which is what Collectr exports look like", () => {
    assert.equal(isPokemonLine(""), true);
  });

  it("still sets a different game aside", () => {
    assert.equal(isPokemonLine("One Piece Card Game"), false);
    assert.equal(isPokemonLine("Magic"), false);
    // Not a prefix match on the bare word: "Pokemonopoly" is not a catalog.
    assert.equal(isPokemonLine("Pokemonopoly"), false);
  });

  it("imports the Japanese rows instead of dropping them", () => {
    const c = classifyCollectrCsv(csv(
      row({}),
      row({ productId: "568414", line: "Pokemon Japan", set: "SV5K: Wild Force", name: "Gastly - 080/071", number: "080/071", cond: "Near Mint - Japanese", market: "34.07", addQty: "2" }),
    ));
    assert.equal(c.nonPokemon, 0);
    assert.equal(c.portfolios["default"].singles.length, 2);
  });
});

describe("the language on the row", () => {
  it("reads the Japanese catalog off the product line", () => {
    assert.equal(languageFor("Pokemon Japan", "Near Mint"), "Japanese");
  });

  it("reads it off the condition too, since the exports disagree on where it goes", () => {
    assert.equal(languageFor("", "Near Mint - Japanese"), "Japanese");
    assert.equal(languageFor("Pokemon", "Near Mint - Japanese"), "Japanese");
  });

  it("is blank for English, not the word English", () => {
    // Blank is how the Language column is read everywhere else: the exception
    // gets marked and the rule does not. Writing "English" on every row would
    // make the filter that means "say so if it is not" useless.
    assert.equal(languageFor("Pokemon", "Near Mint"), "");
    assert.equal(languageFor("", ""), "");
  });

  it("lands on the record, because an English comp on a Japanese card multiplies", () => {
    // Not a cosmetic field. lib/gradedSales filters sales by language on
    // purpose: modern Japanese prints trade at a fraction of their English
    // counterparts, so getting this wrong does not drift the price, it
    // multiplies it.
    const s = singles(csv(row({ line: "Pokemon Japan", cond: "Near Mint - Japanese" })));
    assert.equal(s[0].language, "Japanese");
    assert.equal(singles(csv(row({})))[0].language, "");
  });
});

describe("the product id and the slug built from the row", () => {
  it("carries the id out of column one", () => {
    assert.equal(singles(csv(row({ productId: "590027" })))[0].productId, 590027);
  });

  it("is undefined rather than zero when there is no id", () => {
    // The caller tests truthiness to decide whether to spend a lookup, so a 0
    // would read as "no id" by luck rather than by design.
    assert.equal(singles(csv(row({ productId: "" })))[0].productId, undefined);
    assert.equal(singles(csv(row({ productId: "not a number" })))[0].productId, undefined);
  });

  it("builds the slug TCGplayer puts in a URL", () => {
    // Which is the whole point: getTcgcsvCardByProductId already takes a slug
    // because a bare id has to be hunted through the newest sixteen English
    // sets, and a slug names one group out of six hundred and seventy-nine.
    assert.equal(
      tcgSlugFor("Pokemon Japan", "SV5K: Wild Force", "Gastly - 080/071"),
      "pokemon-japan-sv5k-wild-force-gastly",
    );
    assert.equal(
      tcgSlugFor("Pokemon", "SV08: Surging Sparks", "Pikachu ex - 238/191"),
      "pokemon-sv08-surging-sparks-pikachu-ex",
    );
  });

  it("turns an ampersand into the word, the way the catalog slug does", () => {
    assert.equal(
      tcgSlugFor("Pokemon", "SV: Scarlet & Violet 151", "Blastoise ex - 200/165"),
      "pokemon-sv-scarlet-and-violet-151-blastoise-ex",
    );
  });

  it("does not mistake the Japanese catalog for the English one", () => {
    // slugGroups reads the catalog off the front of the slug, so getting this
    // the wrong way round sends the lookup to the wrong half of the mirror.
    assert.ok(tcgSlugFor("Pokemon Japan", "Wild Force", "Gastly").startsWith("pokemon-japan-"));
    assert.ok(!tcgSlugFor("Pokemon", "Wild Force", "Gastly").startsWith("pokemon-japan-"));
  });

  it("is empty when there is no set to narrow to", () => {
    // A slug with no set in it narrows nothing, and the caller is better off
    // knowing that than being handed something that looks usable.
    assert.equal(tcgSlugFor("Pokemon", "", "Blastoise ex"), "");
  });

  it("does not pick up Product Line or Product Name as the id column", () => {
    // "Product ID" shares a prefix with both, so the header is matched whole.
    const s = singles(csv(row({ productId: "684338" })));
    assert.equal(s[0].productId, 684338);
  });
});

describe("an unnumbered promo is still a card", () => {
  it("imports as a single, not a sealed product", () => {
    // Timeless Celebi out of the 10th Movie Commemoration Set has no collector
    // number, and the number was the only test for card-versus-sealed. Read by
    // number alone a $54 promo imports as a booster box.
    const c = classifyCollectrCsv(csv(
      row({ productId: "613778", line: "Pokemon Japan", set: "10th Movie Commemoration Set", name: "Timeless Celebi", number: "", rarity: "None", cond: "Near Mint - Japanese", market: "54.16" }),
    ));
    assert.equal(c.portfolios["default"].singles.length, 1);
    assert.equal(c.portfolios["default"].sealed.length, 0);
    assert.equal(c.portfolios["default"].singles[0].name, "Timeless Celebi");
  });

  it("leaves genuine sealed product on the sealed side", () => {
    const c = classifyCollectrCsv(csv(
      row({ productId: "", set: "SV08: Surging Sparks", name: "Surging Sparks Booster Box", number: "", rarity: "", cond: "Unopened", printing: "", market: "139.99" }),
    ));
    assert.equal(c.portfolios["default"].singles.length, 0);
    assert.equal(c.portfolios["default"].sealed.length, 1);
  });

  it("knows a card condition from a sealed one", () => {
    assert.equal(looksLikeCardCondition("Near Mint"), true);
    assert.equal(looksLikeCardCondition("Near Mint - Japanese"), true);
    assert.equal(looksLikeCardCondition("Lightly Played"), true);
    assert.equal(looksLikeCardCondition("PSA 10"), true);
    assert.equal(looksLikeCardCondition("Unopened"), false);
    assert.equal(looksLikeCardCondition("Sealed"), false);
    assert.equal(looksLikeCardCondition(""), false);
  });
});

describe("what the rest of the row still does", () => {
  it("keeps reading quantity out of Add to Quantity", () => {
    assert.equal(singles(csv(row({ addQty: "7" })))[0].qty, 7);
  });

  it("keeps the per-SKU market price and says it is per SKU", () => {
    const s = singles(csv(row({ market: "258.11", cond: "Near Mint" })))[0];
    assert.equal(s.comp, 258.11);
    assert.equal(s.compSource, "TCGplayer export (market, NM)");
  });

  it("keeps mapping the printing", () => {
    assert.equal(singles(csv(row({ printing: "Holofoil" })))[0].printing, "Holo");
    assert.equal(singles(csv(row({ printing: "Reverse Holofoil" })))[0].printing, "Reverse");
    assert.equal(singles(csv(row({ printing: "Normal" })))[0].printing, "");
  });

  it("still reads a Collectr export, which has none of these columns", () => {
    const c = classifyCollectrCsv([
      "Product Name,Set,Card Number,Quantity,Market Price,Card Condition,Grade",
      "Charizard,Base Set,4/102,1,420.00,Lightly Played,Ungraded",
    ].join("\n"));
    const s = c.portfolios["default"].singles;
    assert.equal(s.length, 1);
    assert.equal(s[0].condition, "LP");
    assert.equal(s[0].comp, 420);
    assert.equal(s[0].productId, undefined);
    assert.equal(s[0].language, "");
    assert.equal(s[0].compSource, "Collectr import (market)");
  });
});
