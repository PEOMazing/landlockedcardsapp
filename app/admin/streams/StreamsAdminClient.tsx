"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import TableEmpty from "@/components/ui/TableEmpty";

const $ = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type StreamRowT = {
  id: string; date: string; title: string; streamer: string; manager: string;
  /** who packed it, as an id, so the row can edit the assignment in place */
  packerRecId?: string;
  /** pk-v4: set means this show is on the flat deal, and the number is the
   *  fee it was stamped with rather than the current setting */
  packingFee?: number | null;
  overrideRecId?: string; overrideName?: string; overrideExcluded?: boolean;
  status: string; afterFees: number | null; hours: number | null; packingHours?: number; tips?: number | null; spots: number | null;
  payroll: number | null; netProfit: number | null;
};
export type DeletedRowT = StreamRowT & { deletedAt: string; hoursLeft: number };

export default function StreamsAdminClient({
  streams,
  deleted,
  isAdmin = true,
  team = [],
}: {
  streams: StreamRowT[];
  deleted: DeletedRowT[];
  isAdmin?: boolean;
  team?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  // Nothing on this page could report a failed write before. Every action here
  // is either a payroll field or a deletion, and all of them ended in a
  // router.refresh() that quietly repainted the old state.
  const [err, setErr] = useState("");

  // Who earns the override on this show. Admin only, independent of Packaging.
  async function setOverride(id: string, personId: string) {
    setBusy(id);
    // Checked, because this decides who earns the commission override, which
    // is money. Unchecked, a failure looked exactly like a success: the
    // refresh put the dropdown back to its old value and said nothing, so the
    // admin's only clue was noticing the selection had reverted.
    const r = await fetch(`/api/streams/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overrideRecId: personId || null }),
    }).catch(() => null);
    setBusy("");
    if (!r || !r.ok) setErr("Could not change who earns the override on that show - it is unchanged");
    else setErr("");
    router.refresh();
  }

  async function softDelete(s: StreamRowT) {
    const ok = confirm(
      `Delete "${s.title}"?\n\nIt disappears from all dashboards and pay immediately, but you can reinstate it from the Recently deleted section for the next 72 hours. After that it is gone for good and any unreturned product goes back to stock.`
    );
    if (!ok) return;
    setBusy(s.id);
    const r = await fetch(`/api/streams/${s.id}`, { method: "DELETE" }).catch(() => null);
    setBusy("");
    // The confirm promises a 72 hour reinstate window. If the delete did not
    // land there is nothing to reinstate, and the row simply staying put was
    // the only sign.
    if (!r || !r.ok) setErr(`Could not delete "${s.title}" - it is still live on dashboards and pay`);
    else setErr("");
    router.refresh();
  }

  async function reinstate(s: DeletedRowT) {
    setBusy(s.id);
    const r = await fetch(`/api/streams/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restoreDeleted: true }),
    }).catch(() => null);
    setBusy("");
    // The grace window expires. A reinstate that silently failed and was not
    // noticed is a show that gets purged.
    if (!r || !r.ok) setErr(`Could not reinstate "${s.title}" - it is still deleted and still on the purge clock`);
    else setErr("");
    router.refresh();
  }

  const [editing, setEditing] = useState<string>("");
  const [eTitle, setETitle] = useState("");
  const [eDate, setEDate] = useState("");
  // pk-v5: writes Packer Rec Id. Assigning a packer no longer also makes
  // them manager of record, which used to come with access to the show.
  // pk-v4: the packer is editable from this row now. It used to be a greyed
  // read-only name, which meant tagging a packer - the one action that puts a
  // show on the flat fee and gets somebody paid - was only reachable by
  // opening the show and finding the edit link next to its title.
  const [eManager, setEManager] = useState("");
  async function saveMeta(id: string, wasManager: string) {
    setBusy(id);
    const r = await fetch(`/api/streams/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // managerId only when it actually changed: sending it unchanged is
      // harmless today but it is the field that stamps the fee, and a write
      // that does nothing is not worth aiming at it
      body: JSON.stringify({
        title: eTitle.trim(),
        date: eDate,
        ...(eManager !== wasManager ? { packerId: eManager || null } : {}),
      }),
    });
    setBusy("");
    if (!r.ok) { setErr("Could not save that show - it is unchanged"); return; }
    setEditing(""); router.refresh();
  }
  // titles carry the date already, and the date column repeats it - show the clean name
  const displayTitle = (r: StreamRowT) => r.title.replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, "");

  return (
    <>
      {err && (
        <div className="card p-s4 border-bad/50 flex items-start gap-s3 mb-s4">
          <span className="text-bad">{"⚠"}</span>
          <p className="flex-1 min-w-0 t-body">{err}</p>
          <button className="text-dim hover:text-body t-meta" onClick={() => setErr("")}>dismiss</button>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>Date</th><th>Title</th><th>Streamer</th><th title="Who packed this show. Assigning somebody puts the show on the flat packing fee - hit edit on the row to change it.">Packaging</th><th title="Who earns the commission override on this show. Independent of who packed it.">Override</th>
              {/* pk-v4: the Packing hours column is gone. Packing is a flat fee
                  per show now and nobody clocks hours against it, so the column
                  was a dash on every modern show sitting next to Packaging and
                  reading like a second version of it. The fee itself shows up
                  in Payroll, where the money is. */}
              <th>Status</th><th>After fees</th><th>Hours</th><th title="Tips paid through to the streamer">Tips</th><th title="Streamer hourly estimate + packing + tips paid through">Payroll</th><th title="Market-basis profit after payroll - matches the stream page waterfall">Net profit</th><th></th>
            </tr>
          </thead>
          <tbody>
            {streams.map((r) => (
              <tr key={r.id}>
                {editing === r.id ? (
                  <>
                    <td><input type="date" className="input !py-1 text-sm" value={eDate} onChange={(e) => setEDate(e.target.value)} /></td>
                    <td>
                      <span className="flex items-center gap-2">
                        <input className="input !py-1 text-sm w-56" value={eTitle} onChange={(e) => setETitle(e.target.value)} />
                        <button className="text-win text-xs hover:underline disabled:opacity-40" disabled={busy === r.id || !eTitle.trim() || !eDate} onClick={() => saveMeta(r.id, r.packerRecId || "")}>save</button>
                        <button className="text-dim text-xs hover:underline" onClick={() => setEditing("")}>cancel</button>
                      </span>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="whitespace-nowrap">{r.date}</td>
                    <td className="!font-medium">
                      {/* The title opens the show. There is an Open link at the
                          far right too, but on a table this wide that meant
                          scrolling sideways just to get into a stream. */}
                      <Link className="hover:text-foil" href={`/streams/${r.id}`}>{displayTitle(r)}</Link>
                      <button
                        className="text-dim hover:text-foil text-xs ml-2"
                        title="Edit the title, move the date, or assign who packed it"
                        onClick={() => {
                          setEditing(r.id); setETitle(displayTitle(r)); setEDate(r.date);
                          setEManager(r.packerRecId || "");
                        }}
                      >
                        edit
                      </button>
                    </td>
                  </>
                )}
                <td>{r.streamer || "-"}</td>
                <td>
                  {editing === r.id ? (
                    <select
                      className="input !py-1 !px-1 text-sm !w-28"
                      value={eManager}
                      disabled={busy === r.id}
                      onChange={(e) => setEManager(e.target.value)}
                      title="Who packed this show. Assigning somebody puts the show on the flat packing fee."
                    >
                      <option value="">nobody</option>
                      {team.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </select>
                  ) : (
                    <span className="text-dim">{r.manager || "-"}</span>
                  )}
                </td>
                <td>
                  {isAdmin ? (
                    <select className="input !py-1 !px-1 text-sm !w-28" value={r.overrideRecId || ""}
                      disabled={busy === r.id} onChange={(e) => setOverride(r.id, e.target.value)}>
                      <option value="">nobody</option>
                      {team.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </select>
                  ) : (
                    <span className="text-dim">{r.overrideName || "-"}</span>
                  )}
                  {r.overrideExcluded && r.overrideRecId && (
                    <span className="text-bad text-xs ml-1" title="Excluded from the override base">excl</span>
                  )}
                </td>
                <td>
                  <span className={r.status === "Complete" ? "text-win" : "text-foil"}>{r.status}</span>
                </td>
                <td>{r.afterFees !== null ? $(r.afterFees) : "-"}</td>
                <td>{r.hours !== null ? r.hours.toFixed(1) : "-"}</td>
                <td>{r.tips ? $(r.tips) : "-"}</td>
                <td>{r.payroll !== null && r.payroll > 0 ? $(r.payroll) : "-"}</td>
                <td>{r.netProfit === null ? "-" : <span className={r.netProfit >= 0 ? "text-win" : "text-bad"}>{$(r.netProfit)}</span>}</td>
                <td className="text-right whitespace-nowrap">
                  <Link className="text-foil hover:underline" href={`/streams/${r.id}`}>Open</Link>
                  {isAdmin && (
                    <button
                      className="text-bad text-xs hover:underline ml-3 disabled:opacity-40"
                      disabled={busy === r.id}
                      onClick={() => softDelete(r)}
                    >
                      {busy === r.id ? "..." : "delete"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {streams.length === 0 && (
              <TableEmpty>No streams yet</TableEmpty>
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
