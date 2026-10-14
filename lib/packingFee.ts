// pk-v4. When a show gets stamped with the flat packing fee.
//
// This rule used to live inline in the PATCH handler, written on the
// assumption that a show is born with no packer and gets one later. That
// assumption was wrong the day it shipped: dm-v1 gives every new show the
// Default Manager at creation, so the packer lands in the CREATE path and
// the PATCH that would have stamped the fee never runs.
//
// The visible damage was quiet. A show created after the 2026-10-12 switch
// carried a packer and a blank Packing Fee, which every reader in the app
// correctly interprets as "this one predates the flat deal, price it by the
// hour". So the stream page offered a packing clock, the P&L showed a
// "Packing time" line, and payroll paid the packer nothing at all unless
// somebody thought to clock hours they were not supposed to be clocking.
//
// Hence one function, used by both paths, rather than the rule being
// re-derived wherever a manager happens to be written.

export type FeeStampInput = {
  /** Is a packer landing on this record? No packer, no fee - an unassigned
   *  show has not been packed and must not read as a $35 cost.
   *
   *  pk-v5: this is the PACKER, not the manager of record. They were one field
   *  when this was written, which meant the only way to pay somebody for
   *  packing was to also make them manager of the show. */
  hasPacker: boolean;
  /** What the record already carries, if anything. */
  existingFee?: number | null;
  packingHours?: number | null;
  managerPackingHours?: number | null;
  /** settings.packing_fee. Zero turns the whole flat deal off. */
  settingFee: number;
};

/** The fee to write, or null to leave the field alone.
 *
 *  Never re-stamps. A show already carrying a fee keeps the number it was
 *  stamped with, so changing the fee in Settings cannot re-price a show that
 *  has already been packed, and reassigning the packer on an old show still
 *  pays that show's own rate.
 *
 *  Never converts an hourly show. If packing hours are already clocked on it,
 *  that show was priced by the hour and somebody may already have been paid
 *  for it; quietly moving it to a fee would rewrite settled pay. */
export function packingFeeToStamp(i: FeeStampInput): number | null {
  if (!i.hasPacker) return null;
  if (Number(i.existingFee) > 0) return null;
  const hours = (Number(i.packingHours) || 0) + (Number(i.managerPackingHours) || 0);
  if (hours > 0) return null;
  const fee = Number(i.settingFee);
  if (!Number.isFinite(fee) || fee <= 0) return null;
  return fee;
}
