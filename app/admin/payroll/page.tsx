import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import MarkPaidButton from "./MarkPaidButton";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";
import { getSettings } from "@/lib/settings";
import { buildWeekPay, buildManagerPay, buildPersonHours, money, payDateOf, toLine, weekStartOf, StreamRow } from "@/lib/calc";
import PaidToggle from "./PaidToggle";

export const dynamic = "force-dynamic";

// Payroll by pay period: weeks run Monday through Sunday and pay the following
// Tuesday. Every employee owed money in a period appears with what they are
// owed and why - streamers on the greater of hourly or commission, managers on
// override plus packing, tips always paid through.
export default async function PayrollPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isAdmin) redirect("/dashboard");

  const [settings, streamerRows, streamRows, lineRows, timeRows] = await Promise.all([
    getSettings(),
    atList(T.streamers),
    atList(T.streams, { filterByFormula: "{Deleted At} = BLANK()" }),
    atList(T.lines),
    atList(T.time),
  ]);
  const paidRows = await atList(T.payrollPaid);
  const paidKeys = new Set(paidRows.map((r: any) => String(r.fields["Key"] || "")));

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
    costByStream[sid] = (costByStream[sid] || 0) + line.qtyHit * line.buy;
    marketCostByStream[sid] = (marketCostByStream[sid] || 0) + line.qtyHit * line.market;
  }
  const rows: StreamRow[] = streamRows.map((r: any) => ({
    id: r.id,
    date: r.fields["Stream Date"],
    title: r.fields["Title"] || "",
    streamerId: r.fields["Streamer Rec Id"] || "unknown",
    streamerName: nameById[r.fields["Streamer Rec Id"]] || "Streamer",
    afterFees: r.fields["After Fees"] || 0,
    giveaways: r.fields["Giveaways Run"] || 0,
    singlesGiveaways: r.fields["Singles Giveaways Run"] || 0,
    promotion: r.fields["Promotion"] || 0,
    tips: r.fields["Tips"] || 0,
    hours: r.fields["Hours Streamed"] || 0,
    packingHours: r.fields["Packing Hours"] || 0,
    managerPackingHours: r.fields["Manager Packing Hours"] || 0,
    managerId: r.fields["Manager Rec Id"] || null,
    productCost: costByStream[r.id] || 0,
    productMarketCost: marketCostByStream[r.id] || 0,
    status: r.fields["Status"] || "Planned",
    overrideExcluded: !!r.fields["Override Excluded"],
  }));

  // hp-v1: pay follows the person who clocked the hours, not the stream of
  // record - a shared show pays each streamer their own timeclock.
  const personHours = buildPersonHours(
    rows.map((r) => ({ id: r.id, date: r.date, status: r.status, managerId: r.managerId, streamerId: r.streamerId, tips: r.tips })),
    (timeRows as any[]).map((e) => ({
      streamId: e.fields["Stream Rec Id"] || "",
      personId: e.fields["Person Rec Id"] || "",
      type: e.fields["Type"] || "",
      hours: e.fields["Hours"] || 0,
    }))
  );
  // per (stream, person) split for the per-stream breakdown lines
  const perStreamOwn: Record<string, { streaming: number; packing: number }> = {};
  const streamersByStream: Record<string, Set<string>> = {};
  for (const e of timeRows as any[]) {
    const sid = e.fields["Stream Rec Id"]; const pid = e.fields["Person Rec Id"];
    if (!sid || !pid) continue;
    const k = `${sid}|${pid}`;
    if (!perStreamOwn[k]) perStreamOwn[k] = { streaming: 0, packing: 0 };
    if (e.fields["Type"] === "Streaming") {
      perStreamOwn[k].streaming += e.fields["Hours"] || 0;
      if (!streamersByStream[sid]) streamersByStream[sid] = new Set();
      streamersByStream[sid].add(pid);
    } else perStreamOwn[k].packing += e.fields["Hours"] || 0;
  }
  const weeks = buildWeekPay(rows, settings, rateById, { personHours, namesById: nameById });
  const managerWeeks = buildManagerPay(rows, settings, overrideById, nameById, rateById);

  // one section per pay period, every payee inside it
  type PayLine = { label: string; note: string; amount: number };
  type Payee = { name: string; role: string; detail: string; amount: number; breakdown: PayLine[]; personId: string };
  const periods = new Map<string, Payee[]>();
  const push = (week: string, p: Payee) => {
    if (!periods.has(week)) periods.set(week, []);
    periods.get(week)!.push(p);
  };
  const streamProfit = (r: StreamRow) =>
    r.afterFees - r.promotion - (r.giveaways || 0) * settings.giveaway_cost
    - (r.singlesGiveaways || 0) * settings.singles_giveaway_cost - r.productMarketCost;
  for (const w of weeks) {
    // per-stream pay: exact for hourly weeks; commission weeks allocate the week's
    // commission across streams by their share of positive profit
    const posProfit = w.streams.map((r) => Math.max(streamProfit(r), 0));
    const posTotal = posProfit.reduce((a, v) => a + v, 0);
    const breakdown: PayLine[] = w.streams.map((r, i) => {
      // hp-v1: each line shows THIS person's own clocked time on the stream
      const own = perStreamOwn[`${r.id}|${w.streamerId}`] || { streaming: 0, packing: 0 };
      const packing = own.packing * settings.packing_rate;
      const base = w.winner === "hourly"
        ? own.streaming * w.hourlyRate
        : posTotal > 0 ? (posProfit[i] / posTotal) * w.streamPay : w.streamPay / w.streams.length;
      // tips: even split among the show's clocked streamers; all to the
      // streamer of record when nobody clocked
      const clocked = streamersByStream[r.id];
      const ownTips = clocked && clocked.size > 0
        ? (clocked.has(w.streamerId) ? r.tips / clocked.size : 0)
        : r.tips;
      const bits = [`${own.streaming.toFixed(1)}h`];
      if (packing > 0) bits.push(`packing ${money(packing)}`);
      if (ownTips > 0) bits.push(`tips ${money(ownTips)}${clocked && clocked.size > 1 ? " (split)" : ""}`);
      if (w.winner !== "hourly") bits.push("share of week commission");
      return { label: `${r.date.slice(5)} ${r.title || "Stream"}`, note: bits.join(" + "), amount: base + packing + ownTips };
    });
    if (w.streams.length === 0 && w.totalPay > 0) {
      breakdown.push({ label: "Shared streams", note: `${w.hours.toFixed(1)}h clocked under their name on other streamers' shows`, amount: w.totalPay });
    }
    const accounted = breakdown.reduce((a, b) => a + b.amount, 0);
    if (Math.abs(w.totalPay - accounted) > 0.01) {
      breakdown.push({ label: "Week-level adjustment", note: "hours on shared shows / support pay / weekly commission settlement", amount: w.totalPay - accounted });
    }
    push(w.weekStart, {
      name: w.streamerName,
      role: "Streamer",
      detail: `${w.hours.toFixed(1)}h - paid by ${w.winner === "hourly" ? `hourly (${money(w.hourlyRate)}/h)` : "commission"}${w.packingPay > 0 ? ` + packing ${money(w.packingPay)}` : ""}${w.tips > 0 ? ` + tips ${money(w.tips)}` : ""}`,
      amount: w.totalPay,
      breakdown,
      personId: w.streamerId,
    });
  }
  for (const mw of managerWeeks) {
    if (mw.totalPay <= 0) continue;
    const breakdown: PayLine[] = mw.streams.map((r) => {
      const packing = (r.managerPackingHours || 0) * settings.packing_rate;
      const note = r.overrideExcluded
        ? `excluded from override${packing > 0 ? ` + packing ${money(packing)}` : ""}`
        : `profit ${money(streamProfit(r))} in override base${packing > 0 ? ` + packing ${money(packing)}` : ""}`;
      return { label: `${r.date.slice(5)} ${r.title || "Stream"}`, note, amount: packing };
    });
    const accounted = breakdown.reduce((a, b) => a + b.amount, 0);
    if (Math.abs(mw.totalPay - accounted) > 0.01) {
      breakdown.push({ label: "Override", note: `${(mw.overridePct * 100).toFixed(0)}% of ${money(mw.overrideBase)} (week base after streamer pay)`, amount: mw.totalPay - accounted });
    }
    push(mw.weekStart, {
      name: mw.managerName,
      role: "Manager",
      detail: `override ${(mw.overridePct * 100).toFixed(0)}% on ${money(mw.overrideBase)}${mw.packingPay > 0 ? ` + packing ${mw.packingHours.toFixed(1)}h` : ""}`,
      amount: mw.totalPay,
      breakdown,
      personId: mw.managerId,
    });
  }
  const ordered = [...periods.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const salesByWeek = new Map<string, { afterFees: number; count: number }>();
  for (const r of streamRows as any[]) {
    if (r.fields["Status"] !== "Complete") continue;
    const ws = weekStartOf(r.fields["Stream Date"]);
    if (!salesByWeek.has(ws)) salesByWeek.set(ws, { afterFees: 0, count: 0 });
    const sw = salesByWeek.get(ws)!;
    sw.afterFees += r.fields["After Fees"] || 0;
    sw.count += 1;
  }
  // paid state per pay week, straight off the stream records
  const paidState = new Map<string, { ids: string[]; paidIds: string[]; paidAt: string | null }>();
  for (const r of streamRows as any[]) {
    if (r.fields["Status"] !== "Complete") continue;
    const ws = weekStartOf(r.fields["Stream Date"]);
    if (!paidState.has(ws)) paidState.set(ws, { ids: [], paidIds: [], paidAt: null });
    const st = paidState.get(ws)!;
    st.ids.push(r.id);
    if (r.fields["Paid Out"]) {
      st.paidIds.push(r.id);
      if (r.fields["Paid At"] && (!st.paidAt || r.fields["Paid At"] > st.paidAt)) st.paidAt = r.fields["Paid At"];
    }
  }
  const thisWeek = weekStartOf(new Date().toISOString().slice(0, 10));
  const fmt = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  const weekEnd = (ws: string) => {
    const d = new Date(ws + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  };

  return (
    <>
      <Nav isAdmin name={me.streamer?.fields?.["Name"] || "Admin"} />
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Payroll</h1>
          <p className="text-dim text-sm mt-1">
            Pay periods run Monday through Sunday and pay the following Tuesday. Only completed streams count -
            a show still open when you run payroll belongs to whoever completes it.
          </p>
        </div>
        {ordered.length === 0 && <p className="text-dim">No completed streams yet - payroll builds itself as shows are completed.</p>}
        {ordered.map(([ws, payees]) => {
          const total = payees.reduce((a, p) => a + p.amount, 0);
          const wkStreams = salesByWeek.get(ws) || { afterFees: 0, count: 0 };
          const inProgress = ws === thisWeek;
          const ps = paidState.get(ws) || { ids: [], paidIds: [], paidAt: null };
          const fullyPaid = ps.ids.length > 0 && ps.paidIds.length === ps.ids.length;
          const partlyPaid = ps.paidIds.length > 0 && !fullyPaid;
          return (
            <section key={ws} className={`card p-5 space-y-3 ${fullyPaid ? "!border-win/40" : inProgress ? "!border-foil/40" : ""}`}>
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <h2 className="font-bold">
                  Week {fmt(ws)} - {fmt(weekEnd(ws))}
                  {inProgress && <span className="text-foil text-xs ml-2">in progress</span>}
                  {fullyPaid && <span className="text-win text-xs ml-2">PAID{ps.paidAt ? ` ${fmt(ps.paidAt)}` : ""}</span>}
                  {partlyPaid && <span className="text-foil text-xs ml-2">partially paid ({ps.paidIds.length}/{ps.ids.length} streams)</span>}
                </h2>
                <span className="flex items-center gap-3">
                  <span className="text-dim text-sm">
                    {fullyPaid ? "paid" : inProgress ? "will pay" : "pays"} Tuesday {fmt(payDateOf(ws))}
                  </span>
                  {ps.ids.length > 0 && !inProgress && <MarkPaidButton streamIds={ps.ids} paid={fullyPaid} />}
                </span>
              </div>
              <div className="text-sm">
                <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[160px_90px_1fr_110px] gap-x-3 text-dim text-left pb-1">
                  <span>Employee</span><span className="hidden sm:block">Role</span><span className="hidden sm:block">How it was earned</span><span className="text-right">Owed</span>
                </div>
                {payees.sort((a, b) => b.amount - a.amount).map((p, i) => (
                  <details key={i} className="border-t border-edge group">
                    <summary className="grid grid-cols-[1fr_auto] sm:grid-cols-[160px_90px_1fr_110px] gap-x-3 py-2 cursor-pointer list-none items-baseline hover:bg-white/[0.02]">
                      <span className="font-medium"><span className="text-dim text-xs mr-1.5 inline-block transition-transform group-open:rotate-90">&#9656;</span>{p.name}</span>
                      <span className="text-dim hidden sm:block">{p.role}</span>
                      <span className="text-dim text-xs hidden sm:block">{p.detail}</span>
                      <span className="text-right num font-semibold flex items-baseline justify-end gap-3">
                        <PaidToggle week={ws} personId={p.personId} personName={p.name} amount={p.amount} paid={paidKeys.has(`${ws}|${p.personId}`)} />
                        {money(p.amount)}
                      </span>
                    </summary>
                    <div className="pb-3 pl-5 pr-1 space-y-1">
                      {p.breakdown.map((b, j) => (
                        <div key={j} className="grid grid-cols-[1fr_110px] gap-x-3 text-xs items-baseline">
                          <span className="text-dim truncate" title={b.label}>{b.label}<span className="text-dim/60"> - {b.note}</span></span>
                          <span className="text-right num">{money(b.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
                <div className="grid grid-cols-[1fr_110px] gap-x-3 border-t border-edge pt-2 text-dim text-xs">
                  <span>Sales after fees ({wkStreams.count} completed stream{wkStreams.count === 1 ? "" : "s"})</span>
                  <span className="text-right num">{money(wkStreams.afterFees)}</span>
                </div>
                <div className="grid grid-cols-[1fr_110px] gap-x-3 py-2">
                  <span className="font-bold">Period total{payees.every((p) => paidKeys.has(`${ws}|${p.personId}`)) && payees.length > 0 ? " - all paid" : ""}{wkStreams.afterFees > 0 ? <span className="text-dim text-xs font-normal ml-2">{((total / wkStreams.afterFees) * 100).toFixed(1)}% of sales</span> : null}</span>
                  <span className="text-right num font-bold text-win">{money(total)}</span>
                </div>
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}
