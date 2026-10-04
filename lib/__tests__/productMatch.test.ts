import { test } from "node:test";
import assert from "node:assert/strict";
import { matchProduct, matchedProduct, MIN_FUZZY_LEN } from "../productNames";
import { takeStock } from "../stock";
import type { AtRecord } from "../airtable";

// Matching a pasted show set against inventory.
//
// A paste is the least reliable name source in the app: typed from memory, or
// copied off a previous show, or read aloud off a shelf. The matcher's job is
// not to be clever about it. It is to be right about which of three situations
// it is in, because the user's next action is different in each one.

const p = (name: string, extra: Record<string, any> = {}): AtRecord =>
  ({ id: "rec" + name.replace(/\W/g, "").slice(0, 12).padEnd(12, "0"), fields: { "Product Name": name, ...extra } });

test("an exact name matches", () => {
  const inv = [p("Surging Sparks Booster Box"), p("Prismatic Evolutions ETB")];
  const m = matchProduct("Surging Sparks Booster Box", inv);
  assert.equal(m.kind, "exact");
  assert.equal(matchedProduct(m)?.fields["Product Name"], "Surging Sparks Booster Box");
});

test("case and surrounding space do not matter", () => {
  const inv = [p("Surging Sparks Booster Box")];
  assert.equal(matchProduct("  surging SPARKS booster box ", inv).kind, "exact");
});

test("a former name still finds the product after a rename", () => {
  // The case lib/productNames.ts was written for: a mapped product takes on its
  // real TCGplayer name, and the set pasted next week still uses the old one.
  const inv = [p("SV08: Surging Sparks Booster Box", { "Former Names": "Surging Sparks Booster Box" })];
  const m = matchProduct("Surging Sparks Booster Box", inv);
  assert.equal(m.kind, "exact");
  assert.equal(matchedProduct(m)?.fields["Product Name"], "SV08: Surging Sparks Booster Box");
});

test("a current name beats another product's former name", () => {
  const stale = p("Something Else", { "Former Names": "Surging Sparks Booster Box" });
  const real = p("Surging Sparks Booster Box");
  assert.equal(matchedProduct(matchProduct("Surging Sparks Booster Box", [stale, real]))?.id, real.id);
  // and the same whichever order they arrive in
  assert.equal(matchedProduct(matchProduct("Surging Sparks Booster Box", [real, stale]))?.id, real.id);
});

test("a single partial match is accepted", () => {
  const inv = [p("Prismatic Evolutions Elite Trainer Box"), p("Surging Sparks Booster Box")];
  const m = matchProduct("Prismatic Evolutions Elite Trainer", inv);
  assert.equal(m.kind, "unique");
  assert.equal(matchedProduct(m)?.fields["Product Name"], "Prismatic Evolutions Elite Trainer Box");
});

test("two products answering to the same text is ambiguous, not missing", () => {
  // The bug this file exists for. Both of these contain what was typed, so the
  // old matcher returned null and the route said "not in inventory", which
  // tells you to create a product you already own twice over.
  const inv = [p("Surging Sparks Booster Bundle"), p("Surging Sparks Booster Box")];
  const m = matchProduct("Surging Sparks Booster", inv);
  assert.equal(m.kind, "ambiguous");
  assert.equal(matchedProduct(m), null);
  assert.equal(m.kind === "ambiguous" && m.candidates.length, 2);
});

test("an exact hit wins even when other products also contain the text", () => {
  const exact = p("Surging Sparks Booster Box");
  const inv = [exact, p("Surging Sparks Booster Box Case")];
  const m = matchProduct("Surging Sparks Booster Box", inv);
  assert.equal(m.kind, "exact");
  assert.equal(matchedProduct(m)?.id, exact.id);
});

test("a genuinely unknown name is none, and stays none", () => {
  const inv = [p("Surging Sparks Booster Box")];
  assert.equal(matchProduct("Journey Together Booster Box", inv).kind, "none");
  assert.equal(matchProduct("", inv).kind, "none");
  assert.equal(matchProduct("   ", inv).kind, "none");
});

test("a short product name cannot swallow an unrelated line", () => {
  // A product literally called "Tin" used to match any pasted line containing
  // those three letters, and because it was the only match the paste silently
  // took the wrong product off the shelf. Silently wrong beats loudly wrong in
  // nobody's inventory.
  const inv = [p("Tin"), p("ETB")];
  assert.equal(matchProduct("Destined Rivals Booster Bundle", inv).kind, "none");
  assert.equal(matchProduct("Prismatic Evolutions Poster Collection", inv).kind, "none");
  // but the exact name still works, because that is not a guess
  assert.equal(matchProduct("Tin", inv).kind, "exact");
  assert.equal(matchProduct("etb", inv).kind, "exact");
});

test("the fuzzy guard is applied to whichever side is doing the containing", () => {
  const inv = [p("Mega Latias ex Collection")];
  // pasted text is shorter than the guard, so it cannot claim the product
  assert.equal(matchProduct("Mega", inv).kind, "none");
  // at the guard length it is allowed to
  assert.equal("Latias".length, MIN_FUZZY_LEN);
  assert.equal(matchProduct("Latias", inv).kind, "unique");
});

test("inactive or nameless records do not throw", () => {
  const inv = [{ id: "rec1", fields: {} }, { id: "rec2", fields: { "Product Name": "" } }] as AtRecord[];
  assert.equal(matchProduct("anything at all", inv).kind, "none");
  assert.equal(matchProduct("", []).kind, "none");
});

// What the add-product guard stands on.
//
// Add product had no duplicate check at all, and quick-add had one written as
// an Airtable formula over ACTIVE records and their CURRENT name only. Both
// holes made the same thing: a second copy of a product already owned, at $0
// market, which then prices every show it lands on wrong. 57 products in the
// real table had one. Both routes now gate on an exact matchProduct hit over
// the whole table, so these two cases are the guard.
test("a retired product is found by name, so it is revived rather than duplicated", () => {
  const inv = [p("Journey Together Booster Bundle", { "Active": false, "Qty On Hand": 0 })];
  const m = matchProduct("journey together booster bundle", inv);
  assert.equal(m.kind, "exact");
  assert.equal(matchedProduct(m)?.id, inv[0].id);
});

test("a name the product was renamed away from still finds it", () => {
  const inv = [p("Perfect order booster bundle", { "Former Names": "Perfect Order\nperfect order bundle" })];
  assert.equal(matchProduct("Perfect Order", inv).kind, "exact");
  assert.equal(matchProduct("perfect order bundle", inv).kind, "exact");
});

test("a genuinely new product is still allowed through", () => {
  // The guard must not reach for the fuzzy match. These two share every word
  // but one and are different things on the shelf.
  const inv = [p("Mega Evolution Booster Pack")];
  assert.notEqual(matchProduct("Mega Evolution Booster Box", inv).kind, "exact");
});

// The other half of the same route: taking the stock off the shelf.
test("the same product on two pasted lines comes off the shelf twice", () => {
  // Both lines used to be computed from the original on-hand, so the second
  // write overwrote the first and the shelf only ever lost one line's worth.
  // Ten on hand, two lines of two and three, should leave five.
  let onHand = 10;
  for (const qty of [2, 3]) onHand = takeStock(onHand, qty);
  assert.equal(onHand, 5);
});

test("stock still bottoms out at zero across several lines", () => {
  let onHand = 4;
  for (const qty of [3, 3]) onHand = takeStock(onHand, qty);
  assert.equal(onHand, 0);
});
