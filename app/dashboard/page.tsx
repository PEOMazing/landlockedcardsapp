import Link from "next/link";
import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";
import { getSettings } from "@/lib/settings";
import { buildWeekPay, buildManagerPay, money, StreamRow, toLine } from "@/lib/calc";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const me = await getMe();
  if (!me) redirect("/sign-in");

  if (!me.streamer) {
    return (
      <>
        <Nav isAdmin={me.isAdmin} />
        <main className="max-w-3xl mx-auto p-6">
          <div className="card p-6">
            <h1 className="text-lg font-bold mb-2">Almost there</h1>
            <p className="text-dim text-sm">
              Your login works, but there is no streamer profile for {me.email} yet.
              Ask the admin to add a row with this email on the Streamers table, then reload.
            </p>
          </div>
        </main>
      </>
    );
  }

  const name = me.streamer.fields["Name"];
  const [settings, streamRows, lineRows] = await Promise.all([
    getSettings(),
    atList(T.streams, {
      filterByFormula: `AND(OR({Streamer Rec Id} = '${me.streamer.id}', {Manager Rec Id} = '${me.streamer.id}'), {Deleted At} = BLANK())`,
      "sort[0][field]": "Stream Date",
      "sort[0][direction]": "desc",
    }),
    atList(T.lines),
  ]);

  const costByStream: Record<string, number> = {};
  const marketCostByStream: Record<string, number> = {};
  for (const l of lineRows) {
    const sid = l.fields["Stream Rec Id"];
    if (!sid) continue;
    const line = toLine(l);
    costByStream[sid] = (costByStream[sid] || 0) + line.qty * line.buy;
    marketCostByStream[sid] = (marketCostByStream[sid] || 0) + line.qty * line.market;
  }

  const rows: StreamRow[] = streamRows.map((r) => ({
    id: r.id,
    date: r.fields["Stream Date"],
    streamerId: r.fields["Streamer Rec Id"] || "unknown",
    streamerName: name,
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

  const rate =
    typeof me.streamer.fields["Hourly Rate"] === "number"
      ? me.streamer.fields["Hourly Rate"]
      : settings.default_hourly_rate;
  const ownRows = rows.filter((r) => r.streamerId === me.streamer!.id);
  const weeks = buildWeekPay(ownRows, settings, { [me.streamer.id]: rate });
  const overridePct =
    typeof me.streamer.fields["Override %"] === "number" ? me.streamer.fields["Override %"] : 0;
  const managedRows = rows.filter((r) => r.managerId === me.streamer!.id);
  const managedStreamerIds = Array.from(new Set(managedRows.map((r) => r.streamerId)));
  const rateByStreamer: Record<string, number> = {};
  if (managedStreamerIds.length > 0) {
    const allStreamers = await atList(T.streamers);
    for (const sr of allStreamers) {
      if (typeof sr.fields["Hourly Rate"] === "number") rateByStreamer[sr.id] = sr.fields["Hourly Rate"];
    }
  }
  const managerWeeks = buildManagerPay(
    managedRows,
    settings,
    { [me.streamer.id]: overridePct },
    { [me.streamer.id]: name },
    rateByStreamer
  );

  return (
    <>
      <Nav isAdmin={me.isAdmin} name={name} />
      <main className="max-w-6xl mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display, sans-serif)" }}>
              Hey {name?.split(" ")[0]}
            </h1>
            <p className="text-dim text-sm">
              You are paid the higher of ${rate}/hr or your commission, settled weekly.
            </p>
          </div>
          <Link href="/streams/new" className="btn-foil">+ New stream</Link>
        </div>

        <section>
          <h2 className="label mb-3">Weekly pay</h2>
          {weeks.length === 0 && (
            <div className="card p-6 text-dim text-sm">
              No completed streams yet. Create a stream, build the show set, and enter your
              numbers after the stream to see pay here.
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            {weeks.map((w) => (
              <div key={w.weekStart} className="card p-5">
                <div className="flex items-baseline justify-between mb-4">
                  <div className="font-bold" style={{ fontFamily: "var(--font-display, sans-serif)" }}>
                    Week of {w.weekLabel}
                  </div>
                  <div className="text-2xl font-bold text-win num">{money(w.totalPay)}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className={`rounded-lg border p-3 ${w.winner === "hourly" ? "border-win/50 bg-win/10" : "border-edge"}`}>
                    <div className="label">Hourly {w.winner === "hourly" && "- paid"}</div>
                    <div className="num font-semibold">{money(w.optionA)}</div>
                    <div className="text-dim text-xs">{w.hours.toFixed(1)} hrs x ${w.hourlyRate}</div>
                  </div>
                  <div className={`rounded-lg border p-3 ${w.winner === "commission" ? "border-win/50 bg-win/10" : "border-edge"}`}>
                    <div className="label">Commission {w.winner === "commission" && "- paid"}</div>
                    <div className="num font-semibold">{money(w.optionB)}</div>
                    <div className="text-dim text-xs">tiers on {money(w.commissionable)}</div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-dim space-y-1">
                  <div className="flex justify-between"><span>Week net profit (tips removed, losses net)</span><span className="num">{money(w.profit)}</span></div>
                  <div className="flex justify-between"><span>Packing pay ({w.streams.reduce((a, s) => a + s.packingHours, 0).toFixed(1)} hrs)</span><span className="num">+{money(w.packingPay)}</span></div>
                  <div className="flex justify-between"><span>Tips</span><span className="num">+{money(w.tips)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {managerWeeks.length > 0 && (
          <section>
            <h2 className="label mb-3">Manager pay - streams you manage</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {managerWeeks.map((w) => (
                <div key={w.weekStart} className="card p-5">
                  <div className="flex items-baseline justify-between mb-3">
                    <div className="font-bold" style={{ fontFamily: "var(--font-display)" }}>
                      Week of {w.weekLabel}
                    </div>
                    <div className="text-2xl font-bold text-win num">{money(w.totalPay)}</div>
                  </div>
                  <div className="text-xs text-dim space-y-1">
                    <div className="flex justify-between">
                      <span>Managed stream profit</span>
                      <span className="num">{money(w.managedCommissionable)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Less streamer pay</span>
                      <span className="num">-{money(w.streamerPayOnManaged)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Override ({(w.overridePct * 100).toFixed(1)}% of {money(w.overrideBase)})</span>
                      <span className="num">{money(w.overridePay)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Packing ({w.packingHours.toFixed(1)} hrs)</span>
                      <span className="num">+{money(w.packingPay)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Streams managed</span>
                      <span className="num">{w.streamCount}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="label mb-3">Your streams</h2>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead><tr><th>Date</th><th>Title</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {streamRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="text-foil hover:underline num" href={`/streams/${r.id}`}>
                        {r.fields["Stream Date"]}
                      </Link>
                    </td>
                    <td className="!font-medium">
                      <Link className="hover:text-foil hover:underline" href={`/streams/${r.id}`}>
                        {r.fields["Title"]}
                      </Link>
                      {r.fields["Manager Rec Id"] === me.streamer!.id && (
                        <span className="text-foil text-xs ml-2">managing</span>
                      )}
                    </td>
                    <td>
                      <span className={r.fields["Status"] === "Complete" ? "text-win" : "text-foil"}>
                        {r.fields["Status"] || "Planned"}
                      </span>
                    </td>
                    <td className="text-right">
                      <Link className="text-foil hover:underline" href={`/streams/${r.id}`}>Open</Link>
                    </td>
                  </tr>
                ))}
                {streamRows.length === 0 && (
                  <tr><td colSpan={4} className="text-dim">No streams yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
