import Link from "next/link";
import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";
import { getSettings } from "@/lib/settings";
import { toLine } from "@/lib/calc";
import { listDeletedAndPurge, GRACE_HOURS } from "@/lib/streamsTrash";
import StreamsAdminClient, { DeletedRowT, StreamRowT } from "./StreamsAdminClient";

export const dynamic = "force-dynamic";

export default async function AllStreamsPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isAdmin) redirect("/dashboard");

  const [streamRows, streamerRows, deletedRows, lineRows, settings] = await Promise.all([
    atList(T.streams, {
      filterByFormula: "{Deleted At} = BLANK()",
      "sort[0][field]": "Stream Date",
      "sort[0][direction]": "desc",
    }),
    atList(T.streamers),
    listDeletedAndPurge(), // also hard-purges anything past the grace window
    atList(T.lines),
    getSettings(),
  ]);
  const nameById: Record<string, string> = {};
  const rateById: Record<string, number> = {};
  for (const s of streamerRows) {
    nameById[s.id] = s.fields["Name"] || "Streamer";
    if (typeof s.fields["Hourly Rate"] === "number") rateById[s.id] = s.fields["Hourly Rate"];
  }
  // delivered product at market per stream: hits only, since unhit product returns to stock
  const hitMarketByStream: Record<string, number> = {};
  for (const l of lineRows) {
    const sid = l.fields["Stream Rec Id"];
    if (!sid) continue;
    const line = toLine(l);
    hitMarketByStream[sid] = (hitMarketByStream[sid] || 0) + line.qtyHit * line.market;
  }

  const toRow = (r: any): StreamRowT => {
    const afterFees = r.fields["After Fees"] ?? null;
    const hours = r.fields["Hours Streamed"] || 0;
    const packing = ((r.fields["Packing Hours"] || 0) + (r.fields["Manager Packing Hours"] || 0)) * settings.packing_rate;
    const hourlyEst = hours * (rateById[r.fields["Streamer Rec Id"]] ?? settings.default_hourly_rate);
    const tips = r.fields["Tips"] || 0;
    const payroll = hourlyEst + packing + tips;
    const profitMarket = afterFees === null ? null :
      afterFees - (r.fields["Promotion"] || 0) - (r.fields["Giveaways Run"] || 0) * settings.giveaway_cost -
      (hitMarketByStream[r.id] || 0) - tips;
    return {
      id: r.id,
      date: r.fields["Stream Date"] || "",
      title: r.fields["Title"] || "",
      streamer: nameById[r.fields["Streamer Rec Id"]] || "",
      manager: nameById[r.fields["Manager Rec Id"]] || "",
      status: r.fields["Status"] || "Planned",
      afterFees,
      hours: r.fields["Hours Streamed"] ?? null,
      spots: r.fields["Spots Sold"] ?? null,
      payroll: afterFees === null && payroll === 0 ? null : payroll,
      commissionEligible: profitMarket === null ? null : profitMarket - packing > 0,
      netProfit: profitMarket === null ? null : profitMarket - hourlyEst - packing,
    };
  };

  const streams = streamRows.map(toRow);
  const deleted: DeletedRowT[] = deletedRows.map((r) => {
    const at = new Date(r.fields["Deleted At"]).getTime();
    const hoursLeft = Math.max(0, GRACE_HOURS - (Date.now() - at) / (60 * 60 * 1000));
    return { ...toRow(r), deletedAt: r.fields["Deleted At"], hoursLeft };
  });

  return (
    <>
      <Nav isAdmin name={me.streamer?.fields?.["Name"] || "Admin"} />
      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
            All streams
          </h1>
          <Link href="/streams/new" className="btn-foil">+ New stream</Link>
        </div>

        <StreamsAdminClient streams={streams} deleted={deleted} />

        <p className="text-dim text-xs">
          Every stream by every streamer, any status. Open any of them to view or edit the show set,
          prices, hits, timeclock, and results - admin has full access to all streams.
        </p>
      </main>
    </>
  );
}
