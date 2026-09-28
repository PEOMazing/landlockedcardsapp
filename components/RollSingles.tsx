"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/Toaster";

// Pull the unhit singles off a previous show onto this one.
//
// A Surprise Set that does not sell out leaves a wheel nobody emptied. Without
// this, the next set is built by returning forty cards to stock and picking
// the same forty again by hand. The list arrives all ticked, because rolling
// everything is the common case; unticking is how a card that has sat on the
// wheel four shows running gets retired.

const $ = (n: number) => `$${(n || 0).toFixed(2)}`;

type Src = { id: string; title: string; date: string; left: number };
type Cand = { lineId: string; name: string; market: number; qty: number; can: boolean; why: string };

export default function RollSingles({ streamId, onRolled }: { streamId: string; onRolled: () => Promise<void> | void }) {
  const [srcs, setSrcs] = useState<Src[] | null>(null);
  const [from, setFrom] = useState("");
  const [cards, setCards] = useState<Cand[] | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const loadSrcs = useCallback(async () => {
    try {
      const d = await fetch(`/api/streams/${streamId}/rollover`).then((r) => r.json());
      setSrcs(Array.isArray(d.sources) ? d.sources : []);
    } catch { setSrcs([]); }
  }, [streamId]);
  useEffect(() => { loadSrcs(); }, [loadSrcs]);

  async function preview(id: string) {
    setFrom(id); setCards(null);
    try {
      const d = await fetch(`/api/streams/${streamId}/rollover?from=${id}`).then((r) => r.json());
      const cs: Cand[] = d.cards || [];
      setCards(cs);
      // Everything that can move starts ticked.
      setPick(Object.fromEntries(cs.filter((c) => c.can).map((c) => [c.lineId, true])));
    } catch { setCards([]); }
  }

  async function roll() {
    const lineIds = Object.entries(pick).filter(([, v]) => v).map(([k]) => k);
    if (!lineIds.length) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/streams/${streamId}/rollover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, lineIds }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error || "Could not roll the cards over"); return; }
      toast(`Rolled ${d.moved} card${d.moved === 1 ? "" : "s"} over${d.skipped?.length ? `, ${d.skipped.length} skipped` : ""}`);
      setFrom(""); setCards(null); setPick({});
      await loadSrcs();
      await onRolled();
    } catch { toast("Could not roll the cards over"); }
    setBusy(false);
  }

  if (!srcs || srcs.length === 0) return null;

  const can = (cards || []).filter((c) => c.can);
  const cannot = (cards || []).filter((c) => !c.can);
  const ticked = can.filter((c) => pick[c.lineId]);
  const value = ticked.reduce((a, c) => a + c.market, 0);

  return (
    <div className="space-y-2 border border-edge rounded-lg p-3">
      <button type="button" className="flex items-center gap-2 w-full text-left" onClick={() => setOpen((v) => !v)}>
        <span className="label !mb-0">Roll singles over from a past show</span>
        <span className="text-dim text-xs">
          {srcs.length} show{srcs.length === 1 ? "" : "s"} with cards left
        </span>
        <span className="text-dim ml-auto">{open ? "∧" : "∨"}</span>
      </button>

      {open && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {srcs.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => (from === s.id ? (setFrom(""), setCards(null)) : preview(s.id))}
                className={`text-xs px-2 py-1 rounded border text-left ${from === s.id ? "border-foil text-foil" : "border-edge text-dim hover:text-body"}`}
              >
                <span className="block max-w-[22rem] truncate">{s.title || s.date}</span>
                <span className="num opacity-70">{s.left} left</span>
              </button>
            ))}
          </div>

          {from && cards === null && <div className="text-dim text-sm">Reading that show...</div>}

          {cards && (
            <>
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span className="text-dim">
                  <span className="num">{ticked.length}</span> of <span className="num">{can.length}</span> ticked
                  {ticked.length > 0 && <> · <span className="num">{$(value)}</span> of product</>}
                </span>
                <button type="button" className="text-foil hover:underline" onClick={() => setPick(Object.fromEntries(can.map((c) => [c.lineId, true])))}>all</button>
                <button type="button" className="text-dim hover:text-body hover:underline" onClick={() => setPick({})}>none</button>
                <button
                  type="button"
                  className="btn-foil !px-3 !py-1 text-xs ml-auto disabled:opacity-40"
                  disabled={busy || ticked.length === 0}
                  onClick={roll}
                >
                  {busy ? "Rolling..." : `Roll ${ticked.length} over`}
                </button>
              </div>

              <div className="grid gap-1 max-h-72 overflow-auto">
                {can.map((c) => (
                  <label key={c.lineId} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 cursor-pointer ${pick[c.lineId] ? "border-foil/40" : "border-edge opacity-60"}`}>
                    <input type="checkbox" checked={!!pick[c.lineId]} onChange={(e) => setPick({ ...pick, [c.lineId]: e.target.checked })} />
                    <span className="text-sm truncate">{c.name}</span>
                    <span className="num text-xs text-dim ml-auto shrink-0">{$(c.market)}</span>
                  </label>
                ))}
                {can.length === 0 && <div className="text-dim text-sm">Nothing on that show can roll over.</div>}
                {cannot.length > 0 && (
                  <details className="text-xs text-dim mt-1">
                    <summary className="cursor-pointer">{cannot.length} cannot move</summary>
                    <div className="grid gap-0.5 mt-1">
                      {cannot.map((c) => (
                        <div key={c.lineId} className="flex gap-2">
                          <span className="truncate">{c.name}</span>
                          <span className="ml-auto shrink-0">{c.why}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
