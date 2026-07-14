"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/Toaster";

// Scan-to-quote: a scanner gun in keyboard-wedge mode types the label's URL
// and hits Enter. The listener input parses out the record id, pulls the card
// with its live comp, and builds a running quote. One button books it all.
type Line = { id: string; name: string; setName: string; number: string; condition: string; printing: string; image: string; comp: number | null; price: string; location: string };

const clean = (n: string) => n.replace(/\s*-\s*[\w]+\/[\w]+\s*$/, "");
const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function QuoteClient() {
  const [scan, setScan] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [byId, setById] = useState<Map<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/singles").then((r) => r.json()).then((d) => {
      setById(new Map((d.singles || []).map((s: any) => [s.id, s])));
    });
    inputRef.current?.focus();
  }, []);

  function addScan(raw: string) {
    setScan("");
    inputRef.current?.focus();
    const m = raw.match(/rec[A-Za-z0-9]{14}/);
    if (!m) { toast("No card code in that scan", "bad"); return; }
    const id = m[0];
    if (lines.some((l) => l.id === id)) { toast("Already in this quote", "bad"); return; }
    const s = byId?.get(id);
    if (!s) { toast("Card not found", "bad"); return; }
    if (s.status === "Sold") { toast(`${clean(s.name)} is already sold`, "bad"); return; }
    setLines((prev) => [...prev, {
      id, name: clean(s.name), setName: s.setName, number: s.number, condition: s.condition,
      printing: s.printing, image: s.image, comp: s.comp, location: s.location || "",
      price: s.comp !== null ? String(s.comp) : "",
    }]);
  }

  const total = useMemo(() => lines.reduce((a, l) => a + (parseFloat(l.price) || 0), 0), [lines]);

  async function bookSale() {
    if (lines.some((l) => !(parseFloat(l.price) > 0))) { toast("Every line needs a price", "bad"); return; }
    setBusy(true);
    let ok = 0;
    for (const l of lines) {
      const r = await fetch(`/api/singles/${l.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salePrice: parseFloat(l.price), status: "Sold" }),
      });
      if (r.ok) ok++;
    }
    setBusy(false);
    if (ok === lines.length) { setDone(true); toast(`Sold ${ok} cards for ${$(total)}`); }
    else toast(`${ok} of ${lines.length} booked - check the rest`, "bad");
  }

  if (done) {
    return (
      <main className="max-w-2xl mx-auto p-6">
        <div className="card p-8 text-center space-y-3">
          <div className="text-win text-3xl font-bold">{"\u2713"} {$(total)}</div>
          <div className="text-dim">{lines.length} cards sold and booked</div>
          <button className="btn-foil" onClick={() => { setLines([]); setDone(false); inputRef.current?.focus(); }}>New quote</button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Quote</h1>
        <span className="text-dim text-sm">scan labels with a scanner gun or paste a code</span>
      </div>

      <input
        ref={inputRef}
        className="input w-full !py-3 text-center"
        placeholder={byId ? "Scan a label..." : "Loading cards..."}
        value={scan}
        disabled={!byId}
        onChange={(e) => setScan(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && scan.trim()) addScan(scan.trim()); }}
      />

      <div className="space-y-2">
        {lines.map((l) => (
          <div key={l.id} className="card p-3 flex items-center gap-3">
            {l.image && <img src={l.image} alt="" className="w-10 rounded-sm" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate">{l.name}{l.location ? <span className="ml-2 text-xs font-bold text-foil">#{l.location}</span> : null}</div>
              <div className="text-dim text-xs truncate">
                {l.setName}{l.number ? ` #${l.number}` : ""} - {l.condition}
                {l.printing ? ` - ${l.printing}` : ""}
                {l.comp !== null && <span> - comp {$(l.comp)}</span>}
              </div>
            </div>
            <input
              type="number" step="0.01" inputMode="decimal"
              className="input !w-24 !py-1.5 text-right"
              value={l.price}
              onChange={(e) => setLines((prev) => prev.map((x) => x.id === l.id ? { ...x, price: e.target.value } : x))}
            />
            <button className="text-dim hover:text-bad px-1" onClick={() => setLines((prev) => prev.filter((x) => x.id !== l.id))}>{"\u2715"}</button>
          </div>
        ))}
        {lines.length === 0 && <div className="text-dim text-sm text-center py-8">Scanned cards appear here with their live comps</div>}
      </div>

      {lines.length > 0 && (
        <div className="card p-4 flex items-center justify-between sticky bottom-4 border-foil/40">
          <div>
            <div className="label">{lines.length} cards</div>
            <div className="num text-2xl font-bold holo-text inline-block">{$(total)}</div>
          </div>
          <button className="btn-foil !py-3 !px-6 disabled:opacity-40" disabled={busy} onClick={bookSale}>
            {busy ? "Booking..." : "Mark all sold"}
          </button>
        </div>
      )}
    </main>
  );
}
