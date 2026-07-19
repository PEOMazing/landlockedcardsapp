"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

// Live show mode: everything a streamer needs mid-show and nothing else.
// The elapsed clock runs from the Start stream punch, sales numbers save
// themselves, every set line has a one-tap hit stepper, and End stream
// clocks them out and moves the show to Review for submission.

const $ = (n: number) => `$${(n || 0).toFixed(2)}`;

type Line = {
  id: string; name: string; qty: number; qtyHit: number; market: number;
  isGiveaway: boolean; isStore?: boolean; soldPrice?: number; image?: string;
};

export default function LiveClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ afterFees: "", spotsSold: "" });
  const baselineRef = useRef("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [invOptions, setInvOptions] = useState<{ id: string; name: string; market: number; qty: number }[]>([]);
  const [storeProduct, setStoreProduct] = useState("");
  const [storePrice, setStorePrice] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/streams/${id}`);
    if (!r.ok) return;
    const d = await r.json();
    setData(d);
    setLines(d.lines || []);
    const f = { afterFees: d.stream.afterFees ?? "", spotsSold: d.stream.spotsSold ?? "" };
    setForm(f);
    baselineRef.current = JSON.stringify(f);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/inventory");
        if (r.ok) {
          const d = await r.json();
          setInvOptions(
            ((d.items || d.inventory || []) as any[])
              .filter((i) => (i.qtyOnHand || 0) > 0)
              .map((i) => ({ id: i.id, name: i.name, market: i.marketPrice || 0, qty: i.qtyOnHand }))
              .sort((a, b) => a.name.localeCompare(b.name))
          );
        }
      } catch {}
    })();
  }, []);

  // sales auto-save, same contract as the stream page
  useEffect(() => {
    const nowJson = JSON.stringify(form);
    if (!baselineRef.current || nowJson === baselineRef.current) return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      const r = await fetch(`/api/streams/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afterFees: parseFloat(form.afterFees) || 0, spotsSold: parseInt(form.spotsSold) || 0 }),
      });
      if (r.ok) { baselineRef.current = nowJson; setSaveState("saved"); setTimeout(() => setSaveState("idle"), 1500); }
      else setSaveState("idle");
    }, 900);
    return () => clearTimeout(t);
  }, [form, id]);

  async function bumpHit(l: Line, delta: number) {
    const next = Math.min(Math.max(l.qtyHit + delta, 0), l.qty);
    if (next === l.qtyHit) return;
    setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, qtyHit: next } : x)));
    await fetch(`/api/lines/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qtyHit: next }),
    }).catch(() => {});
  }

  async function act(action: string) {
    setBusy(true); setErr("");
    const r = await fetch(`/api/streams/${id}/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(d.error || "something went wrong"); return; }
    if (action === "submit") { window.location.href = `/streams/${id}`; return; }
    setConfirmEnd(false);
    await load();
  }

  if (!data) return <main className="max-w-3xl mx-auto px-4 py-10 text-dim">Loading...</main>;
  const stream = data.stream;
  const status: string = stream.status;
  const isLive = status === "Live";
  const isReview = status === "Review";

  if (!isLive && !isReview) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-10 space-y-4">
        <p className="text-dim">This stream is not in live mode ({status}).</p>
        <Link className="btn-ghost inline-block" href={`/streams/${id}`}>Back to the stream page</Link>
      </main>
    );
  }

  const elapsedMs = stream.liveStartedAt ? now - new Date(stream.liveStartedAt).getTime() : 0;
  const eh = Math.floor(elapsedMs / 3600000);
  const em = Math.floor((elapsedMs % 3600000) / 60000);

  const setLines_ = lines.filter((l) => !l.isStore);
  const storeLines = lines.filter((l) => l.isStore);
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = tokens.length
    ? setLines_.filter((l) => tokens.every((t) => l.name.toLowerCase().includes(t)))
    : setLines_;
  const hitsDone = setLines_.reduce((a, l) => a + l.qtyHit, 0);
  const hitsTotal = setLines_.reduce((a, l) => a + l.qty, 0);
  const storeSales = storeLines.reduce((a, l) => a + (l.soldPrice || 0), 0);

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-5 pb-32">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">{stream.title}</h1>
          <p className="text-dim text-sm mt-0.5">
            {isLive ? (
              <>
                <span className="text-win font-semibold">LIVE</span> - {eh}h {em}m on the clock
              </>
            ) : (
              <span className="text-givvy font-semibold">Review - confirm the hits, then submit</span>
            )}
          </p>
        </div>
        <Link className="text-dim text-xs hover:text-body" href={`/streams/${id}`}>full stream page</Link>
      </header>

      {isLive && (
        <section className="card p-4 flex gap-3 items-end flex-wrap">
          <div>
            <label className="label">Sales so far $</label>
            <input
              type="number" step="0.01" className="input mt-1 !w-32 text-lg"
              value={form.afterFees}
              onChange={(e) => setForm({ ...form, afterFees: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Spins sold</label>
            <input
              type="number" step="1" min={0} className="input mt-1 !w-24 text-lg"
              value={form.spotsSold}
              onChange={(e) => setForm({ ...form, spotsSold: e.target.value })}
            />
          </div>
          <span className="text-xs text-dim pb-2">
            {saveState === "saving" ? "saving..." : saveState === "saved" ? "saved" : "saves automatically"}
          </span>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="label">Hits - {hitsDone} marked</h2>
          <input className="input !w-48 !py-1 text-sm" placeholder="find an item..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          {shown.map((l) => (
            <div key={l.id} className={`card !py-2 px-3 flex items-center gap-3 ${l.qtyHit >= l.qty ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{l.name}</div>
                <div className="text-xs text-dim">
                  {$(l.market)}{l.isGiveaway ? " - givvy" : ""} - {l.qtyHit}/{l.qty} hit
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="w-9 h-9 rounded-lg border border-edge text-lg leading-none disabled:opacity-30"
                  disabled={l.qtyHit <= 0}
                  onClick={() => bumpHit(l, -1)}
                >
                  -
                </button>
                <span className="num w-8 text-center text-sm">{l.qtyHit}</span>
                <button
                  className="w-9 h-9 rounded-lg border border-win/50 text-win text-lg leading-none disabled:opacity-30"
                  disabled={l.qtyHit >= l.qty}
                  onClick={() => bumpHit(l, 1)}
                >
                  +
                </button>
              </div>
            </div>
          ))}
          {shown.length === 0 && <p className="text-dim text-sm">Nothing matches.</p>}
        </div>
      </section>

      {isLive && (
        <section className="card p-4 space-y-2">
          <h2 className="label">Store purchase</h2>
          <div className="flex gap-2 flex-wrap items-end">
            <select
              className="input flex-1 min-w-52"
              value={storeProduct}
              onChange={(e) => {
                setStoreProduct(e.target.value);
                const p = invOptions.find((i) => i.id === e.target.value);
                if (p) setStorePrice(p.market ? String(p.market.toFixed(2)) : "");
              }}
            >
              <option value="">Someone bought off the shelf...</option>
              {invOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.qty})</option>
              ))}
            </select>
            <input type="number" step="0.01" className="input !w-24" placeholder="$" value={storePrice} onChange={(e) => setStorePrice(e.target.value)} />
            <button
              className="btn-win disabled:opacity-40"
              disabled={busy || !storeProduct || !(parseFloat(storePrice) >= 0)}
              onClick={async () => {
                setBusy(true);
                const r = await fetch("/api/lines/store", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ streamId: id, productId: storeProduct, soldPrice: parseFloat(storePrice) }),
                });
                setBusy(false);
                if (r.ok) { setStoreProduct(""); setStorePrice(""); await load(); }
              }}
            >
              Sold
            </button>
          </div>
          {storeLines.length > 0 && (
            <p className="text-xs text-dim">{storeLines.length} store sale{storeLines.length > 1 ? "s" : ""} - {$(storeSales)}</p>
          )}
        </section>
      )}

      <div className="fixed bottom-0 inset-x-0 border-t border-edge bg-panel/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          {err && <span className="text-bad text-sm">{err}</span>}
          <span className="text-dim text-xs mr-auto">{hitsDone}/{hitsTotal} hits marked</span>
          {isLive ? (
            !confirmEnd ? (
              <button className="btn-ghost !border-bad/50 !text-bad" onClick={() => setConfirmEnd(true)}>End stream</button>
            ) : (
              <span className="flex items-center gap-2">
                <span className="text-sm text-dim">Clock out and go to review?</span>
                <button className="btn-ghost" onClick={() => setConfirmEnd(false)}>keep going</button>
                <button className="btn-win disabled:opacity-40" disabled={busy} onClick={() => act("end")}>End stream</button>
              </span>
            )
          ) : (
            <button className="btn-win disabled:opacity-40" disabled={busy} onClick={() => act("submit")}>
              Submit stream for approval
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
