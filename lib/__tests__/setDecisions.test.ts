import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { foldTitle, looksGeneric, planSetFromShow, type SetLine, type WhatnotSale } from "../whatnotCsv";

// sd-v1. The not-on-set warning used to be a dead end: it listed what it could
// not place and told you to go add it to the set and upload the report again.
// Now each one can be pointed at the thing it really is - a line on the set
// whose listing was titled differently, or an inventory item that sold off the
// shelf - and the decision can be remembered so the same title matches itself
// next week.

const SHOW = "BANGERS ALL NIGHT";
const sale = (item: string, over: Partial<WhatnotSale> = {}): WhatnotSale => ({
  row: 2, title: `${SHOW} - ${item}`, description: "", qty: 1, price: 12,
  date: "2026-10-07T23:00:00Z", buyer: "x", status: "", giveaway: false,
  showId: "", showTitle: "", ...over,
});
// three orders share the prefix, so it reads as the wheel
const PAD = [sale("[Sealed] Padding"), sale("[Sealed] Padding"), sale("[Sealed] Padding")];

const line = (id: string, name: string, qty: number, extra: Partial<SetLine> = {}): SetLine =>
  ({ id, name, qty, qtyHit: 0, exportTitle: `[Sealed] ${name}`, ...extra });

describe("leaving a title unanswered", () => {
  const plan = planSetFromShow([sale("MYSTERY BOX THING"), ...PAD], [line("l1", "Brilliant Fantasy pack", 10)]);

  it("still counts the money, because the money came in", () => {
    assert.equal(plan.spins, 4);
    assert.equal(plan.gross, 48);
  });

  it("hands back a stable handle to decide it by", () => {
    const row = plan.notOnSet.find((m) => m.title === "MYSTERY BOX THING")!;
    assert.equal(row.fold, foldTitle("MYSTERY BOX THING"));
    assert.equal(row.sold, 1);
  });
});

describe("mapping it to a line on the set", () => {
  const set = [line("l1", "Brilliant Fantasy pack", 10), line("l2", "Mega Evolution Booster Pack", 5)];
  const sales = [sale("CN BF MYSTERY"), ...PAD];
  const fold = foldTitle("CN BF MYSTERY");

  it("credits the hit to the line that was chosen", () => {
    const plan = planSetFromShow(sales, set, { mapTo: { [fold]: "l1" } });
    assert.equal(plan.lines.find((l) => l.lineId === "l1")!.now, 1);
    assert.equal(plan.lines.find((l) => l.lineId === "l2")!.now, 0);
    assert.deepEqual(plan.notOnSet.map((m) => m.title), ["[Sealed] Padding"]);
  });

  it("leaves spots sold alone, since it was a spin either way", () => {
    const before = planSetFromShow(sales, set);
    const after = planSetFromShow(sales, set, { mapTo: { [fold]: "l1" } });
    assert.equal(after.spins, before.spins);
    assert.equal(after.gross, before.gross);
  });

  it("beats the word match rather than arguing with it", () => {
    // the words say Mega Evolution; the operator says otherwise and wins
    const plan = planSetFromShow(
      [sale("MEGA EVOLUTION SOMETHING"), ...PAD], set,
      { mapTo: { [foldTitle("MEGA EVOLUTION SOMETHING")]: "l1" } },
    );
    assert.equal(plan.lines.find((l) => l.lineId === "l1")!.now, 1);
    assert.equal(plan.lines.find((l) => l.lineId === "l2")!.now, 0);
  });

  it("spreads over a pool when the chosen line shares its name", () => {
    const pool = [line("a", "Brilliant Fantasy pack", 1), line("b", "Brilliant Fantasy pack", 1)];
    const plan = planSetFromShow(
      [sale("ODD ONE"), sale("ODD ONE"), ...PAD], pool,
      { mapTo: { [foldTitle("ODD ONE")]: "a" } },
    );
    assert.deepEqual(plan.lines.map((l) => l.now), [1, 1]);
  });

  it("ignores a decision naming a line that is not on this show", () => {
    const plan = planSetFromShow(sales, set, { mapTo: { [fold]: "recGone" } });
    assert.ok(plan.notOnSet.some((m) => m.fold === fold));
  });
});

describe("sending it to the shelf instead", () => {
  const set = [line("l1", "Brilliant Fantasy pack", 10)];
  const sales = [sale("30th celebration booster bundle - rip only", { price: 95 }), ...PAD];
  const fold = foldTitle("30th celebration booster bundle - rip only");

  it("takes it out of spots sold and out of spin sales", () => {
    const plan = planSetFromShow(sales, set, { asStore: { [fold]: "recProd" } });
    assert.equal(plan.spins, 3, "the three padding spins only");
    assert.equal(plan.gross, 36, "the $95 is not spin money");
  });

  it("hands it over ready to book, with the product it was mapped to", () => {
    const plan = planSetFromShow(sales, set, { asStore: { [fold]: "recProd" } });
    assert.equal(plan.toStore.length, 1);
    const r = plan.toStore[0];
    assert.equal(r.title, "30th celebration booster bundle - rip only");
    assert.equal(r.units, 1);
    assert.equal(r.price, 95);
    assert.equal(r.productId, "recProd");
    assert.equal(plan.notOnSet.find((m) => m.fold === fold), undefined);
  });

  it("keeps each Whatnot order on its own, so a re-upload cannot double book", () => {
    const plan = planSetFromShow(
      [
        sale("BUNDLE", { price: 95, orderId: "111" }),
        sale("BUNDLE", { price: 85.5, orderId: "222" }),
        ...PAD,
      ],
      set,
      { asStore: { [foldTitle("BUNDLE")]: "recProd" } },
    );
    assert.deepEqual(plan.toStore[0].orders, [
      { orderId: "111", units: 1, price: 95 },
      { orderId: "222", units: 1, price: 85.5 },
    ]);
  });

  it("gathers several orders of the same listing into one store row", () => {
    const plan = planSetFromShow(
      [sale("BUNDLE", { price: 95 }), sale("BUNDLE", { price: 85.5 }), ...PAD], set,
      { asStore: { [foldTitle("BUNDLE")]: "recProd" } },
    );
    assert.deepEqual(plan.toStore[0].units, 2);
    assert.equal(plan.toStore[0].price, 180.5);
    assert.equal(plan.spins, 3);
  });

  it("never marks a hit on the set for it", () => {
    const plan = planSetFromShow(sales, set, { asStore: { [fold]: "recProd" } });
    assert.equal(plan.lines[0].now, 0);
  });
});

describe("a title that was remembered on an earlier show", () => {
  it("matches itself with no decision needed", () => {
    const set = [line("l1", "Brilliant Fantasy pack", 10, { aliases: ["CN BF MYSTERY"] })];
    const plan = planSetFromShow([sale("CN BF MYSTERY"), ...PAD], set);
    assert.equal(plan.lines[0].now, 1);
    assert.deepEqual(plan.notOnSet.map((m) => m.title), ["[Sealed] Padding"]);
  });

  it("survives the dots and capitals Whatnot adds", () => {
    const set = [line("l1", "Brilliant Fantasy pack", 10, { aliases: ["CN BF Mystery"] })];
    const plan = planSetFromShow([sale("CN BF MYSTERY.."), ...PAD], set);
    assert.equal(plan.lines[0].now, 1);
  });

  it("does not let an alias outrank a line's real pasted title", () => {
    // if one line was genuinely listed under this title, the line that merely
    // remembers it must not steal the hit
    const set = [
      line("real", "Mega Evolution Booster Pack", 5),
      line("alias", "Brilliant Fantasy pack", 10, { aliases: ["[Sealed] Mega Evolution Booster Pack"] }),
    ];
    const plan = planSetFromShow([sale("[Sealed] Mega Evolution Booster Pack"), ...PAD], set);
    assert.equal(plan.lines.find((l) => l.lineId === "real")!.now, 1);
    assert.equal(plan.lines.find((l) => l.lineId === "alias")!.now, 0);
  });

  it("ignores blank alias lines", () => {
    const set = [line("l1", "Brilliant Fantasy pack", 10, { aliases: ["", "  "] })];
    const plan = planSetFromShow([sale("WHATEVER"), ...PAD], set);
    assert.ok(plan.notOnSet.some((m) => m.title === "WHATEVER"));
  });
});

describe("which titles are safe to remember", () => {
  // A break does not put products on the wheel, it puts shares: an energy
  // type, a team, a numbered spot. Those words come back every show meaning a
  // different box, so remembering one would hijack the next break that used
  // it. They are still mappable for the show in hand.
  it("treats a bare slot name as too generic", () => {
    for (const t of ["ENERGY", "PSYCHIC", "Fire", "RANDOM", "Slot", "team"]) {
      assert.equal(looksGeneric(t), true, t);
    }
  });

  it("treats two slot words together as generic too", () => {
    assert.equal(looksGeneric("PSYCHIC ENERGY"), true);
    assert.equal(looksGeneric("random spot"), true);
  });

  it("treats a bare number or a numbered spot as generic", () => {
    for (const t of ["#1", "SLOT 3", "12", "  #27  "]) {
      assert.equal(looksGeneric(t), true, t);
    }
  });

  it("does not call a real product name generic", () => {
    for (const t of [
      "[Sealed] Brilliant Fantasy pack",
      "30th Celebration Booster Pack CN",
      "Prismatic Evolutions Elite Trainer Box",
      "Mega Evolution Pokemon Center [Mega Lucario]",
    ]) assert.equal(looksGeneric(t), false, t);
  });

  it("sees past the condition bracket rather than counting it as a word", () => {
    // "[Sealed] ENERGY" is still just ENERGY
    assert.equal(looksGeneric("[Sealed] ENERGY"), true);
    assert.equal(looksGeneric("[0236] Leafeon"), true, "one real word");
  });

  it("calls an empty title generic rather than offering to remember nothing", () => {
    assert.equal(looksGeneric(""), true);
    assert.equal(looksGeneric("   "), true);
    assert.equal(looksGeneric("[Sealed]"), true);
  });
});

describe("a break where every slot is a share of one box", () => {
  it("maps many slot names onto the same line and counts every spin", () => {
    const set = [line("box", "Mega Evolution Booster Box", 36)];
    const slots = ["ENERGY", "PSYCHIC", "FIRE", "WATER", "GRASS"];
    const sales = [...slots.map((s) => sale(s, { price: 10 })), ...PAD];
    const mapTo = Object.fromEntries(slots.map((s) => [foldTitle(s), "box"]));
    const plan = planSetFromShow(sales, set, { mapTo });
    assert.equal(plan.lines[0].now, 5, "five shares sold");
    assert.equal(plan.spins, 8, "the five slots plus the three padding spins");
    assert.deepEqual(plan.notOnSet.map((m) => m.title), ["[Sealed] Padding"]);
  });
});
