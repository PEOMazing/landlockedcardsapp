import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  foldTitle, isStoreSale, packMultiplier, planSetFromShow, storeRows, tokens,
  wheelPrefixesIn, type SetLine, type WhatnotSale,
} from "../whatnotCsv";

// wn-v3. The 7 Oct show "10x POKEMON CENTER EXCLUSIVES w/ CASES" uploaded its
// report and the set recorded nothing: 0 spins, 199 shelf sales, no hits. Two
// separate faults, both visible in that one file.
//
//   1. Every wheel listing is titled "<show name> - <item>", so the show's own
//      name leads every title. packMultiplier read the "10x" off the front of
//      the SHOW and called each order 10 units of shelf product, and that
//      guess was consulted before the question of whether the prefix was the
//      wheel. So all 199 spins left the wheel.
//
//   2. A set line is stored with its count in front ("225x Brilliant Fantasy
//      pack"), and "225x" is a word no listing will ever contain.
//
// And the thing that makes the matching honest rather than clever: the app
// wrote the listing titles itself, so a sale can be matched on the title
// instead of inferred from its words. Whatnot uppercases, drops parentheses
// and appends dots to separate duplicates, which the fold absorbs.

const sale = (over: Partial<WhatnotSale> = {}): WhatnotSale => ({
  row: 2, title: "", description: "", qty: 1, price: 11.5, date: "2026-10-07T23:00:00Z",
  buyer: "someone", status: "", giveaway: false, showId: "", showTitle: "", ...over,
});

const SHOW = "10x POKEMON CENTER EXCLUSIVES w/ CASES";
const spin = (item: string, over: Partial<WhatnotSale> = {}) =>
  sale({ title: `${SHOW} - ${item}`, ...over });

describe("folding a title down to what Whatnot cannot change", () => {
  it("makes the duplicate markers Whatnot appends disappear", () => {
    const one = foldTitle("[Sealed] Brilliant Fantasy pack");
    for (const v of [
      "[Sealed] Brilliant Fantasy pack.",
      "[Sealed] Brilliant Fantasy pack..",
      "[Sealed] Brilliant Fantasy pack...",
      "[Sealed]. Brilliant Fantasy pack.",
      "[SEALED] BRILLIANT FANTASY PACK",
    ]) assert.equal(foldTitle(v), one, v);
  });

  it("drops the emoji a hit is wrapped in", () => {
    assert.equal(
      foldTitle("\u{1F525}[Sealed] Destined Rivals Sleeved Booster\u{1F525}"),
      foldTitle("[Sealed] Destined Rivals Sleeved Booster"),
    );
  });

  it("still keeps two different products apart", () => {
    assert.notEqual(foldTitle("Series 1"), foldTitle("Series 2"));
    assert.notEqual(foldTitle("[Sealed] Mega Evolution Booster Pack"), foldTitle("[Sealed] Mega Evolution Pokemon Center"));
  });

  it("is empty on nothing, so a blank line claims no title", () => {
    assert.equal(foldTitle(""), "");
    assert.equal(foldTitle("   "), "");
  });
});

describe("how many units an order takes off the shelf", () => {
  it("reads the count off the front of a shelf listing", () => {
    assert.equal(packMultiplier("5x Darkness Ablaze Booster Packs"), 5);
    // a shelf listing has a dash of its own, so the count cannot be looked for
    // after one: this stays 5
    assert.equal(packMultiplier("5x Obsidian Flames Packs - Ripped Live"), 5);
  });

  it("is one when there is no count", () => {
    assert.equal(packMultiplier("Prismatic Evolutions Elite Trainer Box"), 1);
    assert.equal(packMultiplier(""), 1);
  });

  it("does read the show's own 10x, which is why it is asked last", () => {
    // left as it is on purpose. isStoreSale settles the wheel before this
    // gets a say, and no shelf listing survives to be measured by its show.
    assert.equal(packMultiplier(`${SHOW} - [Sealed] Brilliant Fantasy pack`), 10);
  });
});

describe("telling a wheel spin from a shelf sale", () => {
  const sales = [
    spin("[Sealed] Brilliant Fantasy pack"),
    spin("[Sealed] Brilliant Fantasy pack."),
    spin("[Sealed] Brilliant Fantasy pack.."),
    sale({ title: "Pokemon Keychain - KailieKreations", price: 8 }),
    sale({ title: "5x Darkness Ablaze Booster Packs", price: 30 }),
  ];
  const wheels = wheelPrefixesIn(sales);

  it("finds the show's prefix from how often it is reused", () => {
    assert.deepEqual([...wheels], [SHOW.toLowerCase()]);
  });

  it("keeps a spin on the wheel even though the show is named 10x", () => {
    assert.equal(isStoreSale(sales[0], false, wheels), false);
  });

  it("still calls a prefix nobody reused a shelf sale", () => {
    assert.equal(isStoreSale(sales[3], false, wheels), true);
  });

  it("still calls a bare pack count a shelf sale", () => {
    assert.equal(isStoreSale(sales[4], false, wheels), true);
  });

  it("leaves the whole show off the shelf list", () => {
    const { rows } = storeRows(sales);
    assert.deepEqual(rows.map((r) => r.title), ["Pokemon Keychain - KailieKreations", "5x Darkness Ablaze Booster Packs"]);
    assert.equal(rows[1].units, 5);
  });

  it("believes the report outright when it says the buy format", () => {
    // the weekly earnings report is explicit, so nothing is guessed from words
    assert.equal(isStoreSale(sale({ title: `${SHOW} - x`, format: "BUY_IT_NOW" }), true), true);
    assert.equal(isStoreSale(sale({ title: `${SHOW} - x`, format: "AUCTION" }), true), false);
  });
});

describe("counting words in a name", () => {
  it("ignores the count a set line carries in front of it", () => {
    assert.deepEqual(tokens("225x Brilliant Fantasy pack"), ["brilliant", "fantasy", "pack"]);
    assert.deepEqual(tokens("10x Elite Trainer Box"), ["elite", "trainer", "box"]);
  });

  it("does not mistake a word that merely ends in x for a count", () => {
    assert.deepEqual(tokens("MAX Box"), ["max", "box"]);
  });
});

const line = (name: string, qty: number, qtyHit = 0): SetLine =>
  ({ id: `l-${name}`, name, qty, qtyHit, exportTitle: `[Sealed] ${name}` });

describe("filling the set in from the 7 Oct report", () => {
  // the set as it was, and the titles exactly as Whatnot sold them back
  const set = [
    line("Brilliant Fantasy pack", 225, 53),
    line("30th Celebration Booster Pack CN", 20, 5),
    line("Mega Evolution Booster Pack", 3),
  ];
  const sales = [
    ...Array.from({ length: 2 }, () => spin("[Sealed] Brilliant Fantasy pack..", { price: 11 })),
    spin("[Sealed]. Brilliant Fantasy pack.", { price: 11 }),
    spin("[Sealed] 30th Celebration Booster Pack CN", { price: 14 }),
    spin("\u{1F525}[Sealed] Destined Rivals Sleeved Booster\u{1F525}", { price: 11.76 }),
    sale({ title: `${SHOW} - FREE VINTAGE CARD!!!!! #1`, price: 0 }),
  ];
  const plan = planSetFromShow(sales, set);

  it("counts every paid spin, not nearly none of them", () => {
    assert.equal(plan.spins, 5);
    assert.equal(plan.gross, 58.76);
  });

  it("gathers the dotted variants onto the one line", () => {
    const bf = plan.lines.find((l) => l.name === "Brilliant Fantasy pack")!;
    assert.equal(bf.now, 3);
    assert.equal(bf.was, 53, "what the app had recorded before");
  });

  it("matches a line whose stored name carries its count", () => {
    const cn = plan.lines.find((l) => l.name === "30th Celebration Booster Pack CN")!;
    assert.equal(cn.now, 1);
  });

  it("names what sold that was never on the set", () => {
    assert.deepEqual(plan.notOnSet.map((m) => [m.sold, m.revenue]), [[1, 11.76]]);
  });

  it("counts the free orders as giveaways rather than spins", () => {
    assert.equal(plan.freeSingles, 1);
  });

  it("leaves a line nothing landed on at zero", () => {
    assert.equal(plan.lines.find((l) => l.name === "Mega Evolution Booster Pack")!.now, 0);
  });
});

// A prefix has to be seen on three paid orders before it reads as the wheel,
// so a one-spin example needs the show padded out around it.
const PAD = "[Sealed] Padding";
const withWheel = (...items: string[]) => [...items, PAD, PAD, PAD].map((i) => spin(i));

describe("the pasted title beats the word match", () => {
  it("tells two lines of the same set apart", () => {
    // on words alone "30th Celebration Booster Pack" is inside "30th
    // Celebration Booster Pack CN", and the longest-name rule would hand the
    // plain English pack's spins to the Chinese one
    const set = [line("30th Celebration Booster Pack", 10), line("30th Celebration Booster Pack CN", 10)];
    const plan = planSetFromShow(withWheel("[Sealed] 30th Celebration Booster Pack"), set);
    assert.equal(plan.lines.find((l) => l.name === "30th Celebration Booster Pack")!.now, 1);
    assert.equal(plan.lines.find((l) => l.name === "30th Celebration Booster Pack CN")!.now, 0);
  });

  it("falls back to the word match for a title nobody pasted", () => {
    // old shows, and listings typed by hand during a show
    const set: SetLine[] = [{ id: "l1", name: "Brilliant Fantasy pack", qty: 10, qtyHit: 0 }];
    const plan = planSetFromShow(withWheel("CN BRILLIANT FANTASY PACK GREAT ODDS"), set);
    assert.equal(plan.lines[0].now, 1);
  });

  it("does not let a line's plain name take a title another line was listed under", () => {
    const set: SetLine[] = [
      { id: "l1", name: "[Sealed] Perfect Order", qty: 1, qtyHit: 0 },
      { id: "l2", name: "Perfect Order", qty: 1, qtyHit: 0, exportTitle: "[Sealed] Perfect Order" },
    ];
    const plan = planSetFromShow(withWheel("[Sealed] Perfect Order"), set);
    assert.equal(plan.lines.find((l) => l.lineId === "l2")!.now, 1);
    assert.equal(plan.lines.find((l) => l.lineId === "l1")!.now, 0);
  });

  it("reports more hit than was on the set rather than hiding it", () => {
    const set = [line("Brilliant Fantasy pack", 2)];
    const plan = planSetFromShow(
      withWheel(...Array.from({ length: 3 }, (_, i) => `[Sealed] Brilliant Fantasy pack${".".repeat(i)}`)),
      set,
    );
    assert.deepEqual(plan.over, [{ name: "Brilliant Fantasy pack", sold: 3, onSet: 2 }]);
    assert.equal(plan.lines[0].now, 2, "capped at what was on the set");
  });
});
