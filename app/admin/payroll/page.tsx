import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";
import { getSettings } from "@/lib/settings";
import { buildWeekPay, buildManagerPay, money, payDateOf, toLine, weekStartOf, StreamRow } from "@/lib/calc";

export const dynamic = "force-dynamic";

// Payroll by pay period: weeks run Monday through Sunday and pay the following
// Tuesday. Every employee owed money in a period appears with what they are
// owed and why - streamers on the greater of hourly or commission, managers on
// override plus packing, tips always paid through.
export default async function PayrollPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isAdmin) redirect("/dashboard");

  const [settings, streamerRows, streamRows, lineRows] = await Promise.all([
    getSettings(),
    atList(T.streamers),
    atList(T.streams, { filterByFormula: "{Deleted At} = BLANK()" }),
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
    costByStream[sid] = (costByStream[sid] || 0) + line.qtyHit * line.buy;
    marketCostByStream[sid] = (marketCostByStream[sid] || 0) + line.qtyHit * line.market;
  }
  const rows: StreamRow[] = streamRows.map((r: any) => ({
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

  // one section per pay period, every payee inside it
  type Payee = { name: string; role: string; detail: string; amount: number };
  const periods = new Map<string, Payee[]>();
  const push = (week: string, p: Payee) => {
    if (!periods.has(week)) periods.set(week, []);
    periods.get(week)!.push(p);
  };
  for (const w of weeks) {
    push(w.weekStart, {
      name: w.streamerName,
      role: "Streamer",
      detail: `${w.hours.toFixed(1)}h - paid by ${w.winner === "hourly" ? `hourly (${money(w.hourlyRate)}/h)` : "commission"}${w.packingPay > 0 ? ` + packing ${money(w.packingPay)}` : ""}${w.tips > 0 ? ` + tips ${money(w.tips)}` : ""}`,
      amount: w.totalPay,
    });
  }
  for (const mw of managerWeeks) {
    if (mw.totalPay <= 0) continue;
    push(mw.weekStart, {
      name: mw.managerName,
      role: "Manager",
      detail: `override ${(mw.overridePct * 100).toFixed(0)}% on ${money(mw.overrideBase)}${mw.packingPay > 0 ? ` + packing ${mw.packingHours.toFixed(1)}h` : ""}`,
      amount: mw.totalPay,
    });
  }
  const ordered = [...periods.entries()].sort((a, b) => b[0].localeCompare(a[0]));
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
          const inProgress = ws === thisWeek;
          return (
            <section key={ws} className={`card p-5 space-y-3 ${inProgress ? "!border-foil/40" : ""}`}>
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <h2 className="font-bold">
                  Week {fmt(ws)} - {fmt(weekEnd(ws))}
                  {inProgress && <span className="text-foil text-xs ml-2">in progress</span>}
                </h2>
                <span className="text-dim text-sm">
                  {inProgress ? "will pay" : "pays"} Tuesday {fmt(payDateOf(ws))}
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-dim">
                    <th className="py-1">Employee</th><th className="py-1">Role</th><th className="py-1">How it was earned</th><th className="py-1 text-right">Owed</th>
                  </tr>
                </thead>
                <tbody>
                  {payees.sort((a, b) => b.amount - a.amount).map((p, i) => (
                    <tr key={i} className="border-t border-edge">
                      <td className="py-2 font-medium">{p.name}</td>
                      <td className="py-2 text-dim">{p.role}</td>
                      <td className="py-2 text-dim text-xs">{p.detail}</td>
                      <td className="py-2 text-right num font-semibold">{money(p.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-edge">
                    <td className="py-2 font-bold" colSpan={3}>Period total</td>
                    <td className="py-2 text-right num font-bold text-win">{money(total)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          );
        })}
      </main>
    </>
  );
}
