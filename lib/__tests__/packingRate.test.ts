import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildManagerPay, buildPersonHours, buildWeekPay, packingRate, streamPackingCost, StreamRow,
} from "../calc";
import type { Settings } from "../settings";

// pr-v2. Packing pay used to read one live rate out of settings, so changing
// the rate re-priced history: dropping $20 to $15 moved 224 already-paid hours
// and made payroll disagree with the money that went out.
//
// The rule as Gabe states it (2026-10-06) is a date, not a person: old shows
// stay at $20, everything forward is $15. So the rate is snapshotted on the
// show, and these tests are written against that sentence.

const S: Settings = {
  packing_rate: 15, support_pct: 0.1, breakeven_mult: 1.5,
  tier1_limit: 500, tier1_rate: 0.15, tier2_limit: 1000, tier2_rate: 0.2,
  tier3_rate: 0.25, default_hourly_rate: 20, hit_threshold: 10,
  giveaway_cost: 3, singles_giveaway_cost: 1, commission_pct: 0.2,
};

const DANIEL = "recDaniel";
const ALYSSA = "recAlyssa";

describe("which rate a show's packing is paid at", () => {
  it("uses the rate stamped on the show", () => {
    assert.equal(packingRate({ packingRate: 20 }, S), 20);
  });

  it("falls back to the current rate when the show has none", () => {
    assert.equal(packingRate({ packingRate: null }, S), 15);
    assert.equal(packingRate({}, S), 15);
  });

  it("treats a zeroed or junk stamp as unstamped rather than paying nothing", () => {
    // Airtable hands back 0 for a currency cell somebody typed into and cleared
    assert.equal(packingRate({ packingRate: 0 }, S), 15);
    assert.equal(packingRate({ packingRate: NaN }, S), 15);
  });

  it("does not move a stamped show when the settings rate changes", () => {
    // the whole point: this is what protects already-paid weeks
    assert.equal(packingRate({ packingRate: 20 }, { ...S, packing_rate: 9 }), 20);
  });
});

describe("what one show's packing costs", () => {
  it("charges both sides of the clock at the show's own rate", () => {
    assert.equal(streamPackingCost({ packingHours: 2, managerPackingHours: 3, packingRate: 20 }, S), 100);
  });

  it("charges an unstamped show at the current rate", () => {
    assert.equal(streamPackingCost({ packingHours: 2, managerPackingHours: 3 }, S), 75);
  });

  it("is zero on a show nobody has packed", () => {
    assert.equal(streamPackingCost({ packingRate: 20 }, S), 0);
    assert.equal(streamPackingCost({ packingHours: null, managerPackingHours: null }, S), 0);
  });
});

const stream = (over: Partial<StreamRow> = {}): StreamRow => ({
  id: "recStream1",
  date: "2026-09-28",
  streamerId: ALYSSA,
  streamerName: "Alyssa",
  afterFees: 1000,
  promotion: 0,
  tips: 0,
  giveaways: 0,
  singlesGiveaways: 0,
  hours: 4,
  packingHours: 0,
  managerPackingHours: 0,
  packingRate: null,
  managerId: DANIEL,
  overrideId: null,
  productCost: 300,
  productMarketCost: 400,
  status: "Complete",
  ...over,
});

describe("packing pay in the weekly settlement", () => {
  it("pays an old show at the rate it was stamped with", () => {
    const [w] = buildWeekPay([stream({ packingHours: 2, packingRate: 20 })], S, {});
    assert.equal(w.packingPay, 40);
    assert.equal(w.packingRate, 20);
  });

  it("pays a new show at the new rate", () => {
    const [w] = buildWeekPay([stream({ packingHours: 2 })], S, {});
    assert.equal(w.packingPay, 30);
    assert.equal(w.packingRate, 15);
  });

  it("charges manager packing to the show at the show's rate", () => {
    const [w] = buildWeekPay([stream({ managerPackingHours: 3, packingRate: 20 })], S, {});
    assert.equal(w.commissionable, 600 - 60);
  });

  it("keeps each side of the cutover on its own rate", () => {
    const rows = [
      stream({ id: "old", date: "2026-10-03", packingHours: 2, packingRate: 20 }),
      stream({ id: "new", date: "2026-10-05", packingHours: 2, packingRate: 15 }),
    ];
    const weeks = buildWeekPay(rows, S, {});
    assert.equal(weeks.find((w) => w.weekStart === "2026-09-28")!.packingPay, 40);
    assert.equal(weeks.find((w) => w.weekStart === "2026-10-05")!.packingPay, 30);
  });

  it("prices one week holding two different rates correctly", () => {
    const rows = [
      stream({ id: "a", date: "2026-10-05", packingHours: 2, packingRate: 20 }),
      stream({ id: "b", date: "2026-10-07", packingHours: 2, packingRate: 15 }),
    ];
    const weeks = buildWeekPay(rows, S, {});
    assert.equal(weeks.length, 1, "both shows are in the Oct 5 week");
    assert.equal(weeks[0].packingPay, 70);
    assert.equal(weeks[0].packingRate, 17.5, "shown as the weighted average");
  });
});

describe("packing pay from the timeclock", () => {
  const entry = (streamId: string, personId: string, hours: number) =>
    ({ streamId, personId, type: "Packing", hours });

  it("prices each clocked hour at the rate of the show it was on", () => {
    const streams = [
      { id: "old", date: "2026-10-05", status: "Complete", managerId: DANIEL, packingRate: 20 },
      { id: "new", date: "2026-10-07", status: "Complete", managerId: DANIEL, packingRate: 15 },
    ];
    const ph = buildPersonHours(streams, [entry("old", "recKara", 2), entry("new", "recKara", 2)], S);
    const own = ph["2026-10-05|recKara"];
    assert.equal(own.packing, 4);
    assert.equal(own.packingPay, 70, "2h at $20 plus 2h at $15");
  });

  it("keeps the manager's own packing out, since buildManagerPay pays it", () => {
    const streams = [{ id: "s", date: "2026-10-05", status: "Complete", managerId: DANIEL, packingRate: 20 }];
    assert.equal(buildPersonHours(streams, [entry("s", DANIEL, 3)], S)["2026-10-05|recDaniel"], undefined);
  });

  it("pays a packer with no shows of their own, at the show's rate", () => {
    const weeks = buildWeekPay([stream({ id: "s", date: "2026-10-05", packingRate: 20 })], S, {}, {
      personHours: { "2026-10-05|recKara": { streaming: 0, packing: 2, packingPay: 40, tips: 0 } },
      namesById: { recKara: "Kara" },
    });
    const kara = weeks.find((w) => w.streamerId === "recKara")!;
    assert.equal(kara.totalPay, 40);
    assert.equal(kara.packingRate, 20);
  });
});

describe("packing pay on the manager row", () => {
  it("pays the packer at each show's own rate", () => {
    const rows = [
      stream({ id: "a", date: "2026-10-05", managerPackingHours: 3, packingRate: 20 }),
      stream({ id: "b", date: "2026-10-07", managerPackingHours: 1, packingRate: 15 }),
    ];
    const [mw] = buildManagerPay(rows, S, {}, { [DANIEL]: "Daniel" }, {});
    assert.equal(mw.packingHours, 4);
    assert.equal(mw.packingPay, 75, "3h at $20 plus 1h at $15");
    assert.equal(mw.packingRate, 18.75);
  });

  it("takes the show's real rate out of the override base", () => {
    const [mw] = buildManagerPay(
      [stream({ managerPackingHours: 3, packingRate: 20, overrideId: DANIEL })],
      S, { [DANIEL]: 0.2 }, { [DANIEL]: "Daniel" }, {},
    );
    assert.equal(mw.managedCommissionable, 540);
    assert.equal(mw.streamerPayOnManaged, 108);
    assert.equal(mw.overrideBase, 432);
  });

  it("does not re-price a packed show when the settings rate drops", () => {
    // the regression this whole change exists to prevent
    const rows = [stream({ managerPackingHours: 3, packingRate: 20 })];
    const at15 = buildManagerPay(rows, S, {}, { [DANIEL]: "Daniel" }, {})[0];
    const at9 = buildManagerPay(rows, { ...S, packing_rate: 9 }, {}, { [DANIEL]: "Daniel" }, {})[0];
    assert.equal(at15.packingPay, 60);
    assert.equal(at9.packingPay, 60);
  });
});
