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
    title: r.fields["Title"] || "",
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
    overrideExcluded: !!r.fields["Override Excluded"],
  }));

  const weeks = buildWeekPay(rows, settings, rateById);
  const managerWeeks = buildManagerPay(rows, settings, overrideById, nameById, rateById);

  // one section per pay period, every payee inside it
  type PayLine = { label: string; note: string; amount: number };
  type Payee = { name: string; role: string; detail: string; amount: number; breakdown: PayLine[] };
  const periods = new Map<string, Payee[]>();
  const push = (week: string, p: Payee) => {
    if (!periods.has(week)) periods.set(week, []);
    periods.get(week)!.push(p);
  };
  const streamProfit = (r: StreamRow) =>
    r.afterFees - r.promotion - (r.giveaways || 0) * settings.giveaway_cost - r.productMarketCost - r.tips;
  for (const w of weeks) {
    // per-stream pay is exact: each show settled as the higher of its hourly or 20% commission
    const breakdown: PayLine[] = w.streams.map((r) => {
      const ps = w.perStream.find((x) => x.id === r.id);
      const packing = r.packingHours * settings.packing_rate;
      const base = ps?.pay ?? r.hours * w.hourlyRate;
      const bits = [
        ps?.winner === "commission"
          ? `20% commission ${money(ps.commission)} beat ${r.hours.toFixed(1)}h hourly`
          : `${r.hours.toFixed(1)}h hourly${ps && ps.commission > 0 ? ` beat commission ${money(ps.commission)}` : ""}`,
      ];
      if (packing > 0) bits.push(`packing ${money(packing)}`);
      if (r.tips > 0) bits.push(`tips ${money(r.tips)}`);
      return { label: `${r.date.slice(5)} ${r.title || "Stream"}`, note: bits.join(" + "), amount: base + packing + r.tips };
    });
    const accounted = breakdown.reduce((a, b) => a + b.amount, 0);
    if (Math.abs(w.totalPay - accounted) > 0.01) {
      breakdown.push({ label: "Week-level adjustment", note: "support pay", amount: w.totalPay - accounted });
    }
    push(w.weekStart, {
      name: w.streamerName,
      role: "Streamer",
      detail: `${w.hours.toFixed(1)}h - ${w.winner === "mixed" ? "best-of per show" : `paid by ${w.winner}`}${w.packingPay > 0 ? ` + packing ${money(w.packingPay)}` : ""}${w.tips > 0 ? ` + tips ${money(w.tips)}` : ""}`,
      amount: w.totalPay,
      breakdown,
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
                      <span className="text-right num font-semibold">{money(p.amount)}</span>
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
                <div className="grid grid-cols-[1fr_110px] gap-x-3 border-t border-edge py-2">
                  <span className="font-bold">Period total</span>
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
