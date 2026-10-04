import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { generateQuickSet, pullList, DEFAULT_TIERS, type Candidate } from "../quickSet";

// A shelf shaped like the real one, measured 2026-10-04:
//   raw singles  760 cards  $22,384   mostly $1-3, a long tail up to $250+
//   sealed     1,108 units  $21,216   708 of them loose packs under $3
//   slabs         37 cards  $19,499   every one $50+, 18 of them around $900
// The slabs are not in this pool at all; they are not wheel stock.
function shelf(): Candidate[] {
  const out: Candidate[] = [];
  const add = (n: number, f: (i: number) => Candidate) => { for (let i = 0; i < n; i++) out.push(f(i)); };
  add(340, (i) => ({ id: `s-low-${i}`, kind: "single", name: `Low single ${i}`, value: 2, available: 1, slot: 100 + i }));
  add(136, (i) => ({ id: `s-mid-${i}`, kind: "single", name: `Mid single ${i}`, value: 4.5, available: 1, slot: 500 + i }));
  add(64, (i) => ({ id: `s-hi-${i}`, kind: "single", name: `Good single ${i}`, value: 15, available: 1, slot: 700 + i }));
  add(51, (i) => ({ id: `s-prize-${i}`, kind: "single", name: `Prize single ${i}`, value: 35, available: 1, slot: 800 + i }));
  add(14, (i) => ({ id: `s-huge-${i}`, kind: "single", name: `Chase single ${i}`, value: 400, available: 1, slot: 900 + i }));
  out.push({ id: "p-pack", kind: "sealed", name: "Brilliant Fantasy pack", value: 2.33, available: 708 });
  out.push({ id: "p-pack2", kind: "sealed", name: "30th Celebration Booster Pack CN", value: 5, available: 148 });
  add(8, (i) => ({ id: `p-mid-${i}`, kind: "sealed", name: `Blister ${i}`, value: 19, available: 10 }));
  add(6, (i) => ({ id: `p-box-${i}`, kind: "sealed", name: `Elite Trainer Box ${i}`, value: 45, available: 5 }));
  add(4, (i) => ({ id: `p-prem-${i}`, kind: "sealed", name: `Premium Collection ${i}`, value: 120, available: 3 }));
  return out;
}

const opts = (over = {}) => ({ spots: 110, valuePerSpot: 6.2, seed: 7, ...over });

describe("generating a set off the shelf", () => {
  it("fills the spots it was asked for", () => {
    const s = generateQuickSet(shelf(), opts());
    assert.ok(s.spots >= 104 && s.spots <= 110, `got ${s.spots} spots`);
  });

  it("lands near the value budget rather than over it", () => {
    const s = generateQuickSet(shelf(), opts());
    const budget = 110 * 6.2;
    assert.ok(s.value <= budget * 1.1, `value ${s.value} over budget ${budget}`);
    assert.ok(s.value >= budget * 0.5, `value ${s.value} suspiciously under budget ${budget}`);
  });

  it("never lets one item carry the show", () => {
    const s = generateQuickSet(shelf(), opts());
    assert.ok(s.biggest, "a set should have a biggest item");
    assert.ok(s.biggest!.pct <= 12.01, `biggest item is ${s.biggest!.pct}% of the set`);
  });

  it("leaves the $400 chase cards alone and says so", () => {
    const s = generateQuickSet(shelf(), opts());
    assert.equal(s.picks.some((p) => p.name.startsWith("Chase single")), false);
    assert.ok(s.warnings.some((w) => /worth more than/.test(w)), s.warnings.join(" | "));
  });

  it("mixes singles and sealed rather than taking the easy route", () => {
    const s = generateQuickSet(shelf(), opts());
    const singles = s.picks.filter((p) => p.kind === "single").reduce((a, p) => a + p.qty, 0);
    const sealed = s.picks.filter((p) => p.kind === "sealed").reduce((a, p) => a + p.qty, 0);
    assert.ok(singles >= 20, `only ${singles} single spots`);
    assert.ok(sealed >= 40, `only ${sealed} sealed spots`);
  });

  it("puts real prizes on the board", () => {
    const s = generateQuickSet(shelf(), opts());
    const prize = s.byTier.find((t) => t.key === "prize")!;
    assert.ok(prize.spots >= 5, `only ${prize.spots} prize spots`);
    assert.ok(s.hitPoolCount >= 10, `hit pool is only ${s.hitPoolCount} items`);
  });

  it("is repeatable on the same seed and different on another", () => {
    const a = generateQuickSet(shelf(), opts());
    const b = generateQuickSet(shelf(), opts());
    const c = generateQuickSet(shelf(), opts({ seed: 99 }));
    assert.deepEqual(a.picks.map((p) => p.id), b.picks.map((p) => p.id));
    assert.notDeepEqual(a.picks.map((p) => p.id), c.picks.map((p) => p.id));
  });

  it("never takes more copies than are on the shelf", () => {
    const s = generateQuickSet(shelf(), opts({ spots: 400 }));
    const byId = new Map<string, number>();
    for (const p of s.picks) byId.set(p.id, (byId.get(p.id) || 0) + p.qty);
    const avail = new Map(shelf().map((c) => [c.id, c.available]));
    for (const [id, q] of byId) assert.ok(q <= avail.get(id)!, `${id}: took ${q} of ${avail.get(id)}`);
  });

  it("skips cards that were on a set too recently", () => {
    const pool = shelf().map((c) => (c.id.startsWith("s-hi-") ? { ...c, lastUsedShowsAgo: 1 } : c));
    const s = generateQuickSet(pool, opts({ cooldownShows: 3 }));
    assert.equal(s.picks.some((p) => p.id.startsWith("s-hi-")), false);
  });

  it("does not put sealed product on cooldown, because packs are interchangeable", () => {
    // Found on the real shelf: packs go up every show by definition, so with
    // the cooldown applied to them every one of the 708 in stock was always
    // inside the window and a 119 spot set came back with 52 spots on it.
    const pool = shelf().map((c) => (c.kind === "sealed" ? { ...c, lastUsedShowsAgo: 0 } : c));
    const s = generateQuickSet(pool, opts({ cooldownShows: 3 }));
    const packs = s.picks.filter((p) => p.id === "p-pack").reduce((a, p) => a + p.qty, 0);
    assert.ok(packs > 30, `only ${packs} pack spots, the floor of the wheel fell out`);
    assert.ok(s.spots >= 104, `only ${s.spots} spots`);
  });

  it("walks down the cheap shelf when the cheapest product runs out", () => {
    // Off the real shelf: the cheapest sealed item was a single $1.08 mini
    // pack. The filler tier took it, and then every value swap asked for a
    // second one, got nothing, and left the spot empty. A 119 spot set came
    // back at 115 with the same complaint printed three times.
    const pool: Candidate[] = [
      ...Array.from({ length: 60 }, (_, i) => ({
        id: `big-${i}`, kind: "single" as const, name: `Big ${i}`, value: 11, available: 1,
      })),
      { id: "cheap-one", kind: "sealed", name: "Last mini pack", value: 0.5, available: 1 },
      { id: "cheap-many", kind: "sealed", name: "Brilliant Fantasy pack", value: 1, available: 500 },
    ];
    const tiers = [
      { key: "mid", label: "Mid", share: 0.5, min: 6, max: 25, kind: "single" as const },
      { key: "filler", label: "Packs", share: 0.5, min: 0, max: 3, kind: "sealed" as const },
    ];
    const s = generateQuickSet(pool, { spots: 50, valuePerSpot: 2, seed: 3, tiers });
    assert.equal(s.spots, 50, `lost spots: ${s.spots}`);
    assert.equal(s.warnings.some((w) => /nothing cheap left/.test(w)), false, s.warnings.join(" | "));
    assert.ok(s.value <= 50 * 2 * 1.1, `value ${s.value} still over budget`);
  });

  it("says what it could not fill instead of quietly handing back a short set", () => {
    const s = generateQuickSet(shelf().filter((c) => c.kind === "single"), opts());
    assert.ok(s.warnings.some((w) => /Packs/.test(w)), s.warnings.join(" | "));
  });

  it("survives an empty shelf", () => {
    const s = generateQuickSet([], opts());
    assert.equal(s.spots, 0);
    assert.equal(s.value, 0);
    assert.equal(s.biggest, null);
    assert.ok(s.warnings.length > 0);
  });
});

describe("the pull list", () => {
  it("walks the binder in slot order and lists sealed by value", () => {
    const s = generateQuickSet(shelf(), opts());
    const { sealed, singles } = pullList(s);
    const slots = singles.map((p) => p.slot ?? 0);
    assert.deepEqual(slots, slots.slice().sort((a, b) => a - b), "singles should be in slot order");
    const vals = sealed.map((p) => p.value);
    assert.deepEqual(vals, vals.slice().sort((a, b) => b - a), "sealed should lead with the big stuff");
  });

  it("accounts for every pick exactly once", () => {
    const s = generateQuickSet(shelf(), opts());
    const { sealed, singles } = pullList(s);
    assert.equal(sealed.length + singles.length, s.picks.length);
  });
});

describe("the default recipe", () => {
  it("adds up to the whole set", () => {
    const total = DEFAULT_TIERS.reduce((a, t) => a + t.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `tier shares sum to ${total}`);
  });

  it("keeps slabs out by construction, since nothing in it asks for them", () => {
    // The pool handed in is built from raw singles and sealed only. This test
    // is the reminder: if a graded card ever reaches the pool, the value cap
    // is the only thing standing between it and the wheel.
    const withSlab: Candidate[] = [...shelf(), { id: "slab", kind: "single", name: "PSA 10 Charizard", value: 900, available: 1 }];
    const s = generateQuickSet(withSlab, opts());
    assert.equal(s.picks.some((p) => p.id === "slab"), false);
  });
});
