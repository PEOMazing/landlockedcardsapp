import Link from "next/link";
import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";
import { listDeletedAndPurge, GRACE_HOURS } from "@/lib/streamsTrash";
import StreamsAdminClient, { DeletedRowT, StreamRowT } from "./StreamsAdminClient";

export const dynamic = "force-dynamic";

export default async function AllStreamsPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isAdmin) redirect("/dashboard");

  const [streamRows, streamerRows, deletedRows] = await Promise.all([
    atList(T.streams, {
      filterByFormula: "{Deleted At} = BLANK()",
      "sort[0][field]": "Stream Date",
      "sort[0][direction]": "desc",
    }),
    atList(T.streamers),
    listDeletedAndPurge(), // also hard-purges anything past the grace window
  ]);
  const nameById: Record<string, string> = {};
  for (const s of streamerRows) nameById[s.id] = s.fields["Name"] || "Streamer";

  const toRow = (r: any): StreamRowT => ({
    id: r.id,
    date: r.fields["Stream Date"] || "",
    title: r.fields["Title"] || "",
    streamer: nameById[r.fields["Streamer Rec Id"]] || "",
    manager: nameById[r.fields["Manager Rec Id"]] || "",
    status: r.fields["Status"] || "Planned",
    afterFees: r.fields["After Fees"] ?? null,
    hours: r.fields["Hours Streamed"] ?? null,
    spots: r.fields["Spots Sold"] ?? null,
  });

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
