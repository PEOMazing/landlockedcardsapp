"use client";
import { useRef, useState } from "react";

// CSV importer for Collectr exports (and similar files). Parses locally,
// splits rows into sealed vs singles by whether a card number is present,
// lets the user pick which portfolios to bring in, then uploads in chunks.

type Parsed = {
  portfolios: Record<string, { sealed: any[]; singles: any[] }>;
  skipped: number;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const money = (v: string) => {
  const n = parseFloat(String(v || "").replace(/[$,]/g, ""));
  return isNaN(n) || n <= 0 ? undefined : Math.round(n * 100) / 100;
};

function mapCondition(grade: string, cardCondition: string): string {
  const g = String(grade || "").toUpperCase();
  if (g && !g.startsWith("UNGRADED")) {
    if (g.startsWith("PSA 10")) return "PSA 10";
    if (g.startsWith("PSA 9")) return "PSA 9";
    if (g.startsWith("PSA 8")) return "PSA 8";
    if (g.startsWith("CGC 10")) return "CGC 10";
    if (g.startsWith("CGC 9.5")) return "CGC 9.5";
    if (g.startsWith("BGS 9.5")) return "BGS 9.5";
    return "Other";
  }
  const c = String(cardCondition || "").toLowerCase();
  if (c.includes("light")) return "LP";
  if (c.includes("moderate")) return "MP";
  if (c.includes("heav")) return "HP";
  if (c.includes("damag")) return "DM";
  return "NM";
}

export default function CollectrImport({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState("");
  const [err, setErr] = useState("");

  function handleFile(f: File) {
    setErr(""); setSummary(""); setParsed(null);
    const reader = new FileReader();
    reader.onload = () => {
      const grid = parseCsv(String(reader.result || ""));
      if (grid.length < 2) { setErr("No data rows found in that file"); return; }
      const header = grid[0].map((h) => h.trim());
      const col = (want: string[]) => header.findIndex((h) => want.some((w) => h.toLowerCase().startsWith(w)));
      const iName = col(["product name", "card name", "name"]);
      const iQty = col(["quantity", "qty"]);
      if (iName < 0) { setErr("Could not find a Product Name column"); return; }
      const iPortfolio = col(["portfolio"]);
      const iSet = col(["set"]);
      const iNumber = col(["card number", "number"]);
      const iRarity = col(["rarity"]);
      const iGrade = col(["grade"]);
      const iCond = col(["card condition", "condition"]);
      const iBuy = col(["average cost paid", "cost paid", "buy price", "cost", "price paid"]);
      const iMarket = col(["market price", "market value"]);
      const iNotes = col(["notes"]);
      const iAdded = col(["date added"]);

      const portfolios: Parsed["portfolios"] = {};
      let skipped = 0;
      for (const r of grid.slice(1)) {
        const name = (r[iName] || "").trim();
        if (!name) { skipped++; continue; }
        const pf = iPortfolio >= 0 ? (r[iPortfolio] || "").trim() || "default" : "default";
        if (!portfolios[pf]) portfolios[pf] = { sealed: [], singles: [] };
        const qty = Math.max(1, parseInt(r[iQty]) || 1);
        const buy = iBuy >= 0 ? money(r[iBuy]) : undefined;
        const market = iMarket >= 0 ? money(r[iMarket]) : undefined;
        const number = iNumber >= 0 ? (r[iNumber] || "").trim() : "";
        if (number) {
          portfolios[pf].singles.push({
            name, qty, buy, comp: market, number,
            setName: iSet >= 0 ? (r[iSet] || "").trim() : "",
            rarity: iRarity >= 0 ? (r[iRarity] || "").trim() : "",
            condition: mapCondition(iGrade >= 0 ? r[iGrade] : "", iCond >= 0 ? r[iCond] : ""),
            notes: iNotes >= 0 ? (r[iNotes] || "").trim() : "",
            dateAdded: iAdded >= 0 ? (r[iAdded] || "").trim() : "",
          });
        } else {
          portfolios[pf].sealed.push({ name, qty, buy, market });
        }
      }
      setParsed({ portfolios, skipped });
      const init: Record<string, boolean> = {};
      for (const k of Object.keys(portfolios)) init[k] = true;
      setChecked(init);
    };
    reader.readAsText(f);
  }

  async function runImport() {
    if (!parsed) return;
    const sealed: any[] = [], singles: any[] = [];
    for (const [pf, data] of Object.entries(parsed.portfolios)) {
      if (!checked[pf]) continue;
      sealed.push(...data.sealed);
      singles.push(...data.singles);
    }
    if (sealed.length + singles.length === 0) { setErr("Nothing selected"); return; }
    setErr("");
    let sc = 0, sm = 0, sg = 0;
    const CHUNK = 60;
    const total = Math.ceil(sealed.length / CHUNK) + Math.ceil(singles.length / CHUNK);
    let done = 0;
    const send = async (body: any) => {
      const r = await fetch("/api/import/collectr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Import failed");
      const d = await r.json();
      sc += d.sealedCreated; sm += d.sealedMerged; sg += d.singlesCreated;
      done++;
      setProgress(`Importing... ${done}/${total}`);
    };
    try {
      for (let i = 0; i < sealed.length; i += CHUNK) await send({ sealed: sealed.slice(i, i + CHUNK) });
      for (let i = 0; i < singles.length; i += CHUNK) await send({ singles: singles.slice(i, i + CHUNK) });
      setSummary(`Done: ${sc} sealed created, ${sm} sealed merged into existing, ${sg} singles created.`);
      setParsed(null);
      setProgress("");
      onDone();
    } catch (e: any) {
      setErr(e.message); setProgress("");
    }
  }

  return (
    <div className="inline-block">
      <input
        ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <button className="btn-ghost" onClick={() => fileRef.current?.click()}>Import CSV</button>
      {err && <span className="text-bad text-xs ml-2">{err}</span>}
      {summary && <span className="text-win text-xs ml-2">{summary}</span>}
      {progress && <span className="text-dim text-xs ml-2">{progress}</span>}

      {parsed && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setParsed(null)}>
          <div className="card p-5 space-y-4 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="label">Import from Collectr</h2>
            <p className="text-dim text-xs">
              Rows with a card number become singles; the rest become sealed inventory. Sealed products
              that already exist merge quantities instead of duplicating. Pick which portfolios to import:
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {Object.entries(parsed.portfolios).map(([pf, data]) => (
                <label key={pf} className="flex items-center gap-3 rounded-lg border border-edge px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!checked[pf]}
                    onChange={(e) => setChecked({ ...checked, [pf]: e.target.checked })}
                  />
                  <span className="text-sm font-medium">{pf}</span>
                  <span className="text-dim text-xs ml-auto">
                    {data.sealed.length > 0 && `${data.sealed.length} sealed`}
                    {data.sealed.length > 0 && data.singles.length > 0 && " - "}
                    {data.singles.length > 0 && `${data.singles.length} singles`}
                  </span>
                </label>
              ))}
            </div>
            {parsed.skipped > 0 && <p className="text-dim text-xs">{parsed.skipped} empty rows skipped</p>}
            <div className="flex gap-3">
              <button className="btn-foil disabled:opacity-40" disabled={!!progress} onClick={runImport}>
                {progress || "Import selected"}
              </button>
              <button className="btn-ghost" onClick={() => setParsed(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
