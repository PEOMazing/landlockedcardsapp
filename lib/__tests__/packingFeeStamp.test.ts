import { test } from "node:test";
import assert from "node:assert/strict";
import { packingFeeToStamp } from "../packingFee";

const FEE = 35;

test("a show with a packer and nothing else gets the fee", () => {
  assert.equal(packingFeeToStamp({ hasPacker: true, settingFee: FEE }), 35);
});

test("the create path stamps - this is the bug that started it", () => {
  // dm-v1 puts the Default Manager on every new show, so the packer lands at
  // creation and the PATCH that used to do the stamping never runs. Same
  // inputs the create path has: a manager, no fee, no hours.
  assert.equal(
    packingFeeToStamp({
      hasPacker: true,
      existingFee: null,
      packingHours: null,
      managerPackingHours: null,
      settingFee: FEE,
    }),
    35,
  );
});

test("no packer, no fee", () => {
  // An unassigned show has not been packed and must not read as a $35 cost.
  assert.equal(packingFeeToStamp({ hasPacker: false, settingFee: FEE }), null);
});

test("a show already carrying a fee is never re-stamped", () => {
  // Reassigning the packer on a show packed last month still pays last
  // month's fee, so changing the setting cannot re-price settled history.
  assert.equal(
    packingFeeToStamp({ hasPacker: true, existingFee: 20, settingFee: FEE }),
    null,
  );
});

test("a show with packing hours on it stays hourly", () => {
  assert.equal(
    packingFeeToStamp({ hasPacker: true, packingHours: 1.5, settingFee: FEE }),
    null,
  );
  assert.equal(
    packingFeeToStamp({ hasPacker: true, managerPackingHours: 2, settingFee: FEE }),
    null,
  );
  // both halves count toward "this was an hourly show"
  assert.equal(
    packingFeeToStamp({
      hasPacker: true, packingHours: 0, managerPackingHours: 0.25, settingFee: FEE,
    }),
    null,
  );
});

test("zero hours is not hours", () => {
  assert.equal(
    packingFeeToStamp({
      hasPacker: true, packingHours: 0, managerPackingHours: 0, settingFee: FEE,
    }),
    35,
  );
});

test("a zero or missing setting turns the flat deal off entirely", () => {
  assert.equal(packingFeeToStamp({ hasPacker: true, settingFee: 0 }), null);
  assert.equal(packingFeeToStamp({ hasPacker: true, settingFee: NaN }), null);
  assert.equal(packingFeeToStamp({ hasPacker: true, settingFee: -5 }), null);
});

test("a zero fee already on the record is not treated as stamped", () => {
  // 0 and blank both mean "no fee here", so a show carrying a zero is still
  // eligible rather than being frozen out by it.
  assert.equal(
    packingFeeToStamp({ hasPacker: true, existingFee: 0, settingFee: FEE }),
    35,
  );
});

test("the fee written is the setting, whatever it is", () => {
  assert.equal(packingFeeToStamp({ hasPacker: true, settingFee: 50 }), 50);
});
