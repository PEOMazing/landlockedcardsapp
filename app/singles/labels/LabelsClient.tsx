"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

// Printable QR label sheet on the Avery 5160 grid (30 labels, 2.625in x 1in).
// Each QR resolves to the card's quick-sell page, so scanning a label at the
// table opens the record ready to be marked sold.
type L = { id: string; name: string; setName: string; number: string; condition: string; printing: string; comp: number | null; qr: string; location: string };

const clean = (n: string) => n.replace(/\s*-\s*[\w]+\/[\w]+\s*$/, "");
const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function LabelsClient() {
  const [labels, setLabels] = useState<L[] | null>(null);
  const [includePrice, setIncludePrice] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const ids: string[] = JSON.parse(sessionStorage.getItem("llc-label-ids") || "[]");
        if (ids.length === 0) { setErr("No cards selected. Filter the Singles page to what you want, then hit Print labels."); return; }
        const d = await (await fetch("/api/singles")).json();
        const byId = new Map((d.singles || []).map((s: any) => [s.id, s]));
        const out: L[] = [];
        for (const id of ids) {
          const s: any = byId.get(id);
          if (!s) continue;
          const qr = await QRCode.toDataURL(`${window.location.origin}/label/${id}`, { margin: 0, width: 96 });
          out.push({ id, name: clean(s.name), setName: s.setName, number: s.number, condition: s.condition, printing: s.printing, comp: s.comp, qr, location: s.location || "" });
        }
        setLabels(out);
      } catch {
        setErr("Could not build labels");
      }
    })();
  }, []);

  if (err) return <main className="p-8 text-dim">{err}</main>;
  if (!labels) return <main className="p-8 text-dim">Building labels...</main>;

  return (
    <>
      <style>{`
        @page { size: letter; margin: 0.5in 0.19in; }
        .sheet { display: grid; grid-template-columns: repeat(3, 2.625in); column-gap: 0.125in; }
        .lbl { width: 2.625in; height: 1in; padding: 0.07in 0.1in; box-sizing: border-box; display: flex; gap: 0.08in; align-items: center; overflow: hidden; break-inside: avoid; }
        .lbl img { width: 0.78in; height: 0.78in; }
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .lbl { color: #000; }
        }
        @media screen {
          .sheet { background: #fff; color: #000; padding: 0.5in 0.19in; margin: 0 auto; width: 8.5in; box-shadow: 0 8px 40px rgba(0,0,0,.5); }
        }
      `}</style>
      <main className="py-6">
        <div className="no-print max-w-[8.5in] mx-auto mb-4 flex items-center justify-between px-2">
          <div>
            <div className="font-bold">{labels.length} labels - Avery 5160 (30 per sheet)</div>
            <div className="text-dim text-xs">Scan a label to open the card&apos;s quick-sell page. Load 1in x 2 5/8in label sheets and print at 100% scale.</div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-dim flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={includePrice} onChange={(e) => setIncludePrice(e.target.checked)} />
              include price (comps drift - the QR always shows the live comp)
            </label>
            <a href="/singles" className="btn-ghost">Back</a>
            <button className="btn-foil" onClick={() => window.print()}>Print</button>
          </div>
        </div>
        <div className="sheet">
          {labels.map((l) => (
            <div key={l.id} className="lbl">
              <img src={l.qr} alt="" />
              <div style={{ minWidth: 0, lineHeight: 1.15 }}>
                <div style={{ fontWeight: 700, fontSize: "9.5pt", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>
                <div style={{ fontSize: "7pt", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {l.setName}{l.number ? ` #${l.number}` : ""}{l.printing ? ` ${l.printing}` : ""}
                </div>
                <div style={{ fontSize: "7pt" }}>{l.condition}{l.location ? <b style={{ marginLeft: 4 }}>#{l.location}</b> : null}</div>
                {includePrice && <div style={{ fontWeight: 800, fontSize: "12pt" }}>{l.comp !== null ? $(l.comp) : ""}</div>}
              </div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
