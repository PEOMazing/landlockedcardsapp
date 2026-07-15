"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const $ = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type StreamRowT = {
  id: string; date: string; title: string; streamer: string; manager: string;
  status: string; afterFees: number | null; hours: number | null; spots: number | null;
  payroll: number | null; netProfit: number | null;
};
export type DeletedRowT = StreamRowT & { deletedAt: string; hoursLeft: number };

export default function StreamsAdminClient({
  streams,
  deleted,
}: {
  streams: StreamRowT[];
  deleted: DeletedRowT[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");

  async function softDelete(s: StreamRowT) {
    const ok = confirm(
      `Delete "${s.title}"?\n\nIt disappears from all dashboards and pay immediately, but you can reinstate it from the Recently deleted section for the next 72 hours. After that it is gone for good and any unreturned product goes back to stock.`
    );
    if (!ok) return;
    setBusy(s.id);
    await fetch(`/api/streams/${s.id}`, { method: "DELETE" });
    setBusy("");
    router.refresh();
  }

  async function reinstate(s: DeletedRowT) {
    setBusy(s.id);
    await fetch(`/api/streams/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restoreDeleted: true }),
    });
    setBusy("");
    router.refresh();
  }

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>Date</th><th>Title</th><th>Streamer</th><th>Manager</th>
              <th>Status</th><th>After fees</th><th>Hours</th><th title="Streamer hourly estimate + packing + tips paid through">Payroll</th><th title="Market-basis profit after payroll - matches the stream page waterfall">Net profit</th><th></th>
            </tr>
          </thead>
          <tbody>
            {streams.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td className="!font-medium">{r.title}</td>
                <td>{r.streamer || "-"}</td>
                <td className="text-dim">{r.manager || "-"}</td>
                <td>
                  <span className={r.status === "Complete" ? "text-win" : "text-foil"}>{r.status}</span>
                </td>
                <td>{r.afterFees !== null ? $(r.afterFees) : "-"}</td>
                <td>{r.hours !== null ? r.hours.toFixed(1) : "-"}</td>
                <td>{r.payroll !== null && r.payroll > 0 ? $(r.payroll) : "-"}</td>
                <td>{r.netProfit === null ? "-" : <span className={r.netProfit >= 0 ? "text-win" : "text-bad"}>{$(r.netProfit)}</span>}</td>
                <td className="text-right whitespace-nowrap">
                  <Link className="text-foil hover:underline" href={`/streams/${r.id}`}>Open</Link>
                  <button
                    className="text-bad text-xs hover:underline ml-3 disabled:opacity-40"
                    disabled={busy === r.id}
                    onClick={() => softDelete(r)}
                  >
                    {busy === r.id ? "..." : "delete"}
                  </button>
                </td>
              </tr>
            ))}
            {streams.length === 0 && (
              <tr><td colSpan={9} className="text-dim">No streams yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {deleted.length > 0 && (
        <section className="card p-5 space-y-3 border-bad/30">
          <h2 className="label">Recently deleted</h2>
          <p className="text-dim text-xs">
            These streams are hidden from every dashboard and pay calculation. Reinstate within the
            window or they are permanently removed and unreturned product goes back to stock.
          </p>
          <div className="space-y-2">
            {deleted.map((s) => (
              <div key={s.id} className="flex items-center gap-3 flex-wrap rounded-lg border border-edge px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.title}</div>
                  <div className="text-dim text-xs">{s.date} - {s.streamer || "unassigned"} - {s.status}</div>
                </div>
                <span className="ml-auto text-bad text-xs num whitespace-nowrap">
                  {s.hoursLeft >= 1 ? `${Math.floor(s.hoursLeft)}h left` : "under 1h left"}
                </span>
                <button
                  className="btn-ghost !py-1 text-xs disabled:opacity-40"
                  disabled={busy === s.id}
                  onClick={() => reinstate(s)}
                >
                  {busy === s.id ? "Restoring..." : "Reinstate"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
