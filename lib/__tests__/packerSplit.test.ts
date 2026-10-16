import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildManagerPay, streamPackingCost, StreamRow } from "../calc";
import type { Settings } from "../settings";

// pk-v5. The packer, the manager of record and the override earner are three
// people doing three jobs. For most of this app's life the first two shared one
// field, so the only way to pay somebody for packing was to also make them
// manager of the show - which carries access to it and puts them in the
// reporting. These tests exist to keep those three apart.

const S = {
  packing_rate: 15, packing_fee: 35, support_pct: 0.1, breakeven_mult: 1.5,
  tier1_limit: 500, tier1_rate: 0.15, tier2_limit: 1000, tier2_rate: 0.2,
  tier3_rate: 0.25, default_hourly_rate: 20, hit_threshold: 10,
  giveaway_cost: 2.5, singles_giveaway_cost: 1, commission_pct: 0.2,
} as unknown as Settings;

const ALYSSA = "recU4JPUIdVhKmaqv";
const GABE = "recc3N0PaPCIDvAOg";
const DESTINEE = "recO44KNenVpkG04V";

const row = (over: Partial<StreamRow> = {}): StreamRow => ({
  id: "rec1", title: "Show", date: "2026-10-05", streamerId: DESTINEE, streamerName: "Destinee",
  afterFees: 1000, promotion: 0, tips: 0, giveaways: 0, singlesGiveaways: 0,
  hours: 4, packingHours: 0, managerPackingHours: 0,
  packerId: null, managerId: null, productCost: 200, productMarketCost: 400,
  status: "Complete", ...over,
});

describe("packing pay follows the packer, not the manager of record", () => {
  it("pays the packer on a show somebody else manages", () => {
    // the case that started this: Alyssa packed ten of Gabe's shows
    const out = buildManagerPay(
      [row({ packingFee: 35, packerId: ALYSSA, managerId: GABE })],
      S, {}, { [ALYSSA]: "Alyssa", [GABE]: "Gabe" }, { [ALYSSA]: 20, [DESTINEE]: 20 },
    );
    const alyssa = out.find((m) => m.managerId === ALYSSA);
    assert.ok(alyssa, "the packer should be paid");
    assert.equal(alyssa!.packingPay, 35);
    assert.equal(alyssa!.flatPacked, 1);
    // and the manager of record earns nothing for holding the record
    assert.equal(out.find((m) => m.managerId === GABE), undefined);
  });

  it("pays nobody when a show has a fee but no packer", () => {
    // the fee is owed to a person. A show nobody packed cost nothing, and the
    // manager of record must not pick it up by default.
    const out = buildManagerPay(
      [row({ packingFee: 35, packerId: null, managerId: GABE })],
      S, {}, { [GABE]: "Gabe" }, { [DESTINEE]: 20 },
    );
    assert.deepEqual(out, []);
    assert.equal(streamPackingCost({ packingFee: 35, packerId: null }, S), 0);
  });

  it("adds up a week of flat shows for one packer", () => {
    const streams = Array.from({ length: 10 }, (_, i) =>
      row({ id: `rec${i}`, date: "2026-10-05", packingFee: 35, packerId: ALYSSA, managerId: GABE }));
    const out = buildManagerPay(streams, S, {}, { [ALYSSA]: "Alyssa" }, { [ALYSSA]: 20, [DESTINEE]: 20 });
    assert.equal(out.length, 1);
    assert.equal(out[0].packingPay, 350);
    assert.equal(out[0].packedCount, 10);
    assert.equal(out[0].flatPacked, 10);
    // a flat week has no hours in it, and quoting an hourly rate on one is how
    // "0.0h at $15/h" ends up printed next to $350
    assert.equal(out[0].packingHours, 0);
  });

  it("still pays an old hourly show by the hour, to its own packer", () => {
    const out = buildManagerPay(
      [row({ packingFee: null, packingRate: 20, managerPackingHours: 2, packerId: ALYSSA, managerId: GABE })],
      S, {}, { [ALYSSA]: "Alyssa" }, { [ALYSSA]: 20, [DESTINEE]: 20 },
    );
    assert.equal(out[0].managerId, ALYSSA);
    assert.equal(out[0].packingPay, 40);
  });

  it("leaves an incomplete show out, fee or no fee", () => {
    const out = buildManagerPay(
      [row({ status: "Planned", packingFee: 35, packerId: ALYSSA })],
      S, {}, { [ALYSSA]: "Alyssa" }, { [ALYSSA]: 20, [DESTINEE]: 20 },
    );
    assert.deepEqual(out, []);
  });
});

describe("what one show's packing costs the company", () => {
  it("is the fee once a packer is on it", () => {
    assert.equal(streamPackingCost({ packingFee: 35, packerId: ALYSSA }, S), 35);
  });

  it("ignores the manager of record entirely", () => {
    // no packerId, so no cost - even though a manager is sitting on the show.
    // This is the all-streams Payroll column and the stream P&L agreeing with
    // payroll instead of each inventing their own answer.
    assert.equal(streamPackingCost({ packingFee: 35 } as any, S), 0);
  });

  it("ignores stray clocked hours on a flat show", () => {
    assert.equal(
      streamPackingCost(
        { packingFee: 35, packerId: ALYSSA, packingHours: 3, managerPackingHours: 2, packingRate: 15 }, S),
      35,
    );
  });
});
