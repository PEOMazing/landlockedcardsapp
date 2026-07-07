"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewStream() {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [streamers, setStreamers] = useState<{ id: string; name: string }[]>([]);
  const [streamerId, setStreamerId] = useState("");

  useEffect(() => {
    // only managers/admins get a list back; everyone else streams for themselves
    fetch("/api/streamers").then(async (r) => {
      if (r.ok) {
        const d = await r.json();
        setStreamers(d.streamers || []);
      }
    });
  }, []);

  async function create() {
    setBusy(true); setErr("");
    const res = await fetch("/api/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, title, ...(streamerId ? { streamerId } : {}) }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Could not create stream"); setBusy(false); return; }
    router.push(`/streams/${data.id}`);
  }

  return (
    <main className="max-w-md mx-auto p-6 space-y-5">
      <Link href="/dashboard" className="text-dim text-sm hover:text-body">&larr; Back</Link>
      <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>New stream</h1>
      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Stream date</label>
          <input type="date" className="input mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {streamers.length > 0 && (
          <div>
            <label className="label">Who is streaming</label>
            <select className="input mt-1" value={streamerId} onChange={(e) => setStreamerId(e.target.value)}>
              <option value="">Me</option>
              {streamers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <p className="text-dim text-xs mt-1">
              Assigning someone else makes you the stream manager: you earn packing hours plus your
              commission override on this stream.
            </p>
          </div>
        )}
        <div>
          <label className="label">Title (optional)</label>
          <input className="input mt-1" placeholder="Friday Night Rips" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        {err && <div className="text-bad text-sm">{err}</div>}
        <button className="btn-foil w-full justify-center disabled:opacity-40" disabled={busy} onClick={create}>
          {busy ? "Creating..." : "Create and build show set"}
        </button>
      </div>
    </main>
  );
}
