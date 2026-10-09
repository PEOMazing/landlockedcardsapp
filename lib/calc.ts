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
// At or above the threshold, not merely above it: the rule as it is actually
// spoken is "ten dollars or more is a hit", and a card comped at exactly $10.00
// failing that test is the kind of off-by-a-penny surprise nobody ever guesses
// at when a number looks wrong.
export function isHitLine(l: Line, s: Settings): boolean {
  return !l.isGiveaway && l.market >= s.hit_threshold;
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

// What the product on a set is made of.
//
// Singles and sealed come off different shelves, get priced different ways and
// get replaced at different speeds, so "there is $1,800 on this set" is two
// quite different shows depending on the split. A line is a single when it
// points back at a card in the singles inventory; everything else is sealed.
//
// Takes the shape the stream page already has rather than calc's Line, so it
// works off what is on screen without another pass over Airtable. Store
// purchases are the caller's to exclude, same as everywhere else in the P&L.
export type KindSplit = {
  singlesValue: number; singlesQty: number;
  sealedValue: number; sealedQty: number;
};

export function splitByKind(
  lines: { qty?: number; market?: number; singleRecId?: string | null }[],
): KindSplit {
  const out: KindSplit = { singlesValue: 0, singlesQty: 0, sealedValue: 0, sealedQty: 0 };
  for (const l of lines || []) {
    const qty = Number(l?.qty) || 0;
    const value = qty * (Number(l?.market) || 0);
    if (String(l?.singleRecId || "").trim()) {
      out.singlesQty += qty;
      out.singlesValue += value;
    } else {
      out.sealedQty += qty;
      out.sealedValue += value;
    }
  }
  return out;
}

// ---- what an hour of packing costs ----
//
// pr-v2. Packing used to be one flat rate read live out of settings. That
// meant changing the number silently re-priced every show that had already
// been paid: dropping $20 to $15 moved three months of settled history and
// made the payroll page disagree with the money that actually went out.
//
// So the rate is snapshotted on the stream, the same way Market Price Snapshot
// and Buy Price Snapshot already work on the lines. The show remembers what
// packing cost when it was packed and later changes leave it alone. Blank
// falls back to the current settings rate, which is what a show reads before
// anyone has clocked packing on it.
//
// Deliberately NOT a per-person rate. The rate is a property of WHEN the work
// happened, not of who did it: packing went from $20 to $15 on 2026-10-05, and
// somebody who packed on both sides of that line is owed both rates.
export function packingRate(stream: { packingRate?: number | null }, s: Settings): number {
  const r = Number(stream?.packingRate);
  return Number.isFinite(r) && r > 0 ? r : s.packing_rate;
}

/** What one show's packing labor costs: both sides of its clock at its own rate. */
export function streamPackingCost(
  r: { packingHours?: number | null; managerPackingHours?: number | null; packingRate?: number | null },
  s: Settings,
): number {
  const hrs = (Number(r.packingHours) || 0) + (Number(r.managerPackingHours) || 0);
  return hrs * packingRate(r, s);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  shipAdj?: number;           // shipping Whatnot re-bills after the show; outside After Fees, a cost like promotion
  tips: number;
  giveaways: number;          // count of PACK givvies run on stream (giveaway_cost each)
  singlesGiveaways: number;   // gv-v1: count of SINGLES givvies (singles_giveaway_cost each)
  hours: number;
  packingHours: number;
  managerPackingHours: number;
  // pr-v2: the rate this show's packing hours are paid at, snapshotted on the
  // stream. Null or 0 falls back to settings.packing_rate.
  packingRate?: number | null;
  // managerId  = who PACKED the show (their packing hours are paid to them)
  // overrideId = who EARNS THE OVERRIDE on it (admin only, Airtable "Override Rec Id").
  // Blank override means nobody earns one here. Packing no longer grants the override.
  managerId: string | null;
  overrideId?: string | null;
  // Both costs are DELIVERED units only (qty hit), never the full wall - unhit units
  // return to inventory, so they were never a cost of the show.
  productCost: number;        // buy-price snapshots x qty hit: the company's real cost
  productMarketCost: number;  // market-price snapshots x qty hit: what streamer pay is measured against
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
  // pr-v2: what this person's packing actually averaged out to, for the UI to
  // show. A weighted average when their week spans shows at different rates.
  packingRate: number;
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
export type PersonHours = Record<
  string,
  // pr-v2: packingPay is accumulated here rather than derived later, because
  // the rate belongs to the SHOW and this is the only pass that still knows
  // which show each clocked hour came from.
  { streaming: number; packing: number; packingPay: number; tips: number }
>;

export function buildPersonHours(
  streams: Array<{
    id: string; date: string; status: string; managerId?: string | null;
    streamerId?: string; tips?: number; packingRate?: number | null;
  }>,
  entries: Array<{ streamId: string; personId: string; type: string; hours: number }>,
  s: Settings
): PersonHours {
  const streamById = new Map(streams.map((st) => [st.id, st]));
  const out: PersonHours = {};
  const bump = (key: string) => {
    if (!out[key]) out[key] = { streaming: 0, packing: 0, packingPay: 0, tips: 0 };
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
    } else if (e.personId !== (st.managerId || null)) {
      const b = bump(key);
      b.packing += e.hours;
      b.packingPay += e.hours * packingRate(st, s);   // priced at THIS show's rate
    }
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
    out[k].packingPay = Math.round(out[k].packingPay * 100) / 100;
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
    const profit = rows.reduce((a, r) => a + (r.afterFees - r.promotion - (r.shipAdj || 0) - giveawayCost(r) - r.productMarketCost), 0);
    const buyProfit = rows.reduce((a, r) => a + (r.afterFees - r.promotion - (r.shipAdj || 0) - giveawayCost(r) - r.productCost), 0);
    const packingHours = rows.reduce((a, r) => a + r.packingHours, 0);
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
    // pr-v2: every figure below is summed per show at that show's own rate, so
    // a week that straddles a rate change prices each show correctly instead of
    // applying one number to the whole week.
    const costPackingPay = rows.reduce((a, r) => a + (r.packingHours || 0) * packingRate(r, s), 0);
    const managerPackingPay = rows.reduce((a, r) => a + (r.managerPackingHours || 0) * packingRate(r, s), 0);
    // person's own packing, paid to them, already priced per show upstream
    const packingPay = opts?.personHours ? (own?.packingPay ?? 0) : costPackingPay;
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
      packingRate: payPackingHours > 0 ? round2(packingPay / payPackingHours) : s.packing_rate,
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
      const packingPay = own.packingPay;   // already priced per show
      out.push({
        weekStart,
        weekLabel: weekLabel(weekStart),
        streamerId: personId,
        streamerName: opts.namesById?.[personId] || "Streamer",
        streams: [],
        profit: 0, buyProfit: 0, packingPay,
        packingRate: own.packing > 0 ? round2(own.packingPay / own.packing) : s.packing_rate,
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
  managerId: string;      // person being paid: override earner, packer, or both
  managerName: string;
  earnsOverride: boolean;
  packedCount: number;
  streamCount: number;
  managedCommissionable: number;
  streamerPayOnManaged: number;   // pay earned by the streamers on those streams
  overrideBase: number;           // max(commissionable - streamer pay, 0)
  overridePct: number;
  overridePay: number;
  packingHours: number;
  packingRate: number;   // effective rate across the shows they packed
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
  // OVERRIDE side, keyed on each stream's override earner.
  const groups = new Map<string, StreamRow[]>();
  for (const st of streams) {
    if (st.status !== "Complete") continue;
    const earner = st.overrideId || null;
    if (!earner) continue;
    const key = `${weekStartOf(st.date)}|${earner}|${st.streamerId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(st);
  }

  type Agg = {
    rows: StreamRow[];
    commissionable: number;
    streamerPay: number;
    packingHours: number;
    packingPay: number;
    packedCount: number;
    earnsOverride: boolean;
  };
  const byManagerWeek = new Map<string, Agg>();
  const touch = (key: string): Agg => {
    const a = byManagerWeek.get(key) || {
      rows: [], commissionable: 0, streamerPay: 0, packingHours: 0, packingPay: 0, packedCount: 0, earnsOverride: false,
    };
    byManagerWeek.set(key, a);
    return a;
  };

  for (const [key, rows] of groups) {
    const [weekStart, managerId, streamerId] = key.split("|");
    // commissionable of this streamer's managed streams (market basis, same as streamer pay):
    // profit minus ALL packing on them
    const commissionable = rows.reduce(
      (a, r) =>
        r.overrideExcluded
          ? a // admin excluded this stream from the override base; packing pay still counts
          : a +
            (r.afterFees - r.promotion - (r.shipAdj || 0) - (r.giveaways || 0) * s.giveaway_cost
              - (r.singlesGiveaways || 0) * s.singles_giveaway_cost - r.productMarketCost) -
            streamPackingCost(r, s),
      0
    );
    // the streamer's pay on these streams: same greater-of rule (hours x rate vs tiers)
    const hours = rows.reduce((a, r) => a + r.hours, 0);
    const rate = ratesByStreamer[streamerId] ?? s.default_hourly_rate;
    const streamerPay = Math.max(hours * rate, tierCommission(commissionable, s));

    const agg = touch(`${weekStart}|${managerId}`);
    agg.rows.push(...rows);
    agg.commissionable += commissionable;
    agg.streamerPay += streamerPay;
    agg.earnsOverride = true;
  }

  // PACKING side, keyed on whoever actually packed the show. Packing is hourly and
  // belongs to the packer whether or not they earn the override on it.
  for (const st of streams) {
    if (st.status !== "Complete" || !st.managerId) continue;
    const hrs = st.managerPackingHours || 0;
    if (hrs <= 0) continue;
    const agg = touch(`${weekStartOf(st.date)}|${st.managerId}`);
    agg.packingHours += hrs;
    agg.packingPay += hrs * packingRate(st, s);   // this show's own rate
    agg.packedCount += 1;
    if (!agg.rows.some((r) => r.id === st.id)) agg.rows.push(st);
  }

  const out: ManagerWeekPay[] = [];
  for (const [mwKey, agg] of byManagerWeek) {
    const [weekStart, managerId] = mwKey.split("|");
    const overridePct = overrideByManager[managerId] || 0;
    const overrideBase = Math.max(agg.commissionable - agg.streamerPay, 0);
    const overridePay = overrideBase * overridePct;
    const packingPay = round2(agg.packingPay);
    out.push({
      weekStart,
      weekLabel: weekLabel(weekStart),
      streams: agg.rows.sort((a, b) => a.date.localeCompare(b.date)),
      managerId,
      managerName: namesById[managerId] || "Manager",
      earnsOverride: agg.earnsOverride,
      packedCount: agg.packedCount,
      streamCount: agg.rows.length,
      managedCommissionable: agg.commissionable,
      streamerPayOnManaged: agg.streamerPay,
      overrideBase,
      overridePct,
      overridePay,
      packingHours: agg.packingHours,
      packingRate: agg.packingHours > 0 ? round2(packingPay / agg.packingHours) : s.packing_rate,
      packingPay,
      totalPay: overridePay + packingPay,
    });
  }
  return out.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}
