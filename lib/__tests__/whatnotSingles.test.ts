import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { matchProduct, planSetFromShow, spinItem, cardNoInListing, cardNoOnLine, type Product } from "../whatnotCsv";

// Matching a Whatnot listing for a single card to the line it sits on.
//
// THE BUG THIS EXISTS FOR. The set line carries the full catalogue name and
// the Whatnot listing carries the short one a person typed during the show:
//
//   line     [0236] NM Leafeon - 170 (Cosmos Holo) #170 SV: Scarlet & Violet Promo Cards
//   listing  GREAT ODDS!!! - [0236] LEAFEON - 170 COSMOS HOLO #170
//
// matchProduct required every meaningful word of the line to appear in the
// listing. "nm", "sv", "scarlet", "violet", "promo" and "cards" are in the
// first and not the second, so the match failed - not sometimes, always, for
// every single card on every wheel. The upload then reported the entire set
// as "sold on Whatnot but not on this show set", which is both alarming and
// useless: the handful of cards that genuinely never got entered were sitting
// in a list of forty that were fine.
//
// The card number is the fix because it is the one thing both sides agree on.
// It is unique to one physical card and never reused.

const LINE = "[0236] NM Leafeon - 170 (Cosmos Holo) #170 SV: Scarlet & Violet Promo Cards";
const LISTING = "GREAT ODDS!!! - [0236] LEAFEON - 170 COSMOS HOLO #170";

const sale = (title: string) => ({ title, description: "" });
const p = (id: string, name: string): Product => ({ id, name });

describe("card numbers decide a singles match", () => {
  it("matches the real listing to the real line, which is what used to fail", () => {
    const m = matchProduct(sale(spinItem(LISTING)), [p("a", LINE)]);
    assert.equal(m?.id, "a");
  });

  it("still matches when the show prefix was never stripped", () => {
    // spinItem cuts at the first " - ", so a title whose prefix uses a
    // different dash, or none, arrives here with the prefix still attached.
    // The number is found wherever it sits, so that no longer matters.
    const m = matchProduct(sale(LISTING), [p("a", LINE)]);
    assert.equal(m?.id, "a");
  });

  it("does not put a sold card on its neighbour's line", () => {
    // [0238] was never added to the set. The only other line is the same card
    // in the same set in the same condition, one number away.
    const m = matchProduct(sale("[0238] LEAFEON - 170 COSMOS HOLO #170"), [p("a", LINE)]);
    assert.equal(m, null);
  });

  it("reads [0236] and [236] as the same card", () => {
    assert.equal(cardNoInListing("x [0236] y"), "236");
    assert.equal(cardNoOnLine("[236] NM Leafeon"), "236");
  });

  it("only reads a line's number from the front", () => {
    // A sealed product that happens to carry a bracketed year is not card 2026
    assert.equal(cardNoOnLine("2026 Dragon Boat Festival Gift Box [2026]"), null);
  });

  it("leaves sealed matching alone", () => {
    const products = [p("bf", "Brilliant Fantasy pack"), p("etb", "30th Celebration Elite Trainer Box")];
    assert.equal(matchProduct(sale("GREAT ODDS!!! - Brilliant Fantasy pack"), products)?.id, "bf");
    assert.equal(matchProduct(sale("30TH CELEBRATION ETB"), products)?.id, "etb");
  });

  it("falls through to the token match when the set has no numbered lines", () => {
    // The audit page matches listings against sealed inventory, where nothing
    // carries a card number. A numbered listing there should still be allowed
    // to find a sealed product rather than being cut off early.
    const m = matchProduct(sale("[0236] Brilliant Fantasy pack"), [p("bf", "Brilliant Fantasy pack")]);
    assert.equal(m?.id, "bf");
  });
});

describe("planSetFromShow over a real wheel", () => {
  const lines = [
    { id: "l1", name: LINE, qty: 1, qtyHit: 0 },
    { id: "l2", name: "[0613] NM Pikachu #042/128 ME: 30th Celebration", qty: 1, qtyHit: 0 },
    { id: "l3", name: "Brilliant Fantasy pack", qty: 160, qtyHit: 0 },
  ] as any;

  const spin = (title: string, price: number) => ({
    title, description: "", qty: 1, price, free: false, showId: "s", format: "", buyer: "",
  }) as any;

  it("hits the right lines and reports only what is truly missing", () => {
    const plan = planSetFromShow(
      [
        spin("GREAT ODDS!!! - [0236] LEAFEON - 170 COSMOS HOLO #170", 11.7),
        spin("GREAT ODDS!!! - [0613] PIKACHU #042/128 ME: 30TH CELEBRATION", 12.99),
        spin("GREAT ODDS!!! - Brilliant Fantasy pack", 13.99),
        spin("GREAT ODDS!!! - Brilliant Fantasy pack", 12.6),
        spin("GREAT ODDS!!! - [0238] LEAFEON - 170 COSMOS HOLO #170", 12.99),
      ],
      lines,
    );

    const hit = Object.fromEntries(plan.lines.map((l) => [l.lineId, l.now]));
    assert.equal(hit.l1, 1);
    assert.equal(hit.l2, 1);
    assert.equal(hit.l3, 2);
    assert.equal(plan.spins, 5);

    // one genuine miss, and only the one
    assert.equal(plan.notOnSet.length, 1);
    assert.match(plan.notOnSet[0].title, /0238/);
  });

  it("does not report a card as missing just because it is already hit", () => {
    // Three spins sharing a prefix, because a prefix only reads as a wheel
    // once it appears on three paid sales - below that they are taken for
    // store purchases and never reach the set at all.
    const already = [{ ...lines[0], qtyHit: 1 }, lines[1], lines[2]] as any;
    const plan = planSetFromShow(
      [
        spin("GREAT ODDS!!! - [0236] LEAFEON - 170 COSMOS HOLO #170", 11.7),
        spin("GREAT ODDS!!! - [0613] PIKACHU #042/128 ME: 30TH CELEBRATION", 12.99),
        spin("GREAT ODDS!!! - Brilliant Fantasy pack", 12.6),
      ],
      already,
    );
    assert.deepEqual(plan.notOnSet, []);
    // set, not added: the line was already on 1 and the report says 1
    assert.equal(plan.lines.find((l) => l.lineId === "l1")?.now, 1);
  });
});
