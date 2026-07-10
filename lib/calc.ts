import { AtRecord } from "./airtable";
import { Settings } from "./settings";

export type Line = {
  id: string;
  name: string;
  qty: number;
  qtyHit: number;
  market: number;
  buy: number;
  isGiveaway: boolean;
};

export function toLine(r: AtRecord): Line {
  return {
    id: r.id,
    name: r.fields["Line"] || "",
    qty: r.fields["Qty"] || 0,
    qtyHit: r.fields["Qty Hit"] || 0,
    market: r.fields["Market Price Snapshot"] || 0,
    buy: r.fields["Buy Price Snapshot"] || 0,
    isGiveaway: !!r.fields["Is Giveaway"],
  };
}

// ---- per-stream metrics (the old Sheet2 right side) ----
export function isHitLine(l: Line, s: Settings): boolean {
  return !l.isGiveaway && l.market > s.hit_threshold;
}

export function streamMetrics(lines: Line[], s: Settings) {
  const spots = lines.filter((l) => !l.isGiveaway).reduce((a, l) => a + l.qty, 0);
  const givvyQty = lines.filter((l) => l.isGiveaway).reduce((a, l) => a + l.qty, 0);
  const givvyValue = lines.filter((l) => l.isGiveaway).reduce((a, l) => a + l.qty * l.market, 0);
  const totalMarketValue = lines.reduce((a, l) => a + l.qty * l.market, 0);
  const productCost = lines.reduce((a, l) => a + l.qty * l.buy, 0);
  const valuePerSpot = spots > 0 ? totalMarketValue / spots : 0;
  const breakEven = valuePerSpot * s.breakeven_mult;
  // hits = the higher-value non-pack items (market > hit_threshold), not the pack filler
  const hitLines = lines.filter((l) => isHitLine(l, s));
  const hitPoolQty = hitLines.reduce((a, l) => a + l.qty, 0);
  const hitPoolValue = hitLines.reduce((a, l) => a + l.qty * l.market, 0);
  const hitsDelivered = hitLines.reduce((a, l) => a + l.qtyHit, 0);
  const hitValueDelivered = hitLines.reduce((a, l) => a + l.qtyHit * l.market, 0);
  const hitCostDelivered = hitLines.reduce((a, l) => a + l.qtyHit * l.buy, 0);
  const hitValueRemaining = hitLines.reduce((a, l) => a + Math.max(l.qty - l.qtyHit, 0) * l.market, 0);
  const hitOddsPerSpot = spots > 0 ? hitPoolQty / spots : 0;
  return {
    spots, givvyQty, givvyValue, totalMarketValue, productCost, valuePerSpot, breakEven,
    hitPoolQty, hitPoolValue, hitsDelivered, hitValueDelivered, hitCostDelivered,
    hitValueRemaining, hitOddsPerSpot,
  };
}

// ---- progressive commission tiers ----
export function tierCommission(profit: number, s: Settings): number {
  if (profit <= 0) return 0;
  const t1 = Math.min(profit, s.tier1_limit) * s.tier1_rate;
  const t2 = Math.max(Math.min(profit - s.tier1_limit, s.tier2_limit - s.tier1_limit), 0) * s.tier2_rate;
  const t3 = Math.max(profit - s.tier2_limit, 0) * s.tier3_rate;
  return t1 + t2 + t3;
}

// ---- weeks run Sunday through Saturday ----
export function weekStartOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function weekLabel(weekStart: string): string {
  const s = new Date(weekStart + "T00:00:00Z");
  const e = new Date(s);
  e.setUTCDate(e.getUTCDate() + 6);
  const fmt = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${fmt(s)} - ${fmt(e)}`;
}

export type StreamRow = {
  id: string;
  date: string;
  streamerId: string;
  streamerName: string;
  afterFees: number;
  promotion: number;
  tips: number;
  giveaways: number;          // count of $-per-giveaway giveaways run on stream
  hours: number;
  packingHours: number;
  managerPackingHours: number;
  managerId: string | null;
  productCost: number;        // buy-price snapshots x qty: the company's real cost
  productMarketCost: number;  // market-price snapshots x qty: what streamer pay is measured against
  status: string;
};

export type WeekPay = {
  weekStart: string;
  weekLabel: string;
  streamerId: string;
  streamerName: string;
  streams: StreamRow[];
  profit: number;           // OVER MARKET: sum of (afterFees - promotion - productMarketCost - tips); drives all pay
  buyProfit: number;        // OVER BUY: sum of (afterFees - promotion - productCost - tips); the company's real profit
  packingPay: number;
  commissionable: number;   // profit - packing (market basis)
  hours: number;
  hourlyRate: number;
  optionA: number;          // hours x rate
  optionB: number;          // tier commission on commissionable
  streamPay: number;        // the higher
  winner: "hourly" | "commission";
  tips: number;
  totalPay: number;         // streamPay + packingPay + tips
  supportPay: number;
  companyProfit: number;
};

export function buildWeekPay(
  streams: StreamRow[],
  s: Settings,
  ratesByStreamer: Record<string, number>
): WeekPay[] {
  const groups = new Map<string, StreamRow[]>();
  for (const st of streams) {
    if (st.status !== "Complete") continue;
    const key = `${weekStartOf(st.date)}|${st.streamerId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(st);
  }
  const out: WeekPay[] = [];
  for (const [key, rows] of groups) {
    const [weekStart, streamerId] = key.split("|");
    // tips are paid through to the streamer, so they come out of profit before commission.
    // Streamer pay is commissioned on profit over MARKET price; buy price never touches their numbers.
    const giveawayCost = (r: StreamRow) => (r.giveaways || 0) * s.giveaway_cost;
    const profit = rows.reduce((a, r) => a + (r.afterFees - r.promotion - giveawayCost(r) - r.productMarketCost - r.tips), 0);
    const buyProfit = rows.reduce((a, r) => a + (r.afterFees - r.promotion - giveawayCost(r) - r.productCost - r.tips), 0);
    const packingHours = rows.reduce((a, r) => a + r.packingHours, 0);
    const managerPackingHours = rows.reduce((a, r) => a + (r.managerPackingHours || 0), 0);
    const hours = rows.reduce((a, r) => a + r.hours, 0);
    const tips = rows.reduce((a, r) => a + r.tips, 0);
    const packingPay = packingHours * s.packing_rate;           // streamer's own packing, paid to streamer
    const managerPackingPay = managerPackingHours * s.packing_rate; // manager's packing, a stream cost
    const commissionable = profit - packingPay - managerPackingPay;
    const hourlyRate = ratesByStreamer[streamerId] ?? s.default_hourly_rate;
    const optionA = hours * hourlyRate;
    const optionB = tierCommission(commissionable, s);
    const streamPay = Math.max(optionA, optionB);
    const supportPay = Math.max(commissionable - streamPay, 0) * s.support_pct;
    out.push({
      weekStart,
      weekLabel: weekLabel(weekStart),
      streamerId,
      streamerName: rows[0].streamerName,
      streams: rows.sort((a, b) => a.date.localeCompare(b.date)),
      profit, buyProfit, packingPay, commissionable, hours, hourlyRate,
      optionA, optionB, streamPay,
      winner: optionA >= optionB ? "hourly" : "commission",
      tips,
      totalPay: streamPay + packingPay + tips,
      supportPay,
      // company profit runs on REAL cost (buy): what actually remains after paying everyone
      companyProfit: (buyProfit - packingPay - managerPackingPay) - streamPay - supportPay, // before manager override
    });
  }
  return out.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

export const money = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });


// ---- manager pay: packing hours + override on profit AFTER the streamer's pay ----
export type ManagerWeekPay = {
  weekStart: string;
  weekLabel: string;
  managerId: string;
  managerName: string;
  streamCount: number;
  managedCommissionable: number;
  streamerPayOnManaged: number;   // pay earned by the streamers on those streams
  overrideBase: number;           // max(commissionable - streamer pay, 0)
  overridePct: number;
  overridePay: number;
  packingHours: number;
  packingPay: number;
  totalPay: number;
};

export function buildManagerPay(
  streams: StreamRow[],
  s: Settings,
  overrideByManager: Record<string, number>,
  namesById: Record<string, string>,
  ratesByStreamer: Record<string, number>
): ManagerWeekPay[] {
  // group managed streams per (week, manager, streamer) so the streamer's
  // greater-of pay can be removed before the override is applied
  const groups = new Map<string, StreamRow[]>();
  for (const st of streams) {
    if (st.status !== "Complete" || !st.managerId) continue;
    const key = `${weekStartOf(st.date)}|${st.managerId}|${st.streamerId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(st);
  }

  type Agg = {
    rows: StreamRow[];
    commissionable: number;
    streamerPay: number;
    packingHours: number;
  };
  const byManagerWeek = new Map<string, Agg>();

  for (const [key, rows] of groups) {
    const [weekStart, managerId, streamerId] = key.split("|");
    // commissionable of this streamer's managed streams (market basis, same as streamer pay):
    // profit minus ALL packing on them
    const commissionable = rows.reduce(
      (a, r) =>
        a +
        (r.afterFees - r.promotion - (r.giveaways || 0) * s.giveaway_cost - r.productMarketCost - r.tips) -
        (r.packingHours + (r.managerPackingHours || 0)) * s.packing_rate,
      0
    );
    // the streamer's pay on these streams: same greater-of rule (hours x rate vs tiers)
    const hours = rows.reduce((a, r) => a + r.hours, 0);
    const rate = ratesByStreamer[streamerId] ?? s.default_hourly_rate;
    const streamerPay = Math.max(hours * rate, tierCommission(commissionable, s));
    const packingHours = rows.reduce((a, r) => a + (r.managerPackingHours || 0), 0);

    const mwKey = `${weekStart}|${managerId}`;
    const agg = byManagerWeek.get(mwKey) || { rows: [], commissionable: 0, streamerPay: 0, packingHours: 0 };
    agg.rows.push(...rows);
    agg.commissionable += commissionable;
    agg.streamerPay += streamerPay;
    agg.packingHours += packingHours;
    byManagerWeek.set(mwKey, agg);
  }

  const out: ManagerWeekPay[] = [];
  for (const [mwKey, agg] of byManagerWeek) {
    const [weekStart, managerId] = mwKey.split("|");
    const overridePct = overrideByManager[managerId] || 0;
    const overrideBase = Math.max(agg.commissionable - agg.streamerPay, 0);
    const overridePay = overrideBase * overridePct;
    const packingPay = agg.packingHours * s.packing_rate;
    out.push({
      weekStart,
      weekLabel: weekLabel(weekStart),
      managerId,
      managerName: namesById[managerId] || "Manager",
      streamCount: agg.rows.length,
      managedCommissionable: agg.commissionable,
      streamerPayOnManaged: agg.streamerPay,
      overrideBase,
      overridePct,
      overridePay,
      packingHours: agg.packingHours,
      packingPay,
      totalPay: overridePay + packingPay,
    });
  }
  return out.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}
