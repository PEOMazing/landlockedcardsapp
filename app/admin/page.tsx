import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";
import { getSettings } from "@/lib/settings";
import { buildWeekPay, buildManagerPay, money, StreamRow, toLine } from "@/lib/calc";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isAdmin) redirect("/dashboard");

  const [settings, streamerRows, streamRows, lineRows] = await Promise.all([
    getSettings(),
    atList(T.streamers),
    atList(T.streams, { filterByFormula: "AND({Status} = 'Complete', {Deleted At} = BLANK())" }),
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
  for (const l of lineRows) {
    const sid = l.fields["Stream Rec Id"];
    if (!sid) continue;
    const line = toLine(l);
    // delivered hits only: unhit product returns to stock, so it is not a stream cost
    costByStream[sid] = (costByStream[sid] || 0) + line.qtyHit * line.buy;
    marketCostByStream[sid] = (marketCostByStream[sid] || 0) + line.qtyHit * line.market;
  }
  const rows: StreamRow[] = streamRows.map((r) => ({
    id: r.id,
    date: r.fields["Stream Date"],
    streamerId: r.fields["Streamer Rec Id"] || "unknown",
    streamerName: nameById[r.fields["Streamer Rec Id"]] || "Streamer",
    afterFees: r.fields["After Fees"] || 0,
    giveaways: r.fields["Giveaways Run"] || 0,
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
  const totalOverrides = managerWeeks.reduce((a, w) => a + w.overridePay, 0);
  const life = weeks.reduce(
    (a, w) => ({
      profit: a.profit + w.profit,
      buyProfit: a.buyProfit + w.buyProfit,
      pay: a.pay + w.totalPay,
      support: a.support + w.supportPay,
      company: a.company + w.companyProfit,
    }),
    { profit: 0, buyProfit: 0, pay: 0, support: 0, company: 0 }
  );
  life.company -= totalOverrides; // manager packing is already netted inside commissionable
  const mgrByWeek = new Map<string, typeof managerWeeks>();
  for (const w of managerWeeks) {
    if (!mgrByWeek.has(w.weekStart)) mgrByWeek.set(w.weekStart, []);
    mgrByWeek.get(w.weekStart)!.push(w);
  }

  const byWeek = new Map<string, typeof weeks>();
  for (const w of weeks) {
    if (!byWeek.has(w.weekStart)) byWeek.set(w.weekStart, []);
    byWeek.get(w.weekStart)!.push(w);
  }

  return (
    <>
      <Nav isAdmin name={me.streamer?.fields?.["Name"] || "Admin"} />
      <main className="max-w-6xl mx-auto p-6 space-y-8">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display, sans-serif)" }}>Pay dashboard</h1>

        <section className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Big label="Profit over market" v={money(life.profit)} />
          <Big label="Profit over buy" v={money(life.buyProfit)} />
          <Big label="Streamer pay" v={money(life.pay)} />
          <Big label="Manager overrides" v={money(totalOverrides)} />
          <Big label="Stream support" v={money(life.support)} />
          <Big label="Company profit" v={money(life.company)} win />
        </section>

        {[...byWeek.entries()].map(([ws, group]) => (
          <section key={ws}>
            <h2 className="label mb-2">Week of {group[0].weekLabel}</h2>
            <div className="card overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Streamer</th><th>Streams</th><th>Profit (mkt)</th><th>Profit (buy)</th><th>Packing</th>
                    <th>Commissionable</th><th>Hourly (A)</th><th>Commission (B)</th>
                    <th>Stream pay</th><th>Total pay</th><th>Support</th><th>Company</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((w) => (
                    <tr key={w.streamerId}>
                      <td className="!font-medium">{w.streamerName}</td>
                      <td>{w.streams.length}</td>
                      <td>{money(w.profit)}</td>
                      <td>{money(w.buyProfit)}</td>
                      <td>{money(w.packingPay)}</td>
                      <td>{money(w.commissionable)}</td>
                      <td className={w.winner === "hourly" ? "text-win font-semibold" : ""}>{money(w.optionA)}</td>
                      <td className={w.winner === "commission" ? "text-win font-semibold" : ""}>{money(w.optionB)}</td>
                      <td>{money(w.streamPay)}</td>
                      <td className="!font-semibold">{money(w.totalPay)}</td>
                      <td>{money(w.supportPay)}</td>
                      <td className={w.companyProfit < 0 ? "text-bad" : "text-win"}>{money(w.companyProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(mgrByWeek.get(ws) || []).length > 0 && (
                <table className="w-full border-t-2 border-edge">
                  <thead>
                    <tr>
                      <th>Manager</th><th>Streams</th><th>Managed commissionable</th>
                      <th>After streamer pay</th><th>Override %</th><th>Override pay</th><th>Packing</th><th>Manager total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(mgrByWeek.get(ws) || []).map((m) => (
                      <tr key={m.managerId}>
                        <td className="!font-medium">{m.managerName} <span className="text-dim text-xs">manager</span></td>
                        <td>{m.streamCount}</td>
                        <td>{money(m.managedCommissionable)}</td>
                        <td>{money(m.overrideBase)}</td>
                        <td>{(m.overridePct * 100).toFixed(1)}%</td>
                        <td>{money(m.overridePay)}</td>
                        <td>{money(m.packingPay)}</td>
                        <td className="!font-semibold">{money(m.totalPay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        ))}
        {weeks.length === 0 && (
          <div className="card p-6 text-dim text-sm">No completed streams yet.</div>
        )}
      </main>
    </>
  );
}

function Big({ label, v, win }: { label: string; v: string; win?: boolean }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`text-xl font-bold num mt-1 ${win ? "text-win" : ""}`}>{v}</div>
    </div>
  );
}
