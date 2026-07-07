import Link from "next/link";
import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";

export const dynamic = "force-dynamic";

export default async function AllStreamsPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isAdmin) redirect("/dashboard");

  const [streamRows, streamerRows] = await Promise.all([
    atList(T.streams, { "sort[0][field]": "Stream Date", "sort[0][direction]": "desc" }),
    atList(T.streamers),
  ]);
  const nameById: Record<string, string> = {};
  for (const s of streamerRows) nameById[s.id] = s.fields["Name"] || "Streamer";

  const money = (n: number) =>
    "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th>Date</th><th>Title</th><th>Streamer</th><th>Manager</th>
                <th>Status</th><th>After fees</th><th>Hours</th><th>Spots sold</th><th></th>
              </tr>
            </thead>
            <tbody>
              {streamRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.fields["Stream Date"]}</td>
                  <td className="!font-medium">{r.fields["Title"]}</td>
                  <td>{nameById[r.fields["Streamer Rec Id"]] || "-"}</td>
                  <td className="text-dim">{nameById[r.fields["Manager Rec Id"]] || "-"}</td>
                  <td>
                    <span className={r.fields["Status"] === "Complete" ? "text-win" : "text-foil"}>
                      {r.fields["Status"] || "Planned"}
                    </span>
                  </td>
                  <td>{r.fields["After Fees"] ? money(r.fields["After Fees"]) : "-"}</td>
                  <td>{r.fields["Hours Streamed"] ? Number(r.fields["Hours Streamed"]).toFixed(1) : "-"}</td>
                  <td>{r.fields["Spots Sold"] || "-"}</td>
                  <td className="text-right">
                    <Link className="text-foil hover:underline" href={`/streams/${r.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
              {streamRows.length === 0 && (
                <tr><td colSpan={9} className="text-dim">No streams yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-dim text-xs">
          Every stream by every streamer, any status. Open any of them to view or edit the show set,
          prices, hits, timeclock, and results - admin has full access to all streams.
        </p>
      </main>
    </>
  );
}
