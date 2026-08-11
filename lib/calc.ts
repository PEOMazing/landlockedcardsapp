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
// Streamer commission is a flat percentage of commissionable profit
// (settings key commission_pct, default 20%). The old three-tier ladder is
// retired - the deal is simply: hourly rate or this percentage, whichever pays more.
export function tierCommission(profit: number, s: Settings): number {
  if (profit <= 0) return 0;
  return profit * (s.commission_pct ?? 0.2);
}

// ---- weeks run Sunday through Saturday ----
export function weekStartOf(dateStr: string): string {
  // pay weeks run Monday through Sunday, paid the following Tuesday
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function payDateOf(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 8); // Monday start + 8 = Tuesday after the Sunday close
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
  title?: string;
  streamerId: string;
  streamerName: string;
  afterFees: number;
  promotion: number;
  tips: number;
  giveaways: number;          // count of PACK givvies run on stream (giveaway_cost each)
  singlesGiveaways: number;   // gv-v1: count of SINGLES givvies (singles_giveaway_cost each)
  hours: number;
  packingHours: number;
  managerPackingHours: number;
  managerId: string | null;
  productCost: number;        // buy-price snapshots x qty: the company's real cost
  productMarketCost: number;  // market-price snapshots x qty: what streamer pay is measured against
  status: string;
  overrideExcluded?: boolean;
};

export type WeekPay = {
  weekStart: string;
  weekLabel: string;
  streamerId: string;
  streamerName: string;
  streams: StreamRow[];
  profit: number;           // OVER MARKET: sum of (afterFees - promotion - productMarketCost); tips are outside the P&L, paid through separately
  buyProfit: number;        // OVER BUY: sum of (afterFees - promotion - productCost); tips never touch profit
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

// hp-v1: per-PERSON hours from the timeclock. Key `${weekStart}|${personId}`.
// Built from Time Entries joined to their COMPLETE streams (the stream's date
// decides the week, matching the "belongs to whoever completes it" rule).
// Manager packing stays out - buildManagerPay pays that separately.
export type PersonHours = Record<string, { streaming: number; packing: number; tips: number }>;

export function buildPersonHours(
  streams: Array<{ id: string; date: string; status: string; managerId?: string | null; streamerId?: string; tips?: number }>,
  entries: Array<{ streamId: string; personId: string; type: string; hours: number }>
): PersonHours {
  const streamById = new Map(streams.map((st) => [st.id, st]));
  const out: PersonHours = {};
  const bump = (key: string) => {
    if (!out[key]) out[key] = { streaming: 0, packing: 0, tips: 0 };
    return out[key];
  };
  // who actually STREAMED each show, from the timeclock
  const streamersOnStream = new Map<string, Set<string>>();
  for (const e of entries) {
    const st = streamById.get(e.streamId);
    if (!st || st.status !== "Complete" || !e.personId || !(e.hours > 0)) continue;
    const key = `${weekStartOf(st.date)}|${e.personId}`;
    if (e.type === "Streaming") {
      bump(key).streaming += e.hours;
      if (!streamersOnStream.has(st.id)) streamersOnStream.set(st.id, new Set());
      streamersOnStream.get(st.id)!.add(e.personId);
    } else if (e.personId !== (st.managerId || null)) bump(key).packing += e.hours;
  }
  // tips split EVENLY among the streamers who clocked on the show (per Gabe
  // 2026-08-11); a show with no clocked streamers falls back to its streamer
  // of record so tips never vanish.
  for (const st of streams) {
    if (st.status !== "Complete" || !(st.tips && st.tips > 0)) continue;
    const people = [...(streamersOnStream.get(st.id) || [])];
    const payees = people.length ? people : (st.streamerId ? [st.streamerId] : []);
    if (!payees.length) continue;
    const share = st.tips / payees.length;
    for (const pid of payees) bump(`${weekStartOf(st.date)}|${pid}`).tips += share;
  }
  for (const k of Object.keys(out)) {
    out[k].streaming = Math.round(out[k].streaming * 100) / 100;
    out[k].packing = Math.round(out[k].packing * 100) / 100;
    out[k].tips = Math.round(out[k].tips * 100) / 100;
  }
  return out;
}

export function buildWeekPay(
  streams: StreamRow[],
  s: Settings,
  ratesByStreamer: Record<string, number>,
  // hp-v1 (per Gabe 2026-08-11): streamers are paid ONLY the hours clocked
  // under their own name. When personHours is provided, the hourly option
  // and packing pay come from the person's own timeclock entries - a shared
  // show pays each person their own clock, never the whole show to the
  // streamer of record. People with clocked hours but no streams of record
  // that week get their own hourly-only row (namesById labels them).
  opts?: { personHours?: PersonHours; namesById?: Record<string, string>; onlyPersonId?: string }
): WeekPay[] {
  const groups = new Map<string, StreamRow[]>();
  for (const st of streams) {
    if (st.status !== "Complete") continue;
    const key = `${weekStartOf(st.date)}|${st.streamerId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(st);
  }
  const out: WeekPay[] = [];
  const coveredKeys = new Set<string>();
  for (const [key, rows] of groups) {
    const [weekStart, streamerId] = key.split("|");
    // tips are paid through to the streamer, so they come out of profit before commission.
    // Streamer pay is commissioned on profit over MARKET price; buy price never touches their numbers.
    const giveawayCost = (r: StreamRow) =>
      (r.giveaways || 0) * s.giveaway_cost + (r.singlesGiveaways || 0) * s.singles_giveaway_cost;
    const profit = rows.reduce((a, r) => a + (r.afterFees - r.promotion - giveawayCost(r) - r.productMarketCost), 0);
    const buyProfit = rows.reduce((a, r) => a + (r.afterFees - r.promotion - giveawayCost(r) - r.productCost), 0);
    const packingHours = rows.reduce((a, r) => a + r.packingHours, 0);
    const managerPackingHours = rows.reduce((a, r) => a + (r.managerPackingHours || 0), 0);
    // hp-v1: PAY-side hours are the person's own clocked time; COST-side
    // packing (subtracted from the commission base) stays the streams' full
    // packing, whoever clocked it - the labor happened on these streams.
    const key2 = `${weekStart}|${streamerId}`;
    coveredKeys.add(key2);
    const own = opts?.personHours ? opts.personHours[key2] : undefined;
    const hours = opts?.personHours ? (own?.streaming ?? 0) : rows.reduce((a, r) => a + r.hours, 0);
    // tips: split per show among its clocked streamers when personHours is
    // on; the stream-lump sum otherwise
    const tips = opts?.personHours ? (own?.tips ?? 0) : rows.reduce((a, r) => a + r.tips, 0);
    const payPackingHours = opts?.personHours ? (own?.packing ?? 0) : packingHours;
    const packingPay = payPackingHours * s.packing_rate;        // person's own packing, paid to them
    const costPackingPay = packingHours * s.packing_rate;       // the streams' full streamer-side packing cost
    const managerPackingPay = managerPackingHours * s.packing_rate; // manager's packing, a stream cost
    const commissionable = profit - costPackingPay - managerPackingPay;
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
      companyProfit: (buyProfit - costPackingPay - managerPackingPay) - streamPay - supportPay, // before manager override
    });
  }
  // hp-v1: hourly-only rows for people who clocked time on someone else's
  // streams and have no streams of record that week (e.g. a second streamer
  // on a shared show). Their hours would otherwise be paid to nobody.
  if (opts?.personHours) {
    for (const [key, own] of Object.entries(opts.personHours)) {
      if (coveredKeys.has(key)) continue;
      const [weekStart, personId] = key.split("|");
      if (opts.onlyPersonId && personId !== opts.onlyPersonId) continue;
      if (!(own.streaming > 0 || own.packing > 0 || own.tips > 0)) continue;
      const hourlyRate = ratesByStreamer[personId] ?? s.default_hourly_rate;
      const streamPay = own.streaming * hourlyRate;
      const packingPay = own.packing * s.packing_rate;
      out.push({
        weekStart,
        weekLabel: weekLabel(weekStart),
        streamerId: personId,
        streamerName: opts.namesById?.[personId] || "Streamer",
        streams: [],
        profit: 0, buyProfit: 0, packingPay,
        commissionable: 0,
        hours: own.streaming, hourlyRate,
        optionA: streamPay, optionB: 0, streamPay,
        winner: "hourly",
        tips: own.tips,
        totalPay: streamPay + packingPay + own.tips,
        supportPay: 0,
        // their pay is a labor cost already carried by the streams they worked
        companyProfit: -(streamPay + packingPay),
      });
    }
  }
  return out.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

export const money = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });


// ---- manager pay: packing hours + override on profit AFTER the streamer's pay ----
export type ManagerWeekPay = {
  streams: StreamRow[];
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
        r.overrideExcluded
          ? a // admin excluded this stream from the override base; packing pay still counts
          : a +
            (r.afterFees - r.promotion - (r.giveaways || 0) * s.giveaway_cost
              - (r.singlesGiveaways || 0) * s.singles_giveaway_cost - r.productMarketCost) -
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
      streams: agg.rows.sort((a, b) => a.date.localeCompare(b.date)),
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
