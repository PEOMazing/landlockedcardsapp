"use client";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { buildWeekPay, buildManagerPay, StreamRow } from "@/lib/calc";
import type { Settings } from "@/lib/settings";
import StatTile from "@/components/ui/StatTile";
import useThemeColors from "@/components/ui/useThemeColors";

const $ = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $0 = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });


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

  // Chart chrome and series colours, from the same tokens as the rest of the
  // app. These used to be nine hex values frozen to the dark theme.
  const c = useThemeColors();
  const tooltipStyle = useMemo(() => ({
    contentStyle: { background: c.panel, border: `1px solid ${c.edge}`, borderRadius: 8, color: c.body },
    labelStyle: { color: c.dim },
  }), [c]);
  const axis = useMemo(() => ({ stroke: c.dim, fontSize: 11 }), [c]);

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
      revenue: number; marketProfit: number;
      streamerPay: number; supportPay: number; overridePay: number; companyProfit: number;
      commissionPaid: number; hourlyPaid: number; packingPay: number; tips: number;
      hours: number; packingHours: number; effHourly: number;
      spins: number; spinValue: number; profitPerSpin: number;
    };
    const blank = (week: string, label: string): Wk => ({
      week, label, revenue: 0, marketProfit: 0,
      streamerPay: 0, supportPay: 0, overridePay: 0, companyProfit: 0,
      commissionPaid: 0, hourlyPaid: 0, packingPay: 0, tips: 0,
      hours: 0, packingHours: 0, effHourly: 0, spins: 0, spinValue: 0, profitPerSpin: 0,
    });
    const wkMap = new Map<string, Wk>();
    for (const w of weeks) {
      const agg = wkMap.get(w.weekStart) || blank(w.weekStart, w.weekLabel);
      agg.marketProfit += w.profit;
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
          // tips arrive outside After Fees, so they never come out of profit
          profitPerSpin: sold > 0 ? (r.afterFees - r.promotion - (r.shipAdj || 0) - r.productMarketCost) / sold : 0,
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
            <StatTile label="Total sales (after fees)" value={$0(totals.revenue)} size="md" />
            <StatTile label="Profit over market" value={$0(totals.marketProfit)} size="md" tone={totals.marketProfit >= 0 ? "win" : "bad"} />
            {sel === "all" && (
              <StatTile label="Company profit" value={$0(totals.companyProfit)} size="md" tone={totals.companyProfit >= 0 ? "win" : "bad"} />
            )}
            <StatTile label="Streamer pay (all-in)" value={$0(totals.streamerPay)} size="md" />
            <StatTile label="Commission paid" value={$0(totals.commissionPaid)} size="md" />
            <StatTile label="Hourly paid" value={$0(totals.hourlyPaid)} size="md" />
            <StatTile label="Tips received" value={$0(totals.tips)} size="md" />
            {totals.overridePay > 0 && <StatTile label="Manager overrides" value={$0(totals.overridePay)} size="md" />}
            <StatTile label="Hours worked (stream + pack)" value={(totals.hours + totals.packingHours).toFixed(1)} size="md" />
            <StatTile label="Effective hourly (pay / hrs)" value={$(totals.effHourly)} size="md" />
            <StatTile label="Avg spin value" value={$(totals.spinValue)} size="md" />
            <StatTile label="Avg profit per spin" value={$(totals.profitPerSpin)} size="md" />
          </section>

          {/* Revenue vs profit by week */}
          <section className="card p-5">
            <h2 className="label mb-4">Revenue and profit by week</h2>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={weekly}>
                <CartesianGrid stroke={c.edge} strokeDasharray="3 3" />
                <XAxis dataKey="label" {...axis} />
                <YAxis {...axis} tickFormatter={$0} />
                <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [$(Number(v)), n]} />
                <Legend wrapperStyle={{ fontSize: 12, color: c.dim }} />
                <Bar dataKey="revenue" name="Sales (after fees)" fill={c.foil} radius={[4, 4, 0, 0]} />
                <Line dataKey="marketProfit" name="Profit over market" stroke={c.warn} strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
          </section>

          {/* Where the money goes */}
          <section className="card p-5">
            <h2 className="label mb-4">{sel === "all" ? "Where the money goes by week" : "Pay by week"}</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={weekly}>
                <CartesianGrid stroke={c.edge} strokeDasharray="3 3" />
                <XAxis dataKey="label" {...axis} />
                <YAxis {...axis} tickFormatter={$0} />
                <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [$(Number(v)), n]} />
                <Legend wrapperStyle={{ fontSize: 12, color: c.dim }} />
                <Bar dataKey="streamerPay" name="Streamer pay" stackId="a" fill={c.warn} />
                <Bar dataKey="supportPay" name="Support" stackId="a" fill={c.givvy} />
                <Bar dataKey="overridePay" name="Overrides" stackId="a" fill={c.dim} />
                {sel === "all" && <Bar dataKey="companyProfit" name="Company profit" stackId="a" fill={c.win} radius={[4, 4, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </section>

          {/* Spin economics per stream */}
          <section className="card p-5">
            <h2 className="label mb-4">Spin economics per stream</h2>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={perStream.filter((p) => p.sold > 0)}>
                <CartesianGrid stroke={c.edge} strokeDasharray="3 3" />
                <XAxis dataKey="date" {...axis} />
                <YAxis {...axis} tickFormatter={money$} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: any, n: any) => [$(Number(v)), n]}
                  labelFormatter={(l: any, payload: any) => payload?.[0]?.payload?.name || l}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: c.dim }} />
                <Line dataKey="spinValue" name="Avg spin value" stroke={c.foil} strokeWidth={2} dot />
                <Line dataKey="profitPerSpin" name="Profit per spin" stroke={c.warn} strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </section>

          {/* Hours and effective hourly */}
          <section className="card p-5">
            <h2 className="label mb-4">Hours worked and effective hourly rate by week</h2>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={weekly}>
                <CartesianGrid stroke={c.edge} strokeDasharray="3 3" />
                <XAxis dataKey="label" {...axis} />
                <YAxis yAxisId="hrs" {...axis} />
                <YAxis yAxisId="rate" orientation="right" {...axis} tickFormatter={$0} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: any, n: any) =>
                    n === "Effective $/hr" ? [$(Number(v)), n] : [`${Number(v).toFixed(1)} hrs`, n]}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: c.dim }} />
                <Bar yAxisId="hrs" dataKey="hours" name="Stream hours" stackId="h" fill={c.foil} />
                <Bar yAxisId="hrs" dataKey="packingHours" name="Packing hours" stackId="h" fill={c.dim} radius={[4, 4, 0, 0]} />
                <Line yAxisId="rate" dataKey="effHourly" name="Effective $/hr" stroke={c.warn} strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
          </section>

          {/* Per streamer, only meaningful on the overview */}
          {sel === "all" && streamers.length > 1 && (
            <section className="card p-5">
              <h2 className="label mb-4">Totals by streamer</h2>
              <ResponsiveContainer width="100%" height={60 + streamers.length * 48}>
                <BarChart data={streamers} layout="vertical">
                  <CartesianGrid stroke={c.edge} strokeDasharray="3 3" />
                  <XAxis type="number" {...axis} tickFormatter={$0} />
                  <YAxis type="category" dataKey="name" {...axis} width={90} />
                  <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [$(Number(v)), n]} />
                  <Legend wrapperStyle={{ fontSize: 12, color: c.dim }} />
                  <Bar dataKey="pay" name="Total pay" fill={c.warn} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="profit" name="Profit generated" fill={c.win} radius={[0, 4, 4, 0]} />
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
