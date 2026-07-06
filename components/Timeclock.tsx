"use client";
import { useState } from "react";

export type TimeEntry = {
  id: string;
  type: string;
  person: string;
  hours: number;
  label: string;
};

export default function Timeclock({
  streamId,
  streamDate,
  entries,
  onChanged,
  hoursStreamed,
  streamerPacking,
  managerPacking,
  hasManager,
}: {
  streamId: string;
  streamDate: string;
  entries: TimeEntry[];
  onChanged: () => Promise<void>;
  hoursStreamed: number;
  streamerPacking: number;
  managerPacking: number;
  hasManager: boolean;
}) {
  const [type, setType] = useState<"Streaming" | "Packing">("Streaming");
  const [date, setDate] = useState(streamDate || new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function punch() {
    if (!start || !end) return;
    setBusy(true); setErr("");
    const res = await fetch("/api/time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId, type, date, start, end }),
    });
    const d = await res.json();
    if (!res.ok) { setErr(d.error || "Could not save time entry"); setBusy(false); return; }
    setStart(""); setEnd("");
    await onChanged();
    setBusy(false);
  }

  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/time/${id}`, { method: "DELETE" });
    await onChanged();
    setBusy(false);
  }

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="label">Timeclock</h2>
        <div className="text-xs text-dim num">
          Streamed <span className="text-body font-semibold">{hoursStreamed.toFixed(2)} hrs</span>
          <span className="mx-2">|</span>
          Packing <span className="text-body font-semibold">{streamerPacking.toFixed(2)} hrs</span>
          {hasManager && (
            <>
              <span className="mx-2">|</span>
              Manager packing <span className="text-body font-semibold">{managerPacking.toFixed(2)} hrs</span>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
        <div>
          <label className="label">Type</label>
          <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value as any)}>
            <option>Streaming</option>
            <option>Packing</option>
          </select>
        </div>
        <div>
          <label className="label">Date</label>
          <input type="date" className="input mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Start</label>
          <input type="time" className="input mt-1" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label">End</label>
          <input type="time" className="input mt-1" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <button className="btn-foil justify-center disabled:opacity-40" disabled={busy || !start || !end} onClick={punch}>
          Clock it
        </button>
      </div>
      {err && <div className="text-bad text-sm">{err}</div>}
      <p className="text-dim text-xs">
        End times past midnight roll to the next day automatically (8:00 PM to 1:30 AM = 5.50 hrs).
        Hours feed straight into pay - no separate hour entry needed.
      </p>

      {entries.length > 0 && (
        <table className="w-full">
          <thead><tr><th>Entry</th><th>Type</th><th>Person</th><th>Hours</th><th></th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="text-dim text-xs">{e.label}</td>
                <td>{e.type}</td>
                <td>{e.person}</td>
                <td className="!font-semibold">{e.hours.toFixed(2)}</td>
                <td className="text-right">
                  <button className="text-bad text-xs hover:underline" onClick={() => remove(e.id)}>remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
