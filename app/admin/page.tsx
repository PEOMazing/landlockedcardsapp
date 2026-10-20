import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";
import { getSettings } from "@/lib/settings";
import { buildWeekPay, buildManagerPay, buildPersonHours, money, StreamRow, toLine } from "@/lib/calc";
import StatTile from "@/components/ui/StatTile";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isAdmin) redirect("/dashboard");

  const [settings, streamerRows, streamRows, lineRows, timeRows] = await Promise.all([
    getSettings(),
    atList(T.streamers),
    atList(T.streams, { filterByFormula: "AND({Status} = 'Complete', {Deleted At} = BLANK())" }),
    atList(T.lines),
    atList(T.time),
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
    // delivered hits only: unhit product returns to stock, so it is not a stream cost.
    // giveaway lines stay out - they are charged at the flat giveaway rate via the
    // giveaways-run counter, and counting them at market here double-charged them.
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
    singlesGiveaways: r.fields["Singles Giveaways Run"] || 0,
    promotion: r.fields["Promotion"] || 0,
    shipAdj: r.fields["Shipping Adjustments"] || 0,
    tips: r.fields["Tips"] || 0,
    hours: r.fields["Hours Streamed"] || 0,
    packingHours: r.fields["Packing Hours"] || 0,
    managerPackingHours: r.fields["Manager Packing Hours"] || 0,
    packingRate: r.fields["Packing Rate"] ?? null,
    // pk-v5: without Packing Fee here, isFlatPacking is false and a flat show
    // prices itself by the hour, which on a flat show is zero.
    packingFee: r.fields["Packing Fee"] ?? null,
    packerId: r.fields["Packer Rec Id"] || null,
    managerId: r.fields["Manager Rec Id"] || null,
    overrideId: r.fields["Override Rec Id"] || null,
    productCost: costByStream[r.id] || 0,
    productMarketCost: marketCostByStream[r.id] || 0,
    status: r.fields["Status"] || "Planned",
    overrideExcluded: !!r.fields["Override Excluded"],
  }));

  // hp-v1: pay follows the person who clocked the hours (shared shows split)
  const personHours = buildPersonHours(
    rows.map((r) => ({ id: r.id, date: r.date, status: r.status, packerId: r.packerId, streamerId: r.streamerId, tips: r.tips, packingRate: r.packingRate, packingFee: r.packingFee })),
    (timeRows as any[]).map((e) => ({
      streamId: e.fields["Stream Rec Id"] || "", personId: e.fields["Person Rec Id"] || "",
      type: e.fields["Type"] || "", hours: e.fields["Hours"] || 0,
    })),
    settings
  );
  const weeks = buildWeekPay(rows, settings, rateById, { personHours, namesById: nameById });
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
        <h1 className="t-page">Pay dashboard</h1>

        <section className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatTile label="Profit over market" value={money(life.profit)} size="md" />
          <StatTile label="Profit over buy" value={money(life.buyProfit)} size="md" />
          <StatTile label="Streamer pay" value={money(life.pay)} size="md" />
          <StatTile label="Manager overrides" value={money(totalOverrides)} size="md" />
          <StatTile label="Company profit" value={money(life.company)} size="md" tone="win" />
        </section>

        {[...byWeek.entries()].map(([ws, group]) => {
          // pd-v2. The three numbers that answer "how did the week go" without
          // reading a row of the table: what came in, what was left after the
          // product went out the door at market, and what it cost in wages.
          //
          // Everyone combined, streamers and managers both, because payroll is
          // payroll - splitting it by role is what the rows below are for.
          const mgr = mgrByWeek.get(ws) || [];
          const sales = group.reduce((a, w) => a + w.streams.reduce((b, r) => b + r.afterFees, 0), 0);
          const weekProfit = group.reduce((a, w) => a + w.profit, 0);
          // pd-v3. Tips get their own tile instead of hiding inside payroll.
          //
          // A tip is the customer's money handed straight through to the
          // streamer. It never enters After Fees, so it is not in profit, and
          // it must not be deducted either - doing that charges the business
          // for money it never took. But it IS on the cheque, so leaving it
          // silently inside a Payroll figure that the net then ignores makes
          // the row of tiles fail to add up, and a number you cannot check by
          // eye is a number you end up not trusting.
          //
          // So payroll here is WAGES ONLY and tips stand beside it. The tiles
          // now reconcile exactly: profit - payroll = net, and the
          // cheque you actually write is payroll + tips.
          const weekTips = group.reduce((a, w) => a + w.tips, 0);
          const weekPayroll =
            group.reduce((a, w) => a + w.totalPay, 0) + mgr.reduce((a, m) => a + m.totalPay, 0) - weekTips;
          // pd-v4. Support is NOT deducted, and is not shown here.
          //
          // The engine computes a 10% "stream support" share of profit after
          // streamer pay, and the old Company figure charged the business for
          // it. Per Gabe 2026-10-20 the deal is $20 an hour plus tips, full
          // stop: nobody is paid support, and the payroll page has never
          // listed it as owed to a single person. Deducting it was charging
          // the business for money that never leaves the bank, which made
          // every week read poorer than it was.
          //
          // The field stays on WeekPay because Insights and Analytics still
          // chart it. It just does not belong in a figure that claims to be
          // what the week actually made.
          const weekNet = weekProfit - weekPayroll;
          return (
          <section key={ws}>
            <h2 className="label mb-2">Week of {group[0].weekLabel}</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-2">
              <StatTile label="Sales after fees" value={money(sales)} size="md" />
              <StatTile label="Profit over market" value={money(weekProfit)} size="md" tone={weekProfit >= 0 ? "win" : "bad"} />
              <StatTile label="Payroll" value={money(weekPayroll)} size="md" />
              <StatTile label="Tips through" value={money(weekTips)} size="md" />
              <StatTile label="Net over market" value={money(weekNet)} size="md" tone={weekNet >= 0 ? "win" : "bad"} />
            </div>
            <p className="text-dim text-xs mb-3">
              Profit less payroll is the net, so the tiles add up as they read. Payroll is wages:
              hours at rate, packing, manager overrides. Tips sit outside it on purpose - the
              customer gave that money straight to the streamer, so it is in neither the sales
              figure nor the net, but you do pay it out, and the cheque for the week is{" "}
              {money(weekPayroll)} plus {money(weekTips)} in tips ={" "}
              <span className="num">{money(weekPayroll + weekTips)}</span>. Everything is over
              MARKET, so a positive net beat the shelf price, not merely what you paid.
            </p>
            <div className="card overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Streamer</th><th>Streams</th><th>Profit (mkt)</th><th>Profit (buy)</th><th>Packing</th>
                    <th>Commissionable</th><th>Hourly (A)</th><th>Commission (B)</th>
                    <th>Stream pay</th><th>Total pay</th>
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
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* pd-v5. Two different jobs, two different tables.
                  
                  Everyone who packed a show landed in a table headed Manager,
                  with Override % and Override pay columns reading 0.0% and
                  $0.00 beside their name. Packing a show does not make
                  somebody a manager and it does not earn an override, so the
                  page was asserting two things that are not true and then
                  printing zeroes to prove it. The data already knew the
                  difference - earnsOverride has been on the row all along -
                  the table just never asked.
                  
                  Nobody earns an override this week: show what actually
                  happened, which is that people packed shows for a fee. */}
              {mgr.length > 0 && !mgr.some((m) => m.earnsOverride) && (
                <table className="w-full border-t-2 border-edge">
                  <thead>
                    <tr><th>Packer</th><th>Shows packed</th><th>Packing pay</th></tr>
                  </thead>
                  <tbody>
                    {mgr.map((m) => (
                      <tr key={m.managerId}>
                        <td className="!font-medium">{m.managerName} <span className="text-dim text-xs">packer</span></td>
                        <td>{m.packedCount}</td>
                        <td className="!font-semibold">{money(m.packingPay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {mgr.some((m) => m.earnsOverride) && (
                <table className="w-full border-t-2 border-edge">
                  <thead>
                    <tr>
                      <th>Person</th><th>Streams</th><th>Managed commissionable</th>
                      <th>After streamer pay</th><th>Override %</th><th>Override pay</th><th>Packing</th><th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mgr.map((m) => (
                      <tr key={m.managerId}>
                        <td className="!font-medium">
                          {m.managerName}{" "}
                          <span className="text-dim text-xs">{m.earnsOverride ? "override" : "packer"}</span>
                        </td>
                        <td>{m.earnsOverride ? m.streamCount : m.packedCount}</td>
                        <td>{m.earnsOverride ? money(m.managedCommissionable) : ""}</td>
                        <td>{m.earnsOverride ? money(m.overrideBase) : ""}</td>
                        <td>{m.earnsOverride ? `${(m.overridePct * 100).toFixed(1)}%` : ""}</td>
                        <td>{m.earnsOverride ? money(m.overridePay) : ""}</td>
                        <td>{money(m.packingPay)}</td>
                        <td className="!font-semibold">{money(m.totalPay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
          );
        })}
        {weeks.length === 0 && (
          <div className="card p-6 text-dim text-sm">No completed streams yet.</div>
        )}
      </main>
    </>
  );
}
