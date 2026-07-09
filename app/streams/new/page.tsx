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
  const [streamType, setStreamType] = useState("Surprise Set");

  const TYPE_HELP: Record<string, string> = {
    "Surprise Set": "Wheel show: spins land on hit items or floor level packs.",
    "Character Break": "Pick a product, sell spots randomly, rip packs at the end - checklist cards go to whoever pulled them.",
    "Single Stream": "Auction singles from the card inventory, starting at $1.",
  };

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
      body: JSON.stringify({ date, title, streamType, ...(streamerId ? { streamerId } : {}) }),
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
          <label className="label">Show type</label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {["Surprise Set", "Character Break", "Single Stream"].map((t) => (
              <button
                key={t}
                type="button"
                className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                  streamType === t ? "border-foil text-foil bg-foil/10" : "border-edge text-dim hover:text-body"
                }`}
                onClick={() => setStreamType(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="text-dim text-xs mt-1">{TYPE_HELP[streamType]}</p>
        </div>
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
