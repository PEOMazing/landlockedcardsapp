import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseSoldDate, parseSoldPaste } from "../soldPaste";
import { conditionFor, isSoldLink, quoteSlab, tcgProductIdFromUrl, GRADES_BY_GRADER } from "../slabIntake";

const NOW = new Date("2026-10-16T12:00:00Z");

// si-v1. The paste below is copied verbatim off 130point on 2026-10-16, for
// the English Darkrai Prism Star PSA 10. It is the exact text a person would
// have on their clipboard, advert lines and all, and it is the regression
// test for the whole intake path: if this stops producing $9,000 the form is
// lying to somebody holding a card.
const DARKRAI_PASTE = `
2018 Pokemon Ultra Prism Darkrai Prism Star 77/156 PSA 10 GEM MINT English

$9,499.99 USD

Fixed Price

15 Oct 26 19:14:26

Darkrai Prism Star Ultra Prism 77 Pokemon 2018 PSA 10

$15,000.00 USD

$8,500.00 USD

Best Offer Accepted

08 Oct 26 09:50:36

2018 POKEMON SUN & MOON ULTRA PRISM #77 DARKRAI-HOLO PSA 10

$3,499.99 USD

$2,500.00 USD

Best Offer Accepted

27 Sept 26 00:03:28

2018 Pokemon Sun & Moon Ultra Prism #77 Darkrai Prism Star Holo PSA 10

$2,000.00 USD

Fixed Price

24 Sept 26 07:14:02

Pokemon Darkrai Prism Star Ultra Prism Holo Rare #77 PSA 10 Gem Mint

$2,000.00 USD

Fixed Price

24 Sept 26 07:13:26

PSA 10 Darkrai Prism Star Holo 77/156 2018 Pokemon Sun & Moon Ultra Prism

$999.99 USD

Auction · Bids: 1

30 Aug 26 20:00:01
`;

describe("reading dates off a pasted page", () => {
  it("reads 130point's day-first format", () => {
    assert.equal(parseSoldDate("15 Oct 26 19:14:26", NOW), "2026-10-15");
    assert.equal(parseSoldDate("08 Oct 26 09:50:36", NOW), "2026-10-08");
  });

  it("reads Sept, which is four letters and breaks naive month parsing", () => {
    assert.equal(parseSoldDate("27 Sept 26 00:03:28", NOW), "2026-09-27");
  });

  it("reads eBay's month-first format", () => {
    assert.equal(parseSoldDate("Oct 15, 2026", NOW), "2026-10-15");
    assert.equal(parseSoldDate("Sold  Sep 4, 2026", NOW), "2026-09-04");
  });

  it("reads a plain ISO date", () => {
    assert.equal(parseSoldDate("2026-10-15", NOW), "2026-10-15");
  });

  it("returns null rather than guessing", () => {
    assert.equal(parseSoldDate("Fixed Price", NOW), null);
    assert.equal(parseSoldDate("$9,499.99 USD", NOW), null);
    assert.equal(parseSoldDate("", NOW), null);
  });
});

describe("the real Darkrai paste", () => {
  it("finds all six sales", () => {
    const { sales } = parseSoldPaste(DARKRAI_PASTE, NOW);
    assert.equal(sales.length, 6);
  });

  it("takes the ACCEPTED price on a best offer, never the ask", () => {
    // The whole point. $15,000 was the ask; $8,500 changed hands. Reading
    // this backwards is the error that put a $15,000 ask into the collection
    // as a sale.
    const { sales } = parseSoldPaste(DARKRAI_PASTE, NOW);
    const oct8 = sales.find((s) => s.date === "2026-10-08")!;
    assert.equal(oct8.price, 8500);
    assert.equal(oct8.askingPrice, 15000);
    assert.equal(oct8.bestOffer, true);
  });

  it("does the same on the second accepted offer", () => {
    const { sales } = parseSoldPaste(DARKRAI_PASTE, NOW);
    const sep27 = sales.find((s) => s.date === "2026-09-27")!;
    assert.equal(sep27.price, 2500);
    assert.equal(sep27.askingPrice, 3499.99);
  });

  it("leaves a single-price sale alone", () => {
    const { sales } = parseSoldPaste(DARKRAI_PASTE, NOW);
    const oct15 = sales.find((s) => s.date === "2026-10-15")!;
    assert.equal(oct15.price, 9499.99);
    assert.equal(oct15.bestOffer, false);
    assert.equal(oct15.askingPrice, undefined);
  });

  it("keeps the format so an auction is distinguishable", () => {
    const { sales } = parseSoldPaste(DARKRAI_PASTE, NOW);
    assert.equal(sales.find((s) => s.date === "2026-08-30")!.format, "AUCTION");
  });

  it("sorts newest first", () => {
    const { sales } = parseSoldPaste(DARKRAI_PASTE, NOW);
    assert.deepEqual(sales.map((s) => s.date), [
      "2026-10-15", "2026-10-08", "2026-09-27", "2026-09-24", "2026-09-24", "2026-08-30",
    ]);
  });

  it("produces the comp the sweep arrived at by hand", () => {
    const q = quoteSlab("PSA", "10", DARKRAI_PASTE, { now: NOW });
    assert.equal(q.ok, true);
    assert.equal(q.price, 9000);
    assert.match(q.source, /repriced up/);
  });

  it("warns that older sales were set aside", () => {
    const q = quoteSlab("PSA", "10", DARKRAI_PASTE, { now: NOW });
    assert.ok(q.notes.some((n) => /Repriced up/i.test(n)));
  });
});

describe("pastes that are wrong in the ways real pastes are wrong", () => {
  it("ignores advert and chrome lines", () => {
    const { sales } = parseSoldPaste(
      `Sold (11)\nLive (2)\nSort order\nMost Recent\nSave search\n` +
        `Some Card PSA 10\n$120.00 USD\nFixed Price\n01 Oct 26 10:00:00\n`,
      NOW,
    );
    assert.equal(sales.length, 1);
    assert.equal(sales[0].price, 120);
  });

  it("says so when a price has no date to attach to", () => {
    const { sales, skipped } = parseSoldPaste("Some Card\n$120.00 USD\n", NOW);
    assert.equal(sales.length, 0);
    assert.equal(skipped, 1);
  });

  it("asks for a better paste rather than returning a bogus comp", () => {
    const q = quoteSlab("PSA", "10", "nothing useful here", { now: NOW });
    assert.equal(q.ok, false);
    assert.equal(q.price, null);
    assert.match(q.notes.join(" "), /No sales found/);
  });

  it("flags a thin comp on the way in", () => {
    const q = quoteSlab("PSA", "9", "Card\n$300.00\nFixed Price\n10 Oct 26\n", { now: NOW });
    assert.equal(q.price, 300);
    assert.ok(q.notes.some((n) => /Thin/.test(n)));
  });

  it("flags a stale comp on the way in", () => {
    const q = quoteSlab("PSA", "9", "Card\n$300.00\nFixed Price\n10 Jun 26\n", { now: NOW });
    assert.ok(q.notes.some((n) => /Nothing sold in the last 30 days/.test(n)));
  });

  it("refuses a grade the app cannot store", () => {
    const q = quoteSlab("PSA", "9.5", DARKRAI_PASTE, { now: NOW });
    assert.equal(q.ok, false);
    assert.match(q.notes[0], /not a grade this app stores/);
  });
});

describe("grader and grade", () => {
  it("builds the Condition value the rest of the app already speaks", () => {
    assert.equal(conditionFor("PSA", "10"), "PSA 10");
    assert.equal(conditionFor("psa", "1"), "PSA 1");
    assert.equal(conditionFor("BGS", "9.5"), "BGS 9.5");
    assert.equal(conditionFor("CGC", "9"), "CGC 9");
  });

  it("refuses a pairing that does not exist", () => {
    assert.equal(conditionFor("PSA", "9.5"), null);
    assert.equal(conditionFor("ACE", "10"), null);
  });

  it("offers no half grades for PSA and a 9.5 for BGS", () => {
    assert.ok(!GRADES_BY_GRADER.PSA.includes("9.5"));
    assert.ok(GRADES_BY_GRADER.BGS.includes("9.5"));
  });

  it("every offered pairing is storable", () => {
    // The guard that stops the dropdown and the Condition column drifting
    // apart, which is how "PSA 7" sat unstorable for a month.
    for (const [grader, grades] of Object.entries(GRADES_BY_GRADER)) {
      for (const grade of grades) {
        assert.ok(conditionFor(grader, grade), `${grader} ${grade} is offered but not storable`);
      }
    }
  });
});

describe("the TCGplayer link", () => {
  it("reads the product id off a full product URL", () => {
    assert.equal(
      tcgProductIdFromUrl("https://www.tcgplayer.com/product/517049/pokemon-ultra-prism-darkrai-prism-star"),
      517049,
    );
  });

  it("survives tracking parameters", () => {
    assert.equal(
      tcgProductIdFromUrl("https://www.tcgplayer.com/product/517049/pokemon?Language=English&page=1"),
      517049,
    );
  });

  it("takes a bare id", () => {
    assert.equal(tcgProductIdFromUrl("517049"), 517049);
  });

  it("returns null rather than guessing", () => {
    // A wrong product id silently attaches the wrong card to a slab, which is
    // worse than asking the person to paste it again.
    assert.equal(tcgProductIdFromUrl("https://www.tcgplayer.com/search/pokemon/product?q=darkrai"), null);
    assert.equal(tcgProductIdFromUrl("not a url"), null);
    assert.equal(tcgProductIdFromUrl(""), null);
  });
});

describe("the sold link stored as provenance", () => {
  it("accepts the places these comps actually come from", () => {
    assert.equal(isSoldLink("https://130point.com/search?q=darkrai"), true);
    assert.equal(isSoldLink("https://www.ebay.com/sch/i.html?_nkw=darkrai&LH_Sold=1"), true);
    assert.equal(isSoldLink("https://www.ebay.co.uk/sch/i.html?_nkw=darkrai"), true);
  });

  it("rejects anything else, because this renders as a link on a public page", () => {
    assert.equal(isSoldLink("http://130point.com/search"), false, "http, not https");
    assert.equal(isSoldLink("https://example.com/whatever"), false);
    assert.equal(isSoldLink("javascript:alert(1)"), false);
    assert.equal(isSoldLink(""), false);
  });
});
