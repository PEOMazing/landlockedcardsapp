import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { cardNoOf, withoutCardNo, matchesSetQuery, keepSetLine, groupKeyOf, groupSetRows, groupTotals, type SetLineish } from "../setFilter";

// The real shapes off a wheel, because the whole point of this filter is the
// case where every row reads the same.
const leaf = (slot: number, qtyHit = 0): SetLineish => ({
  name: `[${String(slot).padStart(4, "0")}] NM Leafeon - 170 (Cosmos Holo) #170 SV: Scarlet & Violet Promo Cards`,
  qty: 1,
  qtyHit,
  slot,
  singleRecId: `rec${slot}`,
});
const packs: SetLineish = { name: "Brilliant Fantasy pack", qty: 160, qtyHit: 4, slot: null };
const etb: SetLineish = { name: "30th Celebration Elite Trainer Box", qty: 2, qtyHit: 2, slot: null };

describe("pulling the card number off a line", () => {
  it("reads the slot the API put at the front", () => {
    assert.equal(cardNoOf(leaf(236).name), "0236");
    assert.equal(withoutCardNo(leaf(236).name), "NM Leafeon - 170 (Cosmos Holo) #170 SV: Scarlet & Violet Promo Cards");
  });

  it("leaves sealed product alone", () => {
    assert.equal(cardNoOf(packs.name), "");
    assert.equal(withoutCardNo(packs.name), "Brilliant Fantasy pack");
  });

  it("does not mistake a bracket in the middle of a name for a slot", () => {
    const tin = "Ascended Heroes Tin [Mega Feraligatr ex]";
    assert.equal(cardNoOf(tin), "");
    assert.equal(withoutCardNo(tin), tin);
  });
});

describe("typing at the set", () => {
  it("finds one card out of a run of identical ones", () => {
    const rows = [236, 238, 239, 240, 255, 256].map((n) => leaf(n));
    const hits = rows.filter((l) => matchesSetQuery(l, "0255"));
    assert.equal(hits.length, 1);
    assert.equal(cardNoOf(hits[0].name), "0255");
  });

  it("matches the number the way a person says it, not just the way it prints", () => {
    assert.ok(matchesSetQuery(leaf(236), "236"));
    assert.ok(matchesSetQuery(leaf(236), "0236"));
  });

  it("does not let 236 match 1236 or 2360 by accident of padding", () => {
    // The padded form is four digits, so a longer slot keeps its own identity.
    assert.equal(matchesSetQuery(leaf(236), "1236"), false);
  });

  it("every word has to land, so typing more narrows", () => {
    assert.ok(matchesSetQuery(leaf(236), "leafeon cosmos"));
    assert.equal(matchesSetQuery(leaf(236), "leafeon eevee"), false);
  });

  it("ignores word order and case", () => {
    assert.ok(matchesSetQuery(leaf(236), "COSMOS leafeon"));
  });

  it("an empty query keeps everything", () => {
    assert.ok(matchesSetQuery(packs, ""));
    assert.ok(matchesSetQuery(packs, "   "));
  });
});

describe("the kind and still-live switches", () => {
  const all: SetLineish[] = [leaf(236), leaf(238, 1), packs, etb];
  const keep = (o: { kind: any; unhitOnly: boolean; query: string }) => all.filter((l) => keepSetLine(l, o));

  it("singles only drops sealed", () => {
    assert.deepEqual(keep({ kind: "singles", unhitOnly: false, query: "" }).map((l) => cardNoOf(l.name)), ["0236", "0238"]);
  });

  it("sealed only drops singles", () => {
    assert.deepEqual(keep({ kind: "sealed", unhitOnly: false, query: "" }).map((l) => l.name), [packs.name, etb.name]);
  });

  it("still live drops what is fully hit and keeps what is partly hit", () => {
    const live = keep({ kind: "all", unhitOnly: true, query: "" });
    // 0238 is 1 of 1 hit and the ETB is 2 of 2, both gone. The packs are 4 of
    // 160, so they are still very much live.
    assert.deepEqual(live.map((l) => l.name), [leaf(236).name, packs.name]);
  });

  it("the switches and the query combine", () => {
    assert.deepEqual(
      keep({ kind: "singles", unhitOnly: true, query: "leafeon" }).map((l) => cardNoOf(l.name)),
      ["0236"],
    );
  });

  it("all with nothing set keeps the whole set", () => {
    assert.equal(keep({ kind: "all", unhitOnly: false, query: "" }).length, 4);
  });
});

// Collapsing copies. The export path never sees any of this: it maps the raw
// line list, so a card grouped on screen is still its own row in the CSV.
type Row = SetLineish & { id: string; market?: number };
const card = (slot: number, over: Partial<Row> = {}): Row => ({
  id: `rec${slot}`,
  name: `[${String(slot).padStart(4, "0")}] NM Leafeon - 170 (Cosmos Holo) #170 SV: Scarlet & Violet Promo Cards`,
  qty: 1,
  qtyHit: 0,
  slot,
  singleRecId: `sing${slot}`,
  market: 2,
  ...over,
});
const sealed = (id: string, name: string, over: Partial<Row> = {}): Row =>
  ({ id, name, qty: 1, qtyHit: 0, slot: null, market: 10, ...over });

describe("collapsing copies of the same card", () => {
  it("groups copies and leaves everything else alone", () => {
    const rows = [card(236), sealed("p", "Brilliant Fantasy pack", { qty: 160 }), card(238), card(240)];
    const out = groupSetRows(rows);
    assert.deepEqual(out.map((g) => g.kind), ["group", "line"]);
    assert.equal(out[0].kind === "group" && out[0].lines.length, 3);
  });

  it("takes the position of its first member, so the sort still decides order", () => {
    const rows = [sealed("p", "Brilliant Fantasy pack"), card(236), card(238), card(240)];
    const out = groupSetRows(rows);
    assert.deepEqual(out.map((g) => g.kind), ["line", "group"]);
  });

  it("leaves a pair uncollapsed, because two rows are not a scrolling problem", () => {
    const out = groupSetRows([card(236), card(238)]);
    assert.deepEqual(out.map((g) => g.kind), ["line", "line"]);
  });

  it("keeps different conditions and different cards apart", () => {
    const lp = card(999, { name: "[0999] LP Leafeon - 170 (Cosmos Holo) #170 SV: Scarlet & Violet Promo Cards" });
    const out = groupSetRows([card(236), card(238), card(240), lp]);
    assert.deepEqual(out.map((g) => g.kind), ["group", "line"]);
    assert.notEqual(groupKeyOf(lp), groupKeyOf(card(236)));
  });

  it("a high enough minimum collapses nothing, which is how a filtered table stays flat", () => {
    const out = groupSetRows([card(236), card(238), card(240)], Number.MAX_SAFE_INTEGER);
    assert.deepEqual(out.map((g) => g.kind), ["line", "line", "line"]);
  });

  it("totals a group the way the collapsed row reads it", () => {
    const t = groupTotals([card(236, { qtyHit: 1 }), card(238), card(240)]);
    assert.equal(t.qty, 3);
    assert.equal(t.hit, 1);
    assert.equal(t.remain, 2);
    assert.equal(t.market, 2);
    assert.equal(t.samePrice, true);
    assert.equal(t.valueLeft, 4);
  });

  it("flags a group whose copies are priced differently instead of hiding it", () => {
    const t = groupTotals([card(236, { market: 2 }), card(238, { market: 9 }), card(240, { market: 2 })]);
    assert.equal(t.samePrice, false);
    assert.equal(t.valueLeft, 13);
  });

  it("every line survives grouping exactly once", () => {
    const rows = [card(236), card(238), card(240), sealed("p", "Brilliant Fantasy pack"), card(999, { name: "[0999] NM Eevee #116/128 ME: 30th Celebration" })];
    const flat = groupSetRows(rows).flatMap((g) => (g.kind === "line" ? [g.line] : g.lines));
    assert.deepEqual(flat.map((l) => l.id).sort(), rows.map((l) => l.id).sort());
  });
});
