import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";
import { getSettings } from "@/lib/settings";
import { buildWeekPay, buildManagerPay, money, StreamRow, toLine, isHitLine } from "@/lib/calc";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isAdmin) redirect("/dashboard");

  const [settings, streamerRows, streamRows, lineRows] = await Promise.all([
    getSettings(),
    atList(T.streamers),
    atList(T.streams, {
      filterByFormula: "{Status} = 'Complete'",
      "sort[0][field]": "Stream Date",
      "sort[0][direction]": "desc",
    }),
    atList(T.lines),
  ]);

  const nameById: Record<string, string> = {};
  const rateById: Record<string, number> = {};
  const overrideById: Record<string, number> = {};
  for (const s of streamerRows) {
    nameById[s.id] = s.fields["Name"] || "Streamer";
    if (typeof s.fields["Hourly Rate"] === "number") rateById[s.id] = s.fields["Hourly Rate"];
    if (typeof s.fields["Override %"] === "number") overrideById[s.id] = s.fields["Override %"];
  }
  const costByStream: Record<string, number> = {};
  const marketCostByStream: Record<string, number> = {};
  const spotsByStream: Record<string, number> = {};
  const hitsByStream: Record<string, number> = {};
  const hitPoolByStream: Record<string, number> = {};
  const completedIds = new Set(streamRows.map((r) => r.id));
  type ProdAgg = { name: string; appearances: number; qty: number; hits: number; marketValue: number; hitValue: number; isHit: boolean };
  const prodAgg = new Map<string, ProdAgg>();
  let hitPoolQty = 0, hitsDelivered = 0, hitPoolValue = 0;
  for (const l of lineRows) {
    const sid = l.fields["Stream Rec Id"];
    if (!sid) continue;
    const line = toLine(l);
    const isHit = isHitLine(line, settings);
    costByStream[sid] = (costByStream[sid] || 0) + line.qty * line.buy;
    marketCostByStream[sid] = (marketCostByStream[sid] || 0) + line.qty * line.market;
    if (!line.isGiveaway) spotsByStream[sid] = (spotsByStream[sid] || 0) + line.qty;
    // hits = higher-value non-pack items only (market > hit_threshold)
    if (isHit) {
      hitsByStream[sid] = (hitsByStream[sid] || 0) + line.qtyHit;
      hitPoolByStream[sid] = (hitPoolByStream[sid] || 0) + line.qty;
    }
    if (completedIds.has(sid)) {
      if (isHit) {
        hitPoolQty += line.qty;
        hitsDelivered += line.qtyHit;
        hitPoolValue += line.qty * line.market;
      }
      const name = line.name.replace(/^\d+x\s+/, "");
      const a = prodAgg.get(name) || { name, appearances: 0, qty: 0, hits: 0, marketValue: 0, hitValue: 0, isHit };
      a.appearances += 1;
      a.qty += line.qty;
      a.hits += line.qtyHit;
      a.marketValue += line.qty * line.market;
      a.hitValue += line.qtyHit * line.market;
      a.isHit = a.isHit || isHit;
      prodAgg.set(name, a);
    }
  }
  const products = [...prodAgg.values()].sort(
    (a, b) => Number(b.isHit) - Number(a.isHit) || b.hits - a.hits || b.qty - a.qty
  );

  const soldByStream: Record<string, number> = {};
  for (const r of streamRows) soldByStream[r.id] = r.fields["Spots Sold"] || 0;

  const rows: StreamRow[] = streamRows.map((r) => ({
    id: r.id,
    date: r.fields["Stream Date"],
    streamerId: r.fields["Streamer Rec Id"] || "unknown",
    streamerName: nameById[r.fields["Streamer Rec Id"]] || "Streamer",
    afterFees: r.fields["After Fees"] || 0,
    promotion: r.fields["Promotion"] || 0,
    tips: r.fields["Tips"] || 0,
    hours: r.fields["Hours Streamed"] || 0,
    packingHours: r.fields["Packing Hours"] || 0,
    managerPackingHours: r.fields["Manager Packing Hours"] || 0,
    managerId: r.fields["Manager Rec Id"] || null,
    productCost: costByStream[r.id] || 0,
    productMarketCost: marketCostByStream[r.id] || 0,
    status: r.fields["Status"] || "Planned",
  }));

  const weeks = buildWeekPay(rows, settings, rateById);
  const managerWeeks = buildManagerPay(rows, settings, overrideById, nameById, rateById);

  // per-stream P&L rows: everything here is exact per stream; wages settle weekly
  const pnl = rows.map((r) => {
    const packingCost = (r.packingHours + r.managerPackingHours) * settings.packing_rate;
    const contribution = r.afterFees - r.promotion - r.productCost - r.tips - packingCost;
    return {
      ...r,
      packingCost,
      contribution,
      spots: spotsByStream[r.id] || 0,
      sold: soldByStream[r.id] || 0,
      hits: hitsByStream[r.id] || 0,
      hitPool: hitPoolByStream[r.id] || 0,
      revPerHour: r.hours > 0 ? r.afterFees / r.hours : 0,
    };
  });

  // company totals
  const tot = pnl.reduce(
    (a, r) => ({
      revenue: a.revenue + r.afterFees,
      tips: a.tips + r.tips,
      promo: a.promo + r.promotion,
      cost: a.cost + r.productCost,
      packingCost: a.packingCost + r.packingCost,
      contribution: a.contribution + r.contribution,
      hours: a.hours + r.hours,
      packingHours: a.packingHours + r.packingHours + r.managerPackingHours,
      spots: a.spots + r.spots,
      sold: a.sold + r.sold,
    }),
    { revenue: 0, tips: 0, promo: 0, cost: 0, packingCost: 0, contribution: 0, hours: 0, packingHours: 0, spots: 0, sold: 0 }
  );

  const streamerPayTotal = weeks.reduce((a, w) => a + w.streamPay, 0);
  const streamerPackingTotal = weeks.reduce((a, w) => a + w.packingPay, 0);
  const supportTotal = weeks.reduce((a, w) => a + w.supportPay, 0);
  const overrideTotal = managerWeeks.reduce((a, w) => a + w.overridePay, 0);
  const managerPackingTotal = managerWeeks.reduce((a, w) => a + w.packingPay, 0);
  const totalWages =
    streamerPayTotal + streamerPackingTotal + managerPackingTotal + tot.tips + supportTotal + overrideTotal;
  const companyNet =
    weeks.reduce((a, w) => a + w.companyProfit, 0) - overrideTotal;

  // per-streamer rollup (wages = their weekly pay + any manager pay they earned)
  const byPerson = new Map<string, any>();
  for (const r of pnl) {
    const p = byPerson.get(r.streamerId) || {
      name: r.streamerName, streams: 0, hours: 0, revenue: 0, contribution: 0, wages: 0,
    };
    p.streams += 1; p.hours += r.hours; p.revenue += r.afterFees; p.contribution += r.contribution;
    byPerson.set(r.streamerId, p);
  }
  for (const w of weeks) {
    const p = byPerson.get(w.streamerId);
    if (p) p.wages += w.totalPay;
  }
  for (const w of managerWeeks) {
    const p = byPerson.get(w.managerId) || {
      name: w.managerName, streams: 0, hours: 0, revenue: 0, contribution: 0, wages: 0,
    };
    p.wages += w.totalPay;
    byPerson.set(w.managerId, p);
  }

  const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + "%" : "-");

  return (
    <>
      <Nav isAdmin name={me.streamer?.fields?.["Name"] || "Admin"} />
      <main className="max-w-6xl mx-auto p-6 space-y-8">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Analytics and P&amp;L
        </h1>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Big label="Revenue (after fees)" v={money(tot.revenue)} />
          <Big label="Total wages paid" v={money(totalWages)} />
          <Big label="Hours streamed" v={tot.hours.toFixed(1)} />
          <Big label="Company net" v={money(companyNet)} win={companyNet >= 0} bad={companyNet < 0} />
          <Big label="Product cost" v={money(tot.cost)} />
          <Big label="Wage % of revenue" v={pct(totalWages, tot.revenue)} />
          <Big label="Packing hours" v={tot.packingHours.toFixed(1)} />
          <Big label="Revenue per streamed hr" v={tot.hours > 0 ? money(tot.revenue / tot.hours) : "-"} />
          <Big label="Spots sold" v={String(tot.spots)} />
          <Big label="Streams completed" v={String(pnl.length)} />
          <Big label="Avg revenue per stream" v={pnl.length ? money(tot.revenue / pnl.length) : "-"} />
          <Big label="Company net per streamed hr" v={tot.hours > 0 ? money(companyNet / tot.hours) : "-"} />
        </section>

        <section className="card p-5">
          <h2 className="label mb-3">Wage breakdown</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-y-2 text-sm">
            <Line l="Streamer pay (higher of hourly / commission)" v={money(streamerPayTotal)} />
            <Line l="Streamer packing" v={money(streamerPackingTotal)} />
            <Line l="Manager packing" v={money(managerPackingTotal)} />
            <Line l="Tips passed through" v={money(tot.tips)} />
            <Line l="Manager overrides" v={money(overrideTotal)} />
            <Line l="Stream support" v={money(supportTotal)} />
          </div>
        </section>

        <section>
          <h2 className="label mb-2">By person</h2>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr><th>Person</th><th>Streams</th><th>Hours</th><th>Revenue</th><th>Contribution</th><th>Wages earned</th><th>Rev / hr</th></tr>
              </thead>
              <tbody>
                {[...byPerson.values()].map((p: any) => (
                  <tr key={p.name} className={p.isHit ? "" : "opacity-50"}>
                    <td className="!font-medium">
                      {p.name}
                      {p.isHit && <span className="text-foil text-xs ml-2 font-bold">HIT</span>}
                    </td>
                    <td>{p.streams}</td>
                    <td>{p.hours.toFixed(1)}</td>
                    <td>{money(p.revenue)}</td>
                    <td className={p.contribution < 0 ? "text-bad" : ""}>{money(p.contribution)}</td>
                    <td>{money(p.wages)}</td>
                    <td>{p.hours > 0 ? money(p.revenue / p.hours) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="label mb-2">Hit tracking - items over ${settings.hit_threshold}</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <Big label="Hit pool run (items)" v={String(hitPoolQty)} />
            <Big label="Hits delivered" v={String(hitsDelivered)} />
            <Big label="Pool delivered rate" v={hitPoolQty > 0 ? ((hitsDelivered / hitPoolQty) * 100).toFixed(0) + "%" : "-"} />
            <Big label="Spins sold (lifetime)" v={String(tot.sold)} />
            <Big label="Hit rate per spin sold" v={tot.sold > 0 ? ((hitsDelivered / tot.sold) * 100).toFixed(1) + "%" : "-"} />
          </div>
          <p className="text-dim text-xs mb-4">
            Pool delivered rate is the forecasting number: put 40 hits in a show and history says that
            percentage of them will go. Hit rate per spin sold is the buyer-side view: of the spins that
            sold, how many came out as hits.
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Product</th><th>Shows</th><th>Qty run</th><th>Delivered</th><th>Delivered rate</th>
                  <th>Market value run</th><th>Hit value delivered</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.name} className={p.isHit ? "" : "opacity-50"}>
                    <td className="!font-medium">
                      {p.name}
                      {p.isHit && <span className="text-foil text-xs ml-2 font-bold">HIT</span>}
                    </td>
                    <td>{p.appearances}</td>
                    <td>{p.qty}</td>
                    <td className="!font-semibold">{p.hits}</td>
                    <td>{p.qty > 0 ? ((p.hits / p.qty) * 100).toFixed(0) + "%" : "-"}</td>
                    <td>{money(p.marketValue)}</td>
                    <td>{money(p.hitValue)}</td>
                  </tr>
                ))}
                {products.length === 0 && <tr><td colSpan={7} className="text-dim">No product data yet</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="label mb-2">Per-stream P&amp;L</h2>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Date</th><th>Streamer</th><th>Revenue</th><th>Tips</th><th>Promo</th>
                  <th>Cost (buy)</th><th>Cost (mkt)</th><th>Packing</th><th>Contribution</th><th>Spots</th><th>Sold</th><th>$ / spin</th><th>Profit / spin</th><th>Hits</th><th>Pool %</th><th>Hit / spin</th><th>Hours</th><th>Rev / hr</th>
                </tr>
              </thead>
              <tbody>
                {pnl.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td className="!font-medium">{r.streamerName}</td>
                    <td>{money(r.afterFees)}</td>
                    <td>{money(r.tips)}</td>
                    <td>{money(r.promotion)}</td>
                    <td>{money(r.productCost)}</td>
                    <td>{money(r.productMarketCost)}</td>
                    <td>{money(r.packingCost)}</td>
                    <td className={r.contribution < 0 ? "text-bad !font-semibold" : "text-win !font-semibold"}>
                      {money(r.contribution)}
                    </td>
                    <td>{r.spots}</td>
                    <td>{r.sold || "-"}</td>
                    <td>{r.sold > 0 ? money(r.afterFees / r.sold) : "-"}</td>
                    <td className={r.sold > 0 && r.contribution < 0 ? "text-bad" : ""}>{r.sold > 0 ? money(r.contribution / r.sold) : "-"}</td>
                    <td>{r.hits}</td>
                    <td>{r.hitPool > 0 ? ((r.hits / r.hitPool) * 100).toFixed(0) + "%" : "-"}</td>
                    <td>{r.sold > 0 ? ((r.hits / r.sold) * 100).toFixed(1) + "%" : "-"}</td>
                    <td>{r.hours.toFixed(1)}</td>
                    <td>{r.hours > 0 ? money(r.revPerHour) : "-"}</td>
                  </tr>
                ))}
                {pnl.length === 0 && <tr><td colSpan={15} className="text-dim">No completed streams yet</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-dim text-xs mt-2">
            Contribution = revenue minus promo, product cost, tips, and packing - the exact profit each stream
            adds before wages. Streamer pay, support, and overrides settle weekly (the greater-of rule needs
            the whole week), so those live on the Pay Dashboard and in the totals above rather than per stream.
          </p>
        </section>
      </main>
    </>
  );
}

function Big({ label, v, win, bad }: { label: string; v: string; win?: boolean; bad?: boolean }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`text-xl font-bold num mt-1 ${win ? "text-win" : ""} ${bad ? "text-bad" : ""}`}>{v}</div>
    </div>
  );
}

function Line({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 pr-6">
      <span className="text-dim">{l}</span>
      <span className="num font-semibold">{v}</span>
    </div>
  );
}
