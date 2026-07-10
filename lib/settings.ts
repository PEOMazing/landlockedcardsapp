import { atList, T } from "./airtable";

export type Settings = {
  packing_rate: number; support_pct: number; breakeven_mult: number;
  tier1_limit: number; tier1_rate: number; tier2_limit: number; tier2_rate: number;
  tier3_rate: number; default_hourly_rate: number; hit_threshold: number;
  giveaway_cost: number;
};

const DEFAULTS: Settings = {
  packing_rate: 20, support_pct: 0.1, breakeven_mult: 1.45,
  tier1_limit: 500, tier1_rate: 0.15, tier2_limit: 1000, tier2_rate: 0.2,
  tier3_rate: 0.25, default_hourly_rate: 20, hit_threshold: 10,
  giveaway_cost: 2.5,
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
