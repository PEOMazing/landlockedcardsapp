"use client";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { buildWeekPay, buildManagerPay, StreamRow } from "@/lib/calc";
import type { Settings } from "@/lib/settings";

const C = {
  foil: "#FFB94A", win: "#3DDC84", bad: "#F4645C", givvy: "#FF8A3D",
  dim: "#8B96AC", edge: "#232D42", body: "#E8EDF6", panel: "#161D2C", blue: "#5CA8FF",
};
const $ = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $0 = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

function Big({ label, v, win, bad }: { label: string; v: string; win?: boolean; bad?: boolean }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`text-xl font-bold num ${win ? "text-win" : bad ? "text-bad" : ""}`}>{v}</div>
    </div>
  );
}

const tooltipStyle = {
  contentStyle: { background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 8, color: C.body },
  labelStyle: { color: C.dim },
};
const axis = { stroke: C.dim, fontSize: 11 } as const;

export default function InsightsClient({
  rows, soldByStream, settings, rateById, overrideById, nameById,
}: {
  rows: StreamRow[];
  soldByStream: Record<string, number>;
  settings: Settings;
  rateById: Record<string, number>;
  overrideById: Record<string, number>;
  nameById: Record<string, string>;
}) {
  const [sel, setSel] = useState<string>("all");

  const streamerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.streamerId)) seen.set(r.streamerId, r.streamerName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const d = useMemo(() => {
    // "all" = the entire stream overview; otherwise scope to one streamer's streams,
    // plus (if they manage anyone) the streams they manage for override income
    const scoped = sel === "all" ? rows : rows.filter((r) => r.streamerId === sel);
    const managed = sel === "all" ? rows : rows.filter((r) => r.managerId === sel);
    const weeks = buildWeekPay(scoped, settings, rateById);
    const managerWeeks = buildManagerPay(managed, settings, overrideById, nameById, rateById);

    type Wk = {
      week: string; label: string;
      revenue: number; marketProfit: number; buyProfit: number;
      streamerPay: number; supportPay: number; overridePay: number; companyProfit: number;
      commissionPaid: number; hourlyPaid: number; packingPay: number; tips: number;
      hours: number; packingHours: number; effHourly: number;
      spins: number; spinValue: number; profitPerSpin: number;
    };
    const blank = (week: string, label: string): Wk => ({
      week, label, revenue: 0, marketProfit: 0, buyProfit: 0,
      streamerPay: 0, supportPay: 0, overridePay: 0, companyProfit: 0,
      commissionPaid: 0, hourlyPaid: 0, packingPay: 0, tips: 0,
      hours: 0, packingHours: 0, effHourly: 0, spins: 0, spinValue: 0, profitPerSpin: 0,
    });
    const wkMap = new Map<string, Wk>();
    for (const w of weeks) {
      const agg = wkMap.get(w.weekStart) || blank(w.weekStart, w.weekLabel);
      agg.marketProfit += w.profit;
      agg.buyProfit += w.buyProfit;
      agg.streamerPay += w.totalPay;
      agg.supportPay += w.supportPay;
      agg.companyProfit += w.companyProfit;
      agg.packingPay += w.packingPay;
      agg.tips += w.tips;
      agg.hours += w.hours;
      if (w.winner === "commission") agg.commissionPaid += w.streamPay;
      else agg.hourlyPaid += w.streamPay;
      for (const s of w.streams) {
        agg.revenue += s.afterFees;
        agg.packingHours += s.packingHours + s.managerPackingHours;
        agg.spins += soldByStream[s.id] || 0;
      }
      wkMap.set(w.weekStart, agg);
    }
    for (const mw of managerWeeks) {
      const agg = wkMap.get(mw.weekStart) || blank(mw.weekStart, mw.weekLabel);
      agg.overridePay += mw.overridePay;
      if (sel === "all") agg.companyProfit -= mw.overridePay; // overrides come out of the company side
      wkMap.set(mw.weekStart, agg);
    }
    const weekly = [...wkMap.values()].sort((a, b) => a.week.localeCompare(b.week));
    for (const w of weekly) {
      const totalHrs = w.hours + w.packingHours;
      w.effHourly = totalHrs > 0 ? (w.streamerPay - w.tips) / totalHrs : 0; // pay per hour, tips excluded
      w.spinValue = w.spins > 0 ? w.revenue / w.spins : 0;
      w.profitPerSpin = w.spins > 0 ? w.marketProfit / w.spins : 0;
    }

    const perStream = scoped
      .map((r) => {
        const sold = soldByStream[r.id] || 0;
        return {
          date: r.date,
          name: `${r.date} ${r.streamerName}`,
          revenue: r.afterFees,
          sold,
          spinValue: sold > 0 ? r.afterFees / sold : 0,
          profitPerSpin: sold > 0 ? (r.afterFees - r.promotion - r.productMarketCost - r.tips) / sold : 0,
          buyProfitPerSpin: sold > 0 ? (r.afterFees - r.promotion - r.productCost - r.tips) / sold : 0,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const byStreamer = new Map<string, { name: string; pay: number; hours: number; profit: number; streams: number }>();
    for (const w of weeks) {
      const a = byStreamer.get(w.streamerId) || { name: w.streamerName, pay: 0, hours: 0, profit: 0, streams: 0 };
      a.pay += w.totalPay;
      a.hours += w.hours;
      a.profit += w.profit;
      a.streams += w.streams.length;
      byStreamer.set(w.streamerId, a);
    }
    const streamers = [...byStreamer.values()].sort((a, b) => b.pay - a.pay);

    const sum = (f: (w: Wk) => number) => weekly.reduce((a, w) => a + f(w), 0);
    const totalHours = sum((w) => w.hours);
    const totalPackingHours = sum((w) => w.packingHours);
    const totalPayExTips = sum((w) => w.streamerPay - w.tips);
    const totalSpins = sum((w) => w.spins);
    const totals = {
      streams: scoped.length,
      revenue: sum((w) => w.revenue),
      marketProfit: sum((w) => w.marketProfit),
      buyProfit: sum((w) => w.buyProfit),
      companyProfit: sum((w) => w.companyProfit),
      streamerPay: sum((w) => w.streamerPay),
      commissionPaid: sum((w) => w.commissionPaid),
      hourlyPaid: sum((w) => w.hourlyPaid),
      supportPay: sum((w) => w.supportPay),
      overridePay: sum((w) => w.overridePay),
      tips: sum((w) => w.tips),
      hours: totalHours,
      packingHours: totalPackingHours,
      effHourly: totalHours + totalPackingHours > 0 ? totalPayExTips / (totalHours + totalPackingHours) : 0,
      spins: totalSpins,
      spinValue: totalSpins > 0 ? sum((w) => w.revenue) / totalSpins : 0,
      profitPerSpin: totalSpins > 0 ? sum((w) => w.marketProfit) / totalSpins : 0,
      buyProfitPerSpin: totalSpins > 0 ? sum((w) => w.buyProfit) / totalSpins : 0,
    };

    return { weekly, perStream, streamers, totals };
  }, [rows, sel, soldByStream, settings, rateById, overrideById, nameById]);

  const { totals, weekly, perStream, streamers } = d;
  const money$ = (v: number) => $(v);

  return (
    <div className="space-y-8">
      {/* Streamer filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          className={`rounded-full border px-3 py-1.5 text-sm ${sel === "all" ? "border-foil text-foil bg-foil/10" : "border-edge text-dim hover:text-body"}`}
          onClick={() => setSel("all")}
        >
          All streamers
        </button>
        {streamerOptions.map((s) => (
          <button
            key={s.id}
            className={`rounded-full border px-3 py-1.5 text-sm ${sel === s.id ? "border-foil text-foil bg-foil/10" : "border-edge text-dim hover:text-body"}`}
            onClick={() => setSel(s.id)}
          >
            {s.name}
          </button>
        ))}
        <span className="text-dim text-xs ml-2">{totals.streams} completed streams in view</span>
      </div>

      {totals.streams === 0 ? (
        <div className="card p-6 text-dim text-sm">
          No completed streams {sel === "all" ? "yet" : "for this streamer yet"}. Insights build up as streams are marked Complete.
        </div>
      ) : (
        <>
          {/* Lifetime numbers for the current view */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Big label="Total sales (after fees)" v={$0(totals.revenue)} />
            <Big label="Profit over market" v={$0(totals.marketProfit)} win={totals.marketProfit >= 0} bad={totals.marketProfit < 0} />
            <Big label="Profit over buy" v={$0(totals.buyProfit)} win={totals.buyProfit >= 0} bad={totals.buyProfit < 0} />
            {sel === "all" && (
              <Big label="Company profit" v={$0(totals.companyProfit)} win={totals.companyProfit >= 0} bad={totals.companyProfit < 0} />
            )}
            <Big label="Streamer pay (all-in)" v={$0(totals.streamerPay)} />
            <Big label="Commission paid" v={$0(totals.commissionPaid)} />
            <Big label="Hourly paid" v={$0(totals.hourlyPaid)} />
            <Big label="Tips received" v={$0(totals.tips)} />
            {totals.overridePay > 0 && <Big label="Manager overrides" v={$0(totals.overridePay)} />}
            <Big label="Hours worked (stream + pack)" v={(totals.hours + totals.packingHours).toFixed(1)} />
            <Big label="Effective hourly (pay / hrs)" v={$(totals.effHourly)} />
            <Big label="Avg spin value" v={$(totals.spinValue)} />
            <Big label="Avg profit per spin (mkt / buy)" v={`${$(totals.profitPerSpin)} / ${$(totals.buyProfitPerSpin)}`} />
          </section>

          {/* Revenue vs profit by week */}
          <section className="card p-5">
            <h2 className="label mb-4">Revenue and profit by week</h2>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={weekly}>
                <CartesianGrid stroke={C.edge} strokeDasharray="3 3" />
                <XAxis dataKey="label" {...axis} />
                <YAxis {...axis} tickFormatter={$0} />
                <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [$(Number(v)), n]} />
                <Legend wrapperStyle={{ fontSize: 12, color: C.dim }} />
                <Bar dataKey="revenue" name="Sales (after fees)" fill={C.blue} radius={[4, 4, 0, 0]} />
                <Line dataKey="marketProfit" name="Profit over market" stroke={C.foil} strokeWidth={2} dot />
                <Line dataKey="buyProfit" name="Profit over buy" stroke={C.win} strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
          </section>

          {/* Where the money goes */}
          <section className="card p-5">
            <h2 className="label mb-4">{sel === "all" ? "Where the money goes by week" : "Pay by week"}</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={weekly}>
                <CartesianGrid stroke={C.edge} strokeDasharray="3 3" />
                <XAxis dataKey="label" {...axis} />
                <YAxis {...axis} tickFormatter={$0} />
                <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [$(Number(v)), n]} />
                <Legend wrapperStyle={{ fontSize: 12, color: C.dim }} />
                <Bar dataKey="streamerPay" name="Streamer pay" stackId="a" fill={C.foil} />
                <Bar dataKey="supportPay" name="Support" stackId="a" fill={C.givvy} />
                <Bar dataKey="overridePay" name="Overrides" stackId="a" fill={C.dim} />
                {sel === "all" && <Bar dataKey="companyProfit" name="Company profit" stackId="a" fill={C.win} radius={[4, 4, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </section>

          {/* Spin economics per stream */}
          <section className="card p-5">
            <h2 className="label mb-4">Spin economics per stream</h2>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={perStream.filter((p) => p.sold > 0)}>
                <CartesianGrid stroke={C.edge} strokeDasharray="3 3" />
                <XAxis dataKey="date" {...axis} />
                <YAxis {...axis} tickFormatter={money$} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: any, n: any) => [$(Number(v)), n]}
                  labelFormatter={(l: any, payload: any) => payload?.[0]?.payload?.name || l}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: C.dim }} />
                <Line dataKey="spinValue" name="Avg spin value" stroke={C.blue} strokeWidth={2} dot />
                <Line dataKey="profitPerSpin" name="Profit per spin (mkt)" stroke={C.foil} strokeWidth={2} dot />
                <Line dataKey="buyProfitPerSpin" name="Profit per spin (buy)" stroke={C.win} strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </section>

          {/* Hours and effective hourly */}
          <section className="card p-5">
            <h2 className="label mb-4">Hours worked and effective hourly rate by week</h2>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={weekly}>
                <CartesianGrid stroke={C.edge} strokeDasharray="3 3" />
                <XAxis dataKey="label" {...axis} />
                <YAxis yAxisId="hrs" {...axis} />
                <YAxis yAxisId="rate" orientation="right" {...axis} tickFormatter={$0} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: any, n: any) =>
                    n === "Effective $/hr" ? [$(Number(v)), n] : [`${Number(v).toFixed(1)} hrs`, n]}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: C.dim }} />
                <Bar yAxisId="hrs" dataKey="hours" name="Stream hours" stackId="h" fill={C.blue} />
                <Bar yAxisId="hrs" dataKey="packingHours" name="Packing hours" stackId="h" fill={C.dim} radius={[4, 4, 0, 0]} />
                <Line yAxisId="rate" dataKey="effHourly" name="Effective $/hr" stroke={C.foil} strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
          </section>

          {/* Per streamer, only meaningful on the overview */}
          {sel === "all" && streamers.length > 1 && (
            <section className="card p-5">
              <h2 className="label mb-4">Totals by streamer</h2>
              <ResponsiveContainer width="100%" height={60 + streamers.length * 48}>
                <BarChart data={streamers} layout="vertical">
                  <CartesianGrid stroke={C.edge} strokeDasharray="3 3" />
                  <XAxis type="number" {...axis} tickFormatter={$0} />
                  <YAxis type="category" dataKey="name" {...axis} width={90} />
                  <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [$(Number(v)), n]} />
                  <Legend wrapperStyle={{ fontSize: 12, color: C.dim }} />
                  <Bar dataKey="pay" name="Total pay" fill={C.foil} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="profit" name="Profit generated (mkt)" fill={C.win} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>
          )}
          <div className="text-dim text-xs">
            Tips ride on top of pay and are excluded from the effective hourly rate. Spin metrics only count
            streams with spins recorded. Filtered views show that streamer&apos;s streams; overrides shown are
            the ones they earn as a manager.
          </div>
        </>
      )}
    </div>
  );
}
