"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { formatCardNo, bucketFor, bucketRange } from "@/lib/cardNo";

// Printable card labels in two shapes, because the two ways of printing them
// want completely different pages:
//
//   sheet - Avery 5160, 30 labels to a letter page, for a laser printer
//   roll  - 2in x 3/4in, one label per page, for a thermal label printer
//
// Each QR resolves to the card's quick-sell page, so scanning a label at the
// table opens the record ready to be marked sold.
type L = { id: string; cardNo: string; bucket: string; name: string; setName: string; number: string; condition: string; printing: string; comp: number | null; qr: string; location: string };

type Mode = "sheet" | "roll";
const MODE_KEY = "llc-label-mode";

const clean = (n: string) => n.replace(/\s*-\s*[\w]+\/[\w]+\s*$/, "");
const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function LabelsClient() {
  const [labels, setLabels] = useState<L[] | null>(null);
  const [includePrice, setIncludePrice] = useState(false);
  // The roll is the printer that actually gets used at a show, so it is what
  // you get unless you have said otherwise on this browser before.
  const [mode, setMode] = useState<Mode>("roll");
  const [err, setErr] = useState("");

  // Remember which printer you last used, so you are not re-picking every time.
  // Storage can throw in a locked-down browser, and a label page that refuses
  // to load over a remembered preference would be a silly way to fail.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === "roll" || saved === "sheet") setMode(saved);
    } catch {}
  }, []);
  function pickMode(m: Mode) {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch {}
  }

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
          // Rendered large and scaled down by CSS: at 203dpi a 0.6in QR is
          // ~122 dots, which still leaves 3+ dots per module for a link this
          // short, so it scans off a phone
          const qr = await QRCode.toDataURL(`${window.location.origin}/label/${id}`, { margin: 0, width: 220 });
          out.push({ id, cardNo: formatCardNo(s.cardNo), bucket: bucketFor(s.comp), name: clean(s.name), setName: s.setName, number: s.number, condition: s.condition, printing: s.printing, comp: s.comp, qr, location: s.location || "" });
        }
        setLabels(out);
      } catch {
        setErr("Could not build labels");
      }
    })();
  }, []);

  // Record the bucket now on each sticker so the singles page can tell later
  // when a comp has drifted across a band and the card needs re-stickering.
  // Print first: a failed stamp should never stop the labels coming out.
  async function printAndRecord() {
    window.print();
    if (!labels) return;
    const ids = labels.filter((l) => l.bucket).map((l) => l.id);
    if (ids.length === 0) return;
    try {
      await fetch("/api/singles/labels-printed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    } catch {
      // the paper is already out; drift tracking catching up later is fine
    }
  }

  if (err) return <main className="p-8 text-dim">{err}</main>;
  if (!labels) return <main className="p-8 text-dim">Building labels...</main>;

  const roll = mode === "roll";

  return (
    <>
      {/* Page size has to be committed to at print time, so the two modes carry
          their own @page rule rather than sharing one. */}
      <style>{roll ? `
        @page { size: 2in 0.75in; margin: 0; }
        /* One label per page, and nothing else on the page.
           The break lives on .page, a plain block wrapper, not on the label
           itself: the label is a flex box, and a break asked for on a flex
           container is the first thing a print pipeline drops. Every ancestor
           between the page box and the label is flattened to zero padding at
           print time for the same reason - 24px of leftover screen padding on
           <main> is enough to push a 0.75in label past a 0.75in page and turn
           one label per page into one long strip. */
        /* The content hugs the top of the page rather than centring in it.
           A thermal driver hands the browser a page that is the label plus the
           gap between labels, so a box told to centre itself centres in the
           taller page and lands low on the sticker, with the spare height
           printing above it instead of in the gap where it belongs. Sitting at
           the top means any extra height the driver reports falls off the
           bottom, into the gap, and the print starts at the label's edge
           whatever page height it was handed. */
        .page { display: block; width: 2in; max-height: 0.75in; overflow: hidden; break-inside: avoid; page-break-inside: avoid; break-after: page; page-break-after: always; }
        .page:last-child { break-after: auto; page-break-after: auto; }
        .sheet { display: block; }
        .lbl {
          width: 2in; padding: 0.02in 0.05in; box-sizing: border-box;
          display: flex; gap: 0.05in; align-items: center; overflow: hidden;
        }
        /* 0.6in at 203dpi is ~122 dots, still 3+ dots per QR module, which scans */
        .lbl img { width: 0.6in; height: 0.6in; flex-shrink: 0; }
        .cardno { font-weight: 800; font-size: 10.5pt; letter-spacing: 0.3px; font-variant-numeric: tabular-nums; }
        .bucketcond { font-weight: 700; font-size: 7pt; letter-spacing: 0.2px; }
        .cardname { font-weight: 700; font-size: 6.5pt; }
        .cardset { font-size: 5pt; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; width: 2in; }
          .printroot { margin: 0 !important; padding: 0 !important; }
          .no-print { display: none !important; }
          .lbl { color: #000; }
        }
        /* The preview is the sticker at its real size with the content sitting
           where the printer will put it, so what is on screen is what comes
           off the roll. */
        @media screen {
          .sheet { display: flex; flex-wrap: wrap; gap: 0.12in; justify-content: center; }
          .page { height: 0.75in; background: #fff; color: #000; box-shadow: 0 2px 10px rgba(0,0,0,.45); }
          .lbl { color: #000; }
        }
      ` : `
        /* Zero page margin on purpose. A browser draws the URL and the page
           title into the @page margin box, and there is no CSS that turns that
           off - but with no margin there is nowhere to draw it. The Avery inset
           moves onto .sheet, which prints the same and stays ours. */
        @page { size: letter; margin: 0; }
        .sheet { display: grid; grid-template-columns: repeat(3, 2.625in); column-gap: 0.125in; padding: 0.5in 0.19in; box-sizing: border-box; }
        .lbl { width: 2.625in; height: 1in; padding: 0.07in 0.1in; box-sizing: border-box; display: flex; gap: 0.08in; align-items: center; overflow: hidden; break-inside: avoid; }
        .lbl img { width: 0.7in; height: 0.7in; flex-shrink: 0; }
        .idcol { flex-shrink: 0; text-align: center; line-height: 1.05; }
        .cardno { font-weight: 800; font-size: 14pt; letter-spacing: 0.5px; font-variant-numeric: tabular-nums; }
        .bucketcond { font-weight: 700; font-size: 9pt; letter-spacing: 0.3px; }
        .cardname { font-weight: 700; font-size: 9.5pt; }
        .cardset { font-size: 7pt; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .printroot { margin: 0 !important; padding: 0 !important; }
          .no-print { display: none !important; }
          .lbl { color: #000; }
        }
        @media screen {
          .sheet { background: #fff; color: #000; margin: 0 auto; width: 8.5in; box-shadow: 0 8px 40px rgba(0,0,0,.5); }
        }
      `}</style>
      <main className="py-6 printroot">
        <div className="no-print max-w-[8.5in] mx-auto mb-4 flex items-start justify-between gap-4 px-2">
          <div>
            <div className="font-bold">
              {labels.length} labels - {roll ? "2in x 3/4in roll (thermal)" : "Avery 5160 (30 per sheet)"}
            </div>
            <div className="text-dim text-[11px] mt-1">
              {["A", "B", "C", "D", "E", "F", "G", "H"].map((b) => (
                <span key={b} className="mr-2.5 whitespace-nowrap">
                  <b className="text-body">{b}</b> {bucketRange(b)}
                </span>
              ))}
            </div>
            <div className="text-dim text-xs mt-1">
              The big number is the card&apos;s permanent ID - it shows on the stream line when the card is hit, and the
              letter is its price box. Scan a label to open the quick-sell page.
            </div>
            <div className="text-dim text-xs mt-1">
              {roll
                ? "For the iDPRT SP310. One label per page. Set paper size to 2 x 0.75 inch, margins Default or None, scale 100%. The page asks for no margins so the browser has nowhere to print the URL and page number - if they still appear, untick Headers and footers under More settings."
                : "Load 1in x 2 5/8in label sheets and print at 100% scale on a laser printer. If the URL or page number shows up, untick Headers and footers under More settings."}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="inline-flex rounded-lg border border-edge overflow-hidden">
              {([["sheet", "Avery sheet"], ["roll", "2 x 3/4 roll"]] as [Mode, string][]).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => pickMode(m)}
                  className={`px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${
                    mode === m ? "bg-foil/15 text-foil font-semibold" : "text-dim hover:text-body"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="text-xs text-dim flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={includePrice} onChange={(e) => setIncludePrice(e.target.checked)} />
              include price (comps drift - the QR always shows the live comp)
            </label>
            <div className="flex items-center gap-3">
              <a href="/singles" className="btn-ghost">Back</a>
              {/* The button says what is about to come out of the printer. The
                  two modes produce completely different paper and the only
                  thing that used to distinguish them was a toggle above. */}
              <button className="btn-foil" onClick={printAndRecord}>
                Print {labels.length} {roll ? "- one per page" : `- ${Math.ceil(labels.length / 30)} sheet${Math.ceil(labels.length / 30) === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
        <div className="sheet">
          {labels.map((l) => (
            <Page key={l.id} on={roll}>
            <div className="lbl">
              <img src={l.qr} alt="" />
              {!roll && (
                <div className="idcol">
                  {l.cardNo && <div className="cardno">{l.cardNo}</div>}
                  <div className="bucketcond">{[l.bucket, l.condition].filter(Boolean).join(" · ")}</div>
                </div>
              )}
              <div style={{ minWidth: 0, lineHeight: 1.15 }}>
                {roll && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: "0.05in" }}>
                    {l.cardNo && <span className="cardno">{l.cardNo}</span>}
                    <span className="bucketcond" style={{ whiteSpace: "nowrap" }}>
                      {[l.bucket, l.condition].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                )}
                <div className="cardname" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>
                <div className="cardset" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {l.setName}{l.number ? ` #${l.number}` : ""}{l.printing ? ` ${l.printing}` : ""}
                </div>
                {/* the roll label has no room for extras beyond the essentials */}
                {!roll && l.location && <div className="cardset">{l.location}</div>}
                {includePrice && (
                  <div style={{ fontWeight: 800, fontSize: roll ? "8pt" : "12pt" }}>{l.comp !== null ? $(l.comp) : ""}</div>
                )}
              </div>
            </div>
            </Page>
          ))}
        </div>
      </main>
    </>
  );
}

// The page box a roll label sits on, and nothing in sheet mode. The Avery
// layout is a CSS grid and an extra wrapper would break it out of the grid,
// so on that path this renders the label straight through.
function Page({ on, children }: { on: boolean; children: React.ReactNode }) {
  return on ? <div className="page">{children}</div> : <>{children}</>;
}
