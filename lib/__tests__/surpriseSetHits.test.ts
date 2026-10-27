import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { foldTitle, isStoreSale, planSetFromShow, storeRows, type SetLine, type WhatnotSale } from "../whatnotCsv";

// ss-v1. The 2026-10-22 surprise set show, from its real export.
//
// 265 paid orders, every one of them a spin. 223 of them were read as shelf
// sales, the set recorded 42 hits, and 134 of the "shelf sales" were then
// booked against a single Ultra Premium Collection. The show set was wrong and
// the P&L was carrying $30,000 of product cost that did not exist.
//
// The cause: store sales are guessed from the shape of the title, because the
// per-show export does not say which orders were Buy It Now. That guess
// assumed a wheel listing always carries the show's name in front of the item
// ("BANGERS ALL NIGHT!! - item"). A surprise set show titles its listings with
// the bare product name, so there is no prefix, and "no prefix" fell straight
// through to "store sale".
//
// The set itself answers the question and was never consulted.

const sale = (title: string, price = 15.99, qty = 1, row = 1): WhatnotSale =>
  ({ row, title, description: "", qty, price, date: "", buyer: "", status: "", giveaway: false, showId: "s1", showTitle: "show", orderId: `o${row}${title.length}`, format: "" }) as WhatnotSale;

const line = (name: string, qty: number, i: number): SetLine => ({ id: `rec${i}`, name, qty, qtyHit: 0 });

// The real titles, in the real shapes they came in.
const SET: SetLine[] = [
  ["Gem Volume 6 Pack", 145],
  ["Paradox Veil CSV6 booster pack", 50],
  ["Chasing Glory Booster Pack - Chinese", 50],
  ["Brilliant Fantasy pack", 25],
  ["Mega Charizard X ex Ultra Premium Collection", 1],
].map(([n, q], i) => line(n as string, q as number, i));

describe("a surprise set show, where every paid order is a spin", () => {
  it("does not call a bare product name a shelf sale", () => {
    const s = sale("GEM VOLUME 6 PACK");
    // Without the set, the old guess: no prefix, therefore a store sale.
    assert.equal(isStoreSale(s, false, new Set()), true);
    // With it: the set has a line by that name, so it is a spin.
    assert.equal(isStoreSale(s, false, new Set(), () => true), false);
  });

  it("books all of them as hits and none to the shelf", () => {
    const sales = [
      ...Array.from({ length: 105 }, (_, i) => sale("GEM VOLUME 6 PACK", 15.37, 1, i + 1)),
      ...Array.from({ length: 42 }, (_, i) => sale("PARADOX VEIL CSV6 BOOSTER PACK", 15.14, 1, i + 200)),
      ...Array.from({ length: 17 }, (_, i) => sale("BRILLIANT FANTASY PACK", 14.91, 1, i + 400)),
    ];
    const plan = planSetFromShow(sales, SET);
    assert.equal(plan.toStore.length, 0);
    assert.equal(plan.notOnSet.length, 0);
    assert.equal(plan.spins, 164);
    const hits = Object.fromEntries(plan.lines.map((l) => [SET.find((x) => x.id === l.lineId)!.name, l.now]));
    assert.equal(hits["Gem Volume 6 Pack"], 105);
    assert.equal(hits["Paradox Veil CSV6 booster pack"], 42);
    assert.equal(hits["Brilliant Fantasy pack"], 17);
  });

  it("a product whose own name has a dash in it is not cut in half", () => {
    // spinItem splits on the first " - " to drop a show prefix. This product
    // has one in its name, so stripping leaves "CHINESE", which names nothing
    // and belongs to no set.
    const sales = Array.from({ length: 42 }, (_, i) => sale("CHASING GLORY BOOSTER PACK - CHINESE", 15.41, 1, i + 1));
    const plan = planSetFromShow(sales, SET);
    assert.equal(plan.notOnSet.length, 0);
    assert.equal(plan.lines.find((l) => l.lineId === "rec2")!.now, 42);
  });

  it("still drops a real show prefix", () => {
    const sales = Array.from({ length: 5 }, (_, i) =>
      sale("WHATNOTS CRAZIEST RESTOCK - GEM VOLUME 6 PACK", 15.99, 1, i + 1));
    const plan = planSetFromShow(sales, SET);
    assert.equal(plan.lines.find((l) => l.lineId === "rec0")!.now, 5);
  });

  it("a genuine shelf sale is still a shelf sale", () => {
    // Nothing on the set by this name, and no wheel prefix either.
    const sales = [...Array.from({ length: 5 }, (_, i) => sale("GEM VOLUME 6 PACK", 15.99, 1, i + 1)), sale("POKEMON KEYCHAIN", 8, 1, 99)];
    assert.equal(storeRows(sales, (t) => /GEM VOLUME/.test(t)).rows.length, 1);
  });

  it("the earnings report's own Buy It Now column still wins", () => {
    // When Whatnot tells us outright, nothing is guessed and the set does not
    // get to overrule it.
    const s = { ...sale("GEM VOLUME 6 PACK"), format: "BUY_IT_NOW" } as WhatnotSale;
    assert.equal(isStoreSale(s, true, undefined, () => true), true);
  });

  it("giveaways are never shelf sales, set or no set", () => {
    const s = { ...sale("BOOKMARK ALL FUTURE STREAMS!! FREE POKEMON CARD(S)! #1", 0), giveaway: true } as WhatnotSale;
    assert.equal(isStoreSale(s, false, new Set(), () => false), false);
  });
});

describe("titles that say the same thing a different way", () => {
  const sale2 = (title: string, row: number): WhatnotSale =>
    ({ row, title, description: "", qty: 1, price: 15.99, date: "", buyer: "", status: "", giveaway: false, showId: "s1", showTitle: "show", orderId: `o${row}`, format: "" }) as WhatnotSale;

  it("a keycap emoji does not leave its digit behind", () => {
    // 3️⃣ is the ASCII "3" plus a variation selector plus U+20E3, so a strip
    // that keeps digits keeps the 3. Six listings on the 2026-10-22 set were
    // lost to exactly this, and the 🔥-wrapped ones beside them were fine.
    assert.equal(foldTitle("3️⃣0️⃣30TH CELEBRATION POSTER COLLECTION3️⃣0️⃣"), foldTitle("30th Celebration Poster Collection"));
    assert.equal(foldTitle("🔥PITCH BLACK BOOSTER BUNDLE🔥"), foldTitle("Pitch Black Booster Bundle"));
  });

  it("books the emoji-wrapped listings as hits", () => {
    const set = [line("30th Celebration Poster Collection", 1, 0), line("30th Celebration Elite Trainer Box", 2, 1)];
    const plan = planSetFromShow(
      [sale2("3️⃣0️⃣30TH CELEBRATION POSTER COLLECTION3️⃣0️⃣", 1), sale2("3️⃣0️⃣30TH CELEBRATION ELITE TRAINER BOX3️⃣0️⃣", 2)],
      set,
    );
    assert.equal(plan.notOnSet.length, 0);
    assert.equal(plan.lines.find((l) => l.lineId === "rec0")!.now, 1);
    assert.equal(plan.lines.find((l) => l.lineId === "rec1")!.now, 1);
  });

  it("matches the same words in a different order", () => {
    // "CHINESE STELLAR CRYSTAL BOOSTER PACK" on Whatnot, "Stellar Crystal
    // Booster Pack - Chinese" on the set. 33 spins on one show.
    const set = [line("Stellar Crystal Booster Pack - Chinese", 50, 0)];
    const sales = Array.from({ length: 33 }, (_, i) => sale2("CHINESE STELLAR CRYSTAL BOOSTER PACK", i + 1));
    const plan = planSetFromShow(sales, set);
    assert.equal(plan.notOnSet.length, 0);
    assert.equal(plan.lines[0].now, 33);
  });

  it("refuses to guess when two lines share the same bag of words", () => {
    // Same words, two different products. Reordering must not pick one at
    // random: 33 hits on the wrong line is worse than 33 hits on no line,
    // because nobody goes looking for a number that already looks right.
    const set = [
      line("Chinese Stellar Crystal Booster Pack", 10, 0),
      line("Stellar Crystal Booster Pack Chinese", 10, 1),
    ];
    const plan = planSetFromShow([sale2("STELLAR CHINESE CRYSTAL PACK BOOSTER", 1)], set);
    assert.equal(plan.lines.every((l) => l.now === 0), true);
  });

  it("an exact title still beats a reordered one", () => {
    const set = [line("Booster Pack Chinese", 5, 0), line("Chinese Booster Pack", 5, 1)];
    const plan = planSetFromShow([sale2("CHINESE BOOSTER PACK", 1)], set);
    assert.equal(plan.lines.find((l) => l.lineId === "rec1")!.now, 1);
    assert.equal(plan.lines.find((l) => l.lineId === "rec0")!.now, 0);
  });
});
