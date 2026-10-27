import { atList, T } from "./airtable";

export type Settings = {
  packing_rate: number; packing_fee: number; support_pct: number; breakeven_mult: number;
  tier1_limit: number; tier1_rate: number; tier2_limit: number; tier2_rate: number;
  tier3_rate: number; default_hourly_rate: number; hit_threshold: number;
  giveaway_cost: number;
  singles_giveaway_cost: number;
  commission_pct: number;
  /** gt-v1. What PSA charges per card on the tier open to you. Bulk is closed,
   *  so this is the $59.99 service tier. A setting rather than a constant
   *  because tiers open and close and the whole grading decision hangs off it. */
  grading_fee: number;
  /** The tier's insured ceiling. A card whose graded price is over this
   *  cannot go on this submission at all, which is a different answer from
   *  "not worth it". */
  grading_max_insured: number;
  /** cb-v1. Where a comp comes from. 1 means market first with sales kept as
   *  a check on it; 0 means the original sales-first chain.
   *
   *  A number because Settings is a flat numeric table. Defaults to 0 so
   *  deploying this changes nothing: the switch is thrown deliberately, after
   *  the preview has been read. */
  comp_basis_market: number;
};

const DEFAULTS: Settings = {
  // pr-v2: the rate NEW shows get stamped with when packing is first clocked
  // on them. Shows that already carry a Packing Rate keep it, so changing this
  // never moves a show that has been packed. Packing pays $15 from 2026-10-05;
  // shows up to 2026-10-04 were stamped at the old $20.
  packing_rate: 15,
  // pk-v3: packing is a flat fee per show from 2026-10-12 - one person is
  // assigned the show and gets this whether it was six orders or sixty. The
  // hourly rate above is kept only to price shows packed before the switch.
  // Like packing_rate, this is the number a show gets STAMPED with when a
  // packer is assigned, so changing it here never moves a show already packed.
  packing_fee: 35,
  support_pct: 0.1, breakeven_mult: 1.5,
  tier1_limit: 500, tier1_rate: 0.15, tier2_limit: 1000, tier2_rate: 0.2,
  tier3_rate: 0.25, default_hourly_rate: 20, hit_threshold: 10,
  giveaway_cost: 2.5,
  // gv-v1: a singles givvy is cheap product - charged at its own (lower)
  // flat rate, separate from pack givvies.
  singles_giveaway_cost: 1,
  commission_pct: 0.2,
  comp_basis_market: 0,
  grading_fee: 59.99,
  grading_max_insured: 1000,
};

export async function getSettings(): Promise<Settings> {
  const rows = await atList(T.settings);
  const s: any = { ...DEFAULTS };
  for (const r of rows) {
    const k = r.fields["Key"];
    if (k in s && typeof r.fields["Value"] === "number") s[k] = r.fields["Value"];
  }
  return s as Settings;
}
