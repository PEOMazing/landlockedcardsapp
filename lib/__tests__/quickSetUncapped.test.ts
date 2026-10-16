import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateQuickSet, type Candidate } from "../quickSet";

// sl-v2. A slab is allowed to be bigger than the set.
//
// maxItemPct caps any one item at 12% of set value, which is the right rule
// for stock that is interchangeable with cheaper stock: without it one dear
// item swallows a wheel that was supposed to have eleven prizes on it. A slab
// is not interchangeable - it IS the show - and the call is that a $1,000 slab
// on a $900 set is fine.
//
// The exemption has to survive BOTH passes to mean anything, which is the part
// worth testing. The fill picks from what is eligible; the swap-down pass then
// trades spots away to get back inside the value budget, and it used to pick
// the dearest thing on the board, which is by definition the slab. Exempting
// the cap and not the swap would have changed nothing at all.

// $2, because the filler tier is sealed stock priced under $3. A $4 pack fits
// no band in DEFAULT_TIERS at all - it is above filler and below midSealed -
// and a pool of them fills nothing, which is how the first draft of this file
// came to blame the code for an empty set.
const pack = (i: number): Candidate => ({
  id: `pack${i}`, kind: "sealed", name: `Pack ${i}`, value: 2, available: 50, category: "Packs",
});
const slab = (value: number): Candidate => ({
  id: "slab1", kind: "single", name: "PSA 10 Charizard", value, available: 1, uncapped: true,
});
const rawSingle = (value: number): Candidate => ({
  id: "raw1", kind: "single", name: "NM Charizard", value, available: 1,
});

// 100 spots at the default $6.20 is a $620 budget, so the 12% cap is ~$74.
const OPTS = { spots: 100, seed: 7, cooldownShows: 0 };
const pool = (extra: Candidate[]) => [...Array.from({ length: 20 }, (_, i) => pack(i)), ...extra];

describe("the value cap", () => {
  it("still applies to a raw single", () => {
    // Unchanged behaviour, pinned so the exemption cannot leak.
    const s = generateQuickSet(pool([rawSingle(900)]), OPTS);
    assert.equal(s.picks.some((p) => p.id === "raw1"), false);
    assert.ok(s.warnings.some((w) => /worth more than 12%/.test(w)), s.warnings.join(" | "));
  });

  it("does not apply to a slab", () => {
    const s = generateQuickSet(pool([slab(900)]), OPTS);
    assert.equal(s.picks.some((p) => p.id === "slab1"), true, "the slab should be on the board");
  });

  it("does not count an uncapped item as skipped for being too big", () => {
    const s = generateQuickSet(pool([slab(900)]), OPTS);
    assert.equal(s.warnings.some((w) => /worth more than 12%/.test(w)), false);
  });
});

describe("the swap-down pass", () => {
  it("does not evict the slab to get back inside budget", () => {
    // The trap. The slab is the dearest pick by a wide margin, so a swap pass
    // that just takes the dearest would hand it straight back.
    const s = generateQuickSet(pool([slab(1000)]), OPTS);
    assert.equal(s.picks.some((p) => p.id === "slab1"), true, "the slab was swapped away");
  });

  it("says how far over budget the slab put the set, and names it", () => {
    const s = generateQuickSet(pool([slab(1000)]), OPTS);
    const note = s.warnings.find((w) => /Over budget by/.test(w));
    assert.ok(note, s.warnings.join(" | "));
    assert.match(note!, /PSA 10 Charizard/);
  });

  it("does not cost the set any spots", () => {
    // The invariant that matters, stated against a baseline rather than a
    // fixed number: what the tiers can fill from a given pool is the pool's
    // business, but adding a slab must not SHRINK it. A swap pass that evicted
    // spots to pay for the slab would show up right here.
    const withSlab = generateQuickSet(pool([slab(1000)]), OPTS);
    const without = generateQuickSet(pool([]), OPTS);
    assert.ok(withSlab.spots >= without.spots,
      `${withSlab.spots} spots with the slab against ${without.spots} without it`);
  });

  it("does not spin forever when only protected picks remain", () => {
    // One enormous slab and nothing to trade down to. The swap loop has to
    // stop rather than iterate to its ceiling achieving nothing.
    //
    // 10 spots, not 1: the prize tier's share is 10%, so a one spot set rounds
    // its prize allocation to zero and the slab is never reached at all.
    const s = generateQuickSet([slab(5000)], { spots: 10, seed: 7, cooldownShows: 0 });
    assert.equal(s.picks.length, 1);
    assert.equal(s.picks[0].id, "slab1");
  });

  it("a set with no slab in it is unchanged", () => {
    // Regression guard: the uncapped path must not alter the ordinary case.
    const s = generateQuickSet(pool([]), OPTS);
    assert.ok(s.spots > 0);
    assert.equal(s.warnings.some((w) => /Over budget by/.test(w)), false);
  });
});

describe("what the set reports about it", () => {
  it("counts the slab toward the hit pool", () => {
    const s = generateQuickSet(pool([slab(900)]), { ...OPTS, hitThreshold: 10 });
    assert.ok(s.hitPoolValue >= 900, `hit pool was ${s.hitPoolValue}`);
  });

  it("names the slab as the biggest thing on the board", () => {
    const s = generateQuickSet(pool([slab(900)]), OPTS);
    assert.equal(s.biggest?.name, "PSA 10 Charizard");
  });
});
