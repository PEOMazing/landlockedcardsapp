import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { langOf, languageMatches, saleLanguage, saleMatches } from "../gradedSales";
import { slabParams, slabSaleMatches, slabSales, slabComp } from "../slabComp";

// sl-v2. An English slab must never be priced off a Japanese sale.
//
// This was a live bug in both the raw graded panel and the slab comp. Neither
// checked language on the way back, and neither could rely on the request to
// have done it: gradedParams and slabParams both send no lang for an English
// card on purpose, because asking the feed for English drops every title that
// names no language and that is most honest English listings.
//
// The reason it matters more than a rounding error: modern Japanese prints
// trade at a fraction of their English counterparts, so an unfiltered comp
// does not drift by a few percent, it comes out a multiple wrong.

const EN = { name: "Charizard", setName: "Base Set", number: "4/102", language: "English" };
const JP = { ...EN, language: "Japanese" };
const KO = { ...EN, language: "Korean" };
const ZH = { ...EN, language: "Chinese" };

const item = (over: any = {}, title = "Charizard Base Set PSA 10") => ({
  price: 100, last_sold: "2026-10-10", title,
  card: { graded: true, grader: "PSA", grade: "10", card_number: "4/102", ...over },
});
const psa10 = { grader: "PSA", grade: "10" };

describe("reading a card's language", () => {
  it("defaults to English when nothing says otherwise", () => {
    assert.equal(langOf({ name: "x" }), "en");
    assert.equal(langOf({ name: "x", language: "" }), "en");
    assert.equal(langOf(EN), "en");
  });

  it("maps the languages that appear in the column", () => {
    assert.equal(langOf(JP), "ja");
    assert.equal(langOf(KO), "ko");
    assert.equal(langOf(ZH), "zh");
  });

  it("is not case or whitespace sensitive", () => {
    assert.equal(langOf({ name: "x", language: " JAPANESE " }), "ja");
  });
});

describe("reading a sold listing's language", () => {
  it("prefers the feed's own field", () => {
    assert.equal(saleLanguage({ language: "Japanese" }), "ja");
    assert.equal(saleLanguage({ card: { lang: "ko" } }), "ko");
  });

  it("falls back to the title, which is where sellers put it", () => {
    assert.equal(saleLanguage({ title: "Charizard Japanese PSA 10" }), "ja");
    assert.equal(saleLanguage({ title: "Pikachu KOREAN Base Set" }), "ko");
    assert.equal(saleLanguage({ title: "Charizard Chinese Simplified" }), "zh");
  });

  it("returns blank for an unmarked listing", () => {
    // Blank is a real answer and means unmarked, which the caller reads as
    // English. Not the same as unknown.
    assert.equal(saleLanguage({ title: "Charizard Base Set PSA 10" }), "");
    assert.equal(saleLanguage({}), "");
  });

  it("reads a non-English marker ahead of an English one", () => {
    // A title naming both is a Japanese card being compared to the English
    // one. The non-English reading is the useful one.
    assert.equal(saleLanguage({ title: "Japanese Charizard, English equivalent PSA 10" }), "ja");
  });

  it("does not fire on substrings inside other words", () => {
    // The reason the patterns are word-anchored and narrow.
    assert.equal(saleLanguage({ title: "Charizard CNY promo lot" }), "");
    assert.equal(saleLanguage({ title: "Kangaskhan PSA 10" }), "");
    assert.equal(saleLanguage({ title: "Korea town card shop" }), "ko"); // see below
  });

  it("reads an incidental mention as that language, which is the safe failure", () => {
    // "Jpn-style sleeve included" on an English card comes back as Japanese
    // and the sale gets dropped. That is deliberate and it is the cheap
    // direction: a false positive costs one sale and a slightly thinner comp,
    // which the sample count then discloses. A false negative is an English
    // card priced off Japanese sales, which is the bug this exists for.
    //
    // Pinned so the asymmetry is a decision somebody made rather than
    // something that gets "tidied up" into a looser rule later.
    assert.equal(saleLanguage({ title: "Charizard PSA 10 Jpn-style sleeve included" }), "ja");
  });
});

describe("whether a sale's language can answer for a card's", () => {
  it("an English card takes an unmarked sale", () => {
    // Most honest English listings name no language. Requiring proof would
    // throw away nearly every real sale.
    assert.equal(languageMatches(item(), EN), true);
  });

  it("an English card takes an explicitly English sale", () => {
    assert.equal(languageMatches(item({}, "Charizard English PSA 10"), EN), true);
  });

  it("an English card REJECTS a Japanese sale", () => {
    // The bug, stated as a test.
    assert.equal(languageMatches(item({}, "Charizard Japanese PSA 10"), EN), false);
    assert.equal(languageMatches({ language: "Japanese" }, EN), false);
  });

  it("an English card rejects Korean and Chinese too", () => {
    assert.equal(languageMatches(item({}, "Charizard Korean PSA 10"), EN), false);
    assert.equal(languageMatches(item({}, "Charizard Chinese PSA 10"), EN), false);
  });

  it("a Japanese card makes the sale prove it", () => {
    // Unmarked means English, and quoting English money on a Japanese card is
    // the expensive direction.
    assert.equal(languageMatches(item(), JP), false);
    assert.equal(languageMatches(item({}, "Charizard Japanese PSA 10"), JP), true);
  });

  it("a Japanese card rejects an explicitly English sale", () => {
    assert.equal(languageMatches(item({}, "Charizard English PSA 10"), JP), false);
  });

  it("a Korean card is not answered by a Japanese sale", () => {
    assert.equal(languageMatches(item({}, "Charizard Japanese PSA 10"), KO), false);
    assert.equal(languageMatches(item({}, "Charizard Korean PSA 10"), KO), true);
  });
});

describe("the filter reaches both pipelines", () => {
  it("the slab matcher drops a Japanese sale for an English slab", () => {
    assert.equal(slabSaleMatches(item({}, "Charizard Japanese PSA 10"), EN, psa10), false);
    assert.equal(slabSaleMatches(item(), EN, psa10), true);
  });

  it("the raw graded panel drops it too", () => {
    assert.equal(saleMatches(item({}, "Charizard Japanese PSA 10"), EN), false);
    assert.equal(saleMatches(item(), EN), true);
  });

  it("a Japanese slab still gets priced, off Japanese sales", () => {
    assert.equal(slabSaleMatches(item({}, "Charizard Japanese PSA 10"), JP, psa10), true);
  });

  it("an English slab's comp ignores the Japanese sales entirely", () => {
    // End to end. Three cheap Japanese sales and two real English ones: the
    // comp must be the English pair, not a blend.
    const items = [
      item({}, "Charizard Japanese PSA 10"),
      { ...item({}, "Charizard Japanese PSA 10"), price: 40, last_sold: "2026-10-14" },
      { ...item({}, "Charizard Japanese PSA 10"), price: 45, last_sold: "2026-10-13" },
      { ...item(), price: 900, last_sold: "2026-10-12" },
      { ...item(), price: 1000, last_sold: "2026-10-11" },
    ];
    const sales = slabSales(items, EN, psa10);
    assert.equal(sales.length, 2, "only the English sales should survive");
    const r = slabComp(sales, new Date("2026-10-16T12:00:00Z"))!;
    assert.equal(r.price, 950);
  });
});

describe("the request narrows only when it helps", () => {
  it("sends no lang for an English slab", () => {
    // Sending it would drop every title that names no language, which is most
    // real English listings.
    assert.equal(slabParams(EN, psa10).lang, undefined);
  });

  it("sends lang for a non-English slab, to spend the quota well", () => {
    assert.equal(slabParams(JP, psa10).lang, "ja");
    assert.equal(slabParams(KO, psa10).lang, "ko");
    assert.equal(slabParams(ZH, psa10).lang, "zh");
  });
});
