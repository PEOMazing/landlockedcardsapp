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
  // pd-v8. The top strip is the running total of the weekly tiles below it,
  // the same five measures summed over every completed week, so the two read
  // the same way and a weekly number can be traced into the lifetime one.
  //
  // What it replaced: Streamer pay, Manager overrides and Company profit.
  // Overrides are a closed chapter - the only person who ever earned one has
  // left - and Company profit ran on BUY cost with support deducted, so it
  // was the one headline figure on the page computed by rules nothing else
  // used, and it flattered every week by pricing stock at what it cost rather
  // than what it is worth.
  //
  // Tips are summed and then taken back out of payroll for the same reason
  // they are in the weekly tiles: the customer's money, passed through, never
  // in the sales figure, so never deducted from it.
  const lifeTips = weeks.reduce((a, w) => a + w.tips, 0);
  const lifeSales = weeks.reduce((a, w) => a + w.streams.reduce((b, r) => b + r.afterFees, 0), 0);
  const lifePayroll =
    weeks.reduce((a, w) => a + w.totalPay, 0)
    + managerWeeks.reduce((a, m) => a + m.totalPay, 0)
    - lifeTips;
  const life = weeks.reduce(
    (a, w) => ({ profit: a.profit + w.profit, buyProfit: a.buyProfit + w.buyProfit }),
    { profit: 0, buyProfit: 0 }
  );
  const lifeNet = life.profit - lifePayroll;
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
        <p className="text-dim text-xs -mt-4">All time, every completed stream. The weeks below use the same measures.</p>

        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatTile label="Sales after fees" value={money(lifeSales)} size="md" />
          <StatTile label="Profit over market" value={money(life.profit)} size="md" tone={life.profit >= 0 ? "win" : "bad"} />
          <StatTile label="Payroll" value={money(lifePayroll)} size="md" />
          <StatTile label="Tips through" value={money(lifeTips)} size="md" />
          <StatTile label="Net over market" value={money(lifeNet)} size="md" tone={lifeNet >= 0 ? "win" : "bad"} />
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
          // pd-v6. Packing and override are paid through the manager path but
          // belong on the person's own row, so they are looked up by id rather
          // than printed in a table of their own.
          const mgrByPerson = new Map(mgr.map((m) => [m.managerId, m]));
          const anyOverride = mgr.some((m) => m.earnsOverride);
          // pd-v7. Commission is shown only in a week where it actually wins.
          // It has never won - it needs $100 of profit per clocked hour - so a
          // Commission column and a Commissionable column were two columns of
          // arithmetic nobody is paid, sitting beside the one number that is.
          const anyCommission = group.some((w) => w.winner === "commission");
          const streamed = new Set(group.map((w) => w.streamerId));
          const packOnly = mgr.filter((m) => !streamed.has(m.managerId));
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
            {/* pd-v6. One row per person, one total.
                
                This was two tables: streamers, then a second table for
                whoever packed. Under the flat $35 deal that split quietly
                broke the arithmetic. Packing in the streamer row means HOURLY
                packing off that person's own timeclock, and a flat show has
                no hours, so the column read $0.00 for everyone while the fee
                sat in the table below. Alyssa's "Total pay" said $510.40 when
                she was owed $860.40.
                
                A column called Total Pay that is not the total is how someone
                gets underpaid, so the tables are now one. Packing is the real
                figure, hourly and flat together, tips are visible rather than
                folded silently into the total, and Total is everything that
                person is owed for the week.
                
                Override only appears in a week where somebody earns one.
                People who packed but did not stream still get a row. */}
            <div className="card overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Person</th><th>Streams</th><th>Profit (mkt)</th><th>Profit (buy)</th>
                    <th>Hourly</th>
                    {anyCommission && <th>Commission</th>}
                    <th>Tips</th><th>Packing</th>
                    {anyOverride && <th>Override</th>}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((w) => {
                    const extra = mgrByPerson.get(w.streamerId);
                    const packing = w.packingPay + (extra?.packingPay || 0);
                    const total = w.totalPay + (extra?.totalPay || 0);
                    return (
                    <tr key={w.streamerId}>
                      <td className="!font-medium">{w.streamerName}</td>
                      <td>{w.streams.length}</td>
                      <td>{money(w.profit)}</td>
                      <td>{money(w.buyProfit)}</td>
                      <td className={w.winner === "hourly" ? "text-win font-semibold" : ""}>{money(w.optionA)}</td>
                      {anyCommission && (
                        <td className={w.winner === "commission" ? "text-win font-semibold" : ""}>{money(w.optionB)}</td>
                      )}
                      <td>{money(w.tips)}</td>
                      <td>{money(packing)}</td>
                      {anyOverride && <td>{money(extra?.overridePay || 0)}</td>}
                      <td className="!font-semibold">{money(total)}</td>
                    </tr>
                    );
                  })}
                  {/* packed but did not stream this week */}
                  {packOnly.map((m) => (
                    <tr key={m.managerId}>
                      <td className="!font-medium">{m.managerName} <span className="text-dim text-xs">packer</span></td>
                      <td>{m.packedCount}</td>
                      <td className="text-dim">-</td>
                      <td className="text-dim">-</td>
                      <td className="text-dim">-</td>
                      {anyCommission && <td className="text-dim">-</td>}
                      <td>{money(0)}</td>
                      <td>{money(m.packingPay)}</td>
                      {anyOverride && <td>{money(m.overridePay)}</td>}
                      <td className="!font-semibold">{money(m.totalPay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
