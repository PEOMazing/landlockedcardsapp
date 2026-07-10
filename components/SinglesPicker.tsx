"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Thumb from "@/components/Thumb";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SingleT = {
  id: string; name: string; setName: string; number: string; condition: string;
  comp: number | null; image: string; qty: number;
};

// For Single Streams: search the singles card inventory and drop cards onto
// the show set. Every add snapshots the comp as the line's market price so
// spot math and pay work exactly like a sealed show.
export default function SinglesPicker({
  streamId,
  onAdded,
  busy,
}: {
  streamId: string;
  onAdded: () => Promise<void> | void;
  busy?: boolean;
}) {
  const [items, setItems] = useState<SingleT[]>([]);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState<string>("");
  const [err, setErr] = useState("");

  async function loadStock() {
    const r = await fetch("/api/singles?status=In Stock");
    const d = await r.json();
    setItems(d.singles || []);
  }
  useEffect(() => { loadStock(); }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items.slice(0, 8);
    return items
      .filter((s) =>
        s.name.toLowerCase().includes(n) ||
        s.setName.toLowerCase().includes(n) ||
        s.condition.toLowerCase().includes(n) ||
        s.number === n
      )
      .slice(0, 8);
  }, [items, q]);

  async function add(s: SingleT) {
    setAdding(s.id); setErr("");
    const res = await fetch(`/api/singles/${s.id}/to-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId }),
    });
    if (!res.ok) {
      const d = await res.json();
      setErr(d.error || "Could not add card");
    } else {
      await Promise.all([onAdded(), loadStock()]);
    }
    setAdding("");
  }

  return (
    <div className="space-y-2 border border-edge rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="label">Add singles from card inventory</span>
        <Link href="/singles" className="text-foil text-xs hover:underline">Manage singles</Link>
      </div>
      <input
        className="input"
        placeholder='Search your singles - try "Charizard" or "PSA 10"'
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {err && <div className="text-bad text-xs">{err}</div>}
      <div className="grid gap-1">
        {filtered.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-lg border border-edge px-3 py-2">
            {s.image && <Thumb src={s.image} size={28} className="shrink-0" />}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{s.name}</div>
              <div className="text-dim text-xs truncate">
                {s.setName}{s.number ? ` #${s.number}` : ""} - {s.condition}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3 shrink-0">
              <span className="num text-sm">{s.comp !== null ? $(s.comp) : "no comp"}</span>
              <button
                className="btn-foil !px-3 !py-1 text-xs disabled:opacity-40"
                disabled={busy || adding === s.id}
                onClick={() => add(s)}
              >
                {adding === s.id ? "Adding..." : "Add"}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-dim text-sm">
            No in-stock singles match. Add cards on the <Link href="/singles" className="text-foil hover:underline">Singles</Link> page first.
          </div>
        )}
      </div>
    </div>
  );
}
