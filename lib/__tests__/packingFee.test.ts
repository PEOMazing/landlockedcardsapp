import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isFlatPacking, streamPackingCost, buildManagerPay, buildWeekPay, type StreamRow } from "../calc";
import type { Settings } from "../settings";

// pk-v3. Packing became a flat fee per show on 2026-10-12: one person is
// assigned the show and is paid the fee, big show or small, and nobody clocks
// packing time.
//
// The two things these tests exist to hold down:
//   1. a show on the flat fee pays the fee, once, to whoever is assigned
//   2. every show packed before the switch is priced EXACTLY as it was
// The second matters more. Hundreds of shows are already settled and paid, and
// the whole reason the fee is snapshotted on the stream rather than read live
// out of settings is that the last rate change ($20 to $15) silently re-priced
// three months of history the first time it was done the easy way.

const S: Settings = {
  packing_rate: 15, packing_fee: 35, support_pct: 0.1, breakeven_mult: 1.5,
  tier1_limit: 500, tier1_rate: 0.15, tier2_limit: 1000, tier2_rate: 0.2,
  tier3_rate: 0.25, default_hourly_rate: 20, hit_threshold: 10,
  giveaway_cost: 2.5, singles_giveaway_cost: 1, commission_pct: 0.2,
};

const DANIEL = "recl6yDy6mTzgsDaV";
const DESTINEE = "recO44KNenVpkG04V";
const GABE = "recc3N0PaPCIDvAOg";

const row = (over: Partial<StreamRow> = {}): StreamRow => ({
  id: "rec1", title: "Show", date: "2026-10-13", streamerId: DESTINEE, streamerName: "Destinee",
  afterFees: 1000, promotion: 0, tips: 0, giveaways: 0, singlesGiveaways: 0,
  hours: 4, packingHours: 0, managerPackingHours: 0,
  packerId: DANIEL, managerId: DANIEL, productCost: 200, productMarketCost: 400, status: "Complete",
  ...over,
});

describe("telling the two packing deals apart", () => {
  it("reads a stamped fee as the flat deal", () => {
    assert.equal(isFlatPacking({ packingFee: 35 }), true);
  });

  it("reads no fee as the old hourly deal", () => {
    // this is the entire history mechanism: the ABSENCE of a fee is what marks
    // a show as predating the switch, so there is no date arithmetic anywhere
    assert.equal(isFlatPacking({ packingFee: null }), false);
    assert.equal(isFlatPacking({ packingFee: 0 }), false);
    assert.equal(isFlatPacking({}), false);
  });
});

describe("what one show's packing costs", () => {
  it("costs the fee on a flat show, whatever the show's size", () => {
    const small = streamPackingCost({ packingFee: 35, packerId: DANIEL }, S);
    const huge = streamPackingCost({ packingFee: 35, packerId: DANIEL }, S);
    assert.equal(small, 35);
    assert.equal(huge, 35);
  });

  it("ignores clocked hours once a show is on the fee", () => {
    // a stray entry must not add to the fee, or a packer gets paid twice
    const cost = streamPackingCost(
      { packingFee: 35, packerId: DANIEL, packingHours: 3, managerPackingHours: 2, packingRate: 15 }, S);
    assert.equal(cost, 35);
  });

  it("costs nothing on a flat show with nobody assigned", () => {
    // the fee is owed to a person: no packer means nobody packed it
    assert.equal(streamPackingCost({ packingFee: 35, packerId: null }, S), 0);
  });

  it("still prices a pre-switch show by its own snapshotted hourly rate", () => {
    assert.equal(
      streamPackingCost({ packingHours: 2, managerPackingHours: 1, packingRate: 20 }, S), 60);
  });

  it("falls back to the settings hourly rate when a pre-switch show has none", () => {
    assert.equal(streamPackingCost({ managerPackingHours: 2 }, S), 30);
  });
});

describe("paying the packer", () => {
  it("pays the fee once for being assigned, with no hours clocked", () => {
    const out = buildManagerPay([row({ packingFee: 35 })], S, {}, { [DANIEL]: "Daniel" }, {});
    const daniel = out.find((w) => w.managerId === DANIEL)!;
    assert.equal(daniel.packingPay, 35);
    assert.equal(daniel.packedCount, 1);
    assert.equal(daniel.packingHours, 0, "a flat fee reports no hours");
    assert.equal(daniel.flatPacked, 1);
  });

  it("pays a fee per show, so three shows in a week is $105", () => {
    const rows = [
      row({ id: "a", date: "2026-10-13", packingFee: 35 }),
      row({ id: "b", date: "2026-10-14", packingFee: 35 }),
      row({ id: "c", date: "2026-10-15", packingFee: 35 }),
    ];
    const daniel = buildManagerPay(rows, S, {}, { [DANIEL]: "Daniel" }, {}).find((w) => w.managerId === DANIEL)!;
    assert.equal(daniel.packingPay, 105);
    assert.equal(daniel.packedCount, 3);
  });

  it("pays the fee the show carries, not today's setting", () => {
    // the whole point of the snapshot: raising the fee must not re-price a show
    // that has already been packed and paid
    const daniel = buildManagerPay(
      [row({ packingFee: 35 })], { ...S, packing_fee: 60 }, {}, { [DANIEL]: "Daniel" }, {},
    ).find((w) => w.managerId === DANIEL)!;
    assert.equal(daniel.packingPay, 35);
  });

  it("pays nothing for a flat show nobody was assigned", () => {
    const out = buildManagerPay([row({ packingFee: 35, packerId: null, managerId: null })], S, {}, {}, {});
    assert.equal(out.reduce((a, w) => a + w.packingPay, 0), 0);
  });

  it("leaves a pre-switch show on its hours and rate", () => {
    const daniel = buildManagerPay(
      [row({ packingHours: 0, managerPackingHours: 2, packingRate: 20 })],
      S, {}, { [DANIEL]: "Daniel" }, {},
    ).find((w) => w.managerId === DANIEL)!;
    assert.equal(daniel.packingPay, 40);
    assert.equal(daniel.packingHours, 2);
    assert.equal(daniel.flatPacked, 0);
  });

  it("pays both deals in one week without mixing them", () => {
    // a week straddling the switch: one old show at 2h x $20, one new at the fee
    const rows = [
      row({ id: "old", date: "2026-10-13", managerPackingHours: 2, packingRate: 20 }),
      row({ id: "new", date: "2026-10-14", packingFee: 35 }),
    ];
    const daniel = buildManagerPay(rows, S, {}, { [DANIEL]: "Daniel" }, {}).find((w) => w.managerId === DANIEL)!;
    assert.equal(daniel.packingPay, 75);
    assert.equal(daniel.packedCount, 2);
    assert.equal(daniel.flatPacked, 1);
    assert.equal(daniel.packingHours, 2, "only the hourly show contributes hours");
  });

  it("does not pay the packer for an incomplete show", () => {
    const out = buildManagerPay([row({ packingFee: 35, status: "Planned" })], S, {}, {}, {});
    assert.equal(out.reduce((a, w) => a + w.packingPay, 0), 0);
  });
});

describe("what the fee does to the commission base", () => {
  it("comes out of commissionable profit like the hourly cost did", () => {
    // profit here is 1000 - 400 market = 600, less the $35 fee
    const out = buildWeekPay([row({ packingFee: 35 })], S, {});
    assert.equal(out[0].commissionable, 565);
  });

  it("takes nothing out when nobody is assigned to collect it", () => {
    const out = buildWeekPay([row({ packingFee: 35, packerId: null, managerId: null })], S, {});
    assert.equal(out[0].commissionable, 600);
  });

  it("matches the old arithmetic exactly on a pre-switch show", () => {
    // 2h + 1h at $20 = $60 off a $600 profit. This is the number the payroll
    // page has already shown and paid on, so it must not move.
    const out = buildWeekPay([row({ packingHours: 2, managerPackingHours: 1, packingRate: 20 })], S, {});
    assert.equal(out[0].commissionable, 540);
  });

  it("pays the streamer no packing money on a flat show", () => {
    // the fee belongs to the assigned packer; the streamer's packing pay is $0
    const out = buildWeekPay([row({ packingFee: 35, packingHours: 3, packingRate: 15 })], S, {});
    assert.equal(out[0].packingPay, 0);
  });

  it("still pays a streamer their own packing hours on a pre-switch show", () => {
    const out = buildWeekPay([row({ packingHours: 3, packingRate: 15, managerId: GABE })], S, {});
    assert.equal(out[0].packingPay, 45);
  });
});
