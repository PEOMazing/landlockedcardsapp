"use client";
import { useRef, useState } from "react";
import { toast } from "@/components/Toaster";
import {
  CONDITIONS, PRINTINGS, chunk, cleanNumber, cleanText,
  needsPrinting, quoteTotal, toQuoteRows, type ScanRow,
} from "@/lib/scan";

// Photograph a pile, get a price for it.
//
// Shooting never waits on identifying. The row appears the moment the shutter
// closes and fills itself in behind you, because standing over somebody's
// binder waiting for a spinner is how a tool stops getting used.
//
// Printing is asked, never guessed: a Reverse and a Normal are the same
// artwork and the foil is the first thing a flash kills. Condition is asked
// too. Those two taps are the whole difference between a list you can price
// and a list that prices the wrong card.

const $ = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Phone originals are 3-4000px and several megabytes. The number in the
 *  corner survives 1000px easily, and the upload has to cross a card-show
 *  wifi. */
async function shrink(file: File, max = 1000): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.72);
}

type Row = ScanRow & { thumb: string; busy: boolean; failed: boolean };
type Priced = { key: string; price: number | null; matched: boolean; reason?: string };

export default function ScanClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [priced, setPriced] = useState<Record<string, Priced>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [noVision, setNoVision] = useState(false);
  const [fault, setFault] = useState("");
  const seq = useRef(0);

  const patch = (key: string, p: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function onShot(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const key = `r${++seq.current}`;
      let thumb = "";
      try { thumb = await shrink(file, 1000); } catch { toast("Could not read that photo", "bad"); continue; }
      // the row lands first and fills in behind: never block the next shot
      setRows((prev) => [...prev, {
        key, thumb, busy: true, failed: false,
        name: "", setName: "", number: "", variant: "", condition: "NM", qty: 1, source: "scan",
      }]);
      identify(key, thumb);
    }
  }

  async function identify(key: string, image: string) {
    try {
      const r = await fetch("/api/scan/identify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const d = await r.json().catch(() => ({}));
      if (d?.configured === false) { setNoVision(true); patch(key, { busy: false, failed: true }); return; }
      if (!d?.identity) {
        if (d?.error) setFault(String(d.error));
        patch(key, { busy: false, failed: true });
        return;
      }
      setFault("");
      patch(key, {
        busy: false, failed: false,
        name: d.identity.name, setName: d.identity.setName, number: d.identity.number,
      });
    } catch {
      patch(key, { busy: false, failed: true });
    }
  }

  async function priceAll() {
    const { ready, held } = toQuoteRows(rows);
    if (ready.length === 0) {
      toast(held.length ? "Every row still needs a name or a printing" : "Nothing to price yet", "bad");
      return;
    }
    setBusy(true);
    setProgress("");
    const readyRows = rows.filter((r) => cleanText(r.name) && !needsPrinting(r));
    const out: Record<string, Priced> = {};
    const batches = chunk(ready);
    try {
      for (let i = 0; i < batches.length; i++) {
        setProgress(`Pricing ${i * 40 + 1}-${Math.min((i + 1) * 40, ready.length)} of ${ready.length}`);
        const res = await fetch("/api/pokemon/quote", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "condition", rows: batches[i] }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { toast(d?.error || "Pricing failed", "bad"); break; }
        // rows come back in the order they were sent, and carry `comp` in
        // condition mode rather than a generic price
        (d.rows || []).forEach((p: any, j: number) => {
          const row = readyRows[i * 40 + j];
          if (!row) return;
          const comp = Number(p?.comp);
          out[row.key] = {
            key: row.key,
            price: Number.isFinite(comp) && comp > 0 ? comp : null,
            matched: !!p?.matched,
            reason: p?.reason || (p?.matched ? "no price found" : undefined),
          };
        });
      }
      setPriced(out);
      const t = quoteTotal(Object.values(out).map((p) => ({
        matched: p.matched, price: p.price, qty: rows.find((r) => r.key === p.key)?.qty || 1,
      })));
      toast(
        `${$(t.total)} across ${t.priced} card${t.priced === 1 ? "" : "s"}` +
        (t.unmatched ? `, ${t.unmatched} not priced` : "") +
        (held.length ? `, ${held.length} still need a printing` : ""),
        t.unmatched || held.length ? "bad" : "ok"
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const { held } = toQuoteRows(rows);
  const totals = quoteTotal(Object.values(priced).map((p) => ({
    matched: p.matched, price: p.price, qty: rows.find((r) => r.key === p.key)?.qty || 1,
  })));

  return (
    <main className="p-4 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="label">Scan a pile</h1>
          <div className="text-dim text-xs mt-0.5">
            Photograph cards one after another. Nothing is saved and no stock moves: this only prices them.
          </div>
        </div>
        <label className="btn-win text-sm cursor-pointer">
          Take a photo
          <input
            type="file" accept="image/*" capture="environment" multiple className="hidden"
            onChange={(e) => { onShot(e.target.files); e.currentTarget.value = ""; }}
          />
        </label>
      </div>

      {noVision && (
        <div className="rounded-lg border border-warn/60 bg-warn/10 p-3 text-xs">
          Card reading is not switched on, so photos will not fill themselves in. Add an
          <span className="num"> ANTHROPIC_API_KEY </span> in the Vercel project settings and redeploy.
          You can still type each card in by hand below.
        </div>
      )}

      {fault && !noVision && (
        <div className="rounded-lg border border-bad/60 bg-bad/10 p-3 text-xs">
          Card reading is failing: {fault}. Rows can still be typed in.
        </div>
      )}

      {rows.length === 0 && (
        <div className="text-dim text-sm">No cards yet. Take a photo to start.</div>
      )}

      <div className="space-y-2">
        {rows.map((r) => {
          const p = priced[r.key];
          const wants = needsPrinting(r);
          return (
            <div key={r.key} className={`card p-3 space-y-2 ${wants ? "border-warn/60" : ""}`}>
              <div className="flex gap-3">
                {r.thumb && <img src={r.thumb} alt="" className="w-14 rounded shrink-0 object-cover" />}
                <div className="flex-1 min-w-0 space-y-1">
                  {r.busy ? (
                    <div className="text-dim text-xs">Reading the card...</div>
                  ) : (
                    <>
                      <input
                        className="input text-sm w-full" placeholder="Card name"
                        value={r.name}
                        onChange={(e) => patch(r.key, { name: cleanText(e.target.value), source: "hand" })}
                      />
                      <div className="flex gap-2">
                        <input
                          className="input text-xs flex-1" placeholder="Set"
                          value={r.setName}
                          onChange={(e) => patch(r.key, { setName: cleanText(e.target.value) })}
                        />
                        <input
                          className="input text-xs w-28" placeholder="Number"
                          value={r.number}
                          onChange={(e) => patch(r.key, { number: cleanNumber(e.target.value) })}
                        />
                        <input
                          className="input text-xs w-16" type="number" min={1} value={r.qty}
                          onChange={(e) => patch(r.key, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                        />
                      </div>
                    </>
                  )}
                  {r.failed && !r.busy && !r.name && (
                    <div className="text-dim text-xs">Could not read it. Type the card in.</div>
                  )}
                </div>
                <button
                  className="btn-ghost text-xs self-start"
                  onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                >
                  remove
                </button>
              </div>

              <div className="flex gap-1 flex-wrap items-center">
                {PRINTINGS.map((v) => (
                  <button
                    key={v}
                    className={`text-xs px-2 py-0.5 rounded border ${r.variant === v ? "btn-win" : "btn-ghost"}`}
                    onClick={() => patch(r.key, { variant: r.variant === v ? "" : v })}
                  >
                    {v === "Reverse Holofoil" ? "Reverse" : v}
                  </button>
                ))}
                <span className="w-2" />
                {CONDITIONS.map((c) => (
                  <button
                    key={c}
                    className={`text-xs px-2 py-0.5 rounded border ${r.condition === c ? "btn-win" : "btn-ghost"}`}
                    onClick={() => patch(r.key, { condition: c })}
                  >
                    {c}
                  </button>
                ))}
              </div>

              {wants && (
                <div className="text-xs text-warn">
                  Pick the printing. A Reverse and a Normal look identical in a photo and do not sell for
                  the same money, so this one is not guessed.
                </div>
              )}

              {p && (
                <div className="text-xs num">
                  {p.matched && p.price != null
                    ? <>{$(p.price)}{r.qty > 1 ? ` x${r.qty} = ${$(p.price * r.qty)}` : ""}</>
                    : <span className="text-bad">not priced{p.reason ? ` (${p.reason})` : ""}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rows.length > 0 && (
        <div className="card p-3 flex items-center justify-between gap-3 flex-wrap sticky bottom-2">
          <div className="text-sm">
            <span className="num text-lg font-bold">{$(totals.total)}</span>
            <span className="text-dim text-xs ml-2">
              {totals.priced} priced
              {totals.unmatched ? `, ${totals.unmatched} not matched` : ""}
              {held.length ? `, ${held.length} need a printing` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {progress && <span className="text-dim text-xs">{progress}</span>}
            <button className="btn-win disabled:opacity-40" disabled={busy} onClick={priceAll}>
              {busy ? "Pricing..." : "Price it"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
