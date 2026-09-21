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
  // After a stream is created we hold on the page long enough to remind the
  // streamer that the name has to match Whatnot, or the export check can't
  // pair the two up.
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);

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
    setCreated({ id: data.id, title: title.trim() });
    setBusy(false);
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
          <label className="label">Whatnot show title</label>
          <input className="input mt-1" placeholder="Paste the show title from Whatnot" value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="text-dim text-xs mt-1">Copy it straight from Whatnot so the two match exactly.</p>
        </div>
        {err && <div className="text-bad text-sm">{err}</div>}
        <button className="btn-foil w-full justify-center disabled:opacity-40" disabled={busy} onClick={create}>
          {busy ? "Creating..." : "Create and build show set"}
        </button>
      </div>

      {created && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative card p-6 max-w-sm w-full space-y-4 border-amber-400/60">
            <div className="text-lg font-bold text-amber-400">Heads up: match the Whatnot name</div>
            <p className="text-sm">
              Your stream was created. The stream name in the app must match the Whatnot show name
              exactly, or the Whatnot export check will not line up with this stream.
            </p>
            {created.title ? (
              <p className="text-sm">
                App name: <span className="font-semibold">{created.title}</span>
                <br />
                <span className="text-dim text-xs">Double check it against the title on Whatnot. Same words, same spelling.</span>
              </p>
            ) : (
              <p className="text-sm text-bad">
                You left the title blank, so this stream only has your name on it. Rename it to the Whatnot show title.
              </p>
            )}
            <button className="btn-foil w-full justify-center" onClick={() => router.push(`/streams/${created.id}`)}>
              Got it, build the show set
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
