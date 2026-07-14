"use client";
import { useEffect, useRef, useState } from "react";
import { classifyCollectrCsv } from "@/lib/collectr";

// CSV importer for Collectr exports (and similar files). Parses locally,
// splits rows into sealed vs singles by whether a card number is present,
// lets the user pick which portfolios to bring in, then uploads in chunks.

type Parsed = {
  portfolios: Record<string, { sealed: any[]; singles: any[] }>;
  skipped: number;
};


export default function CollectrImport({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState("");
  const [err, setErr] = useState("");
  const [showStart, setShowStart] = useState(false);
  const [code, setCode] = useState<{ code: string; email: string } | null>(null);
  function loadCode() {
    if (code) return;
    fetch("/api/import/code").then((r) => r.json()).then((d) => d.code && setCode(d)).catch(() => {});
  }
  function copy(text: string) {
    navigator.clipboard?.writeText(text);
  }

  function handleFile(f: File) {
    setErr(""); setSummary(""); setParsed(null);
    const reader = new FileReader();
    reader.onload = () => {
      const c = classifyCollectrCsv(String(reader.result || ""));
      if (Object.keys(c.portfolios).length === 0) { setErr("No importable rows found - is this a Collectr export?"); return; }
      setParsed({ portfolios: c.portfolios, skipped: c.skipped + c.nonPokemon });
      if (c.nonPokemon > 0) setSummary(`${c.nonPokemon} non-Pokemon rows set aside - One Piece support is coming`);
      const init: Record<string, boolean> = {};
      for (const k of Object.keys(c.portfolios)) init[k] = true;
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
    let sc = 0, sm = 0, sg = 0, sk = 0;
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
      sc += d.sealedCreated; sm += d.sealedMerged; sg += d.singlesCreated; sk += d.sealedSkipped || 0;
      done++;
      setProgress(`Importing... ${done}/${total}`);
    };
    try {
      for (let i = 0; i < sealed.length; i += CHUNK) await send({ sealed: sealed.slice(i, i + CHUNK) });
      for (let i = 0; i < singles.length; i += CHUNK) await send({ singles: singles.slice(i, i + CHUNK) });
      setSummary(`Done: ${sg} cards imported${sc + sm > 0 ? `, ${sc} sealed created, ${sm} sealed merged` : ""}${sk > 0 ? `. ${sk} sealed products set aside - collector sealed tracking is coming` : ""}.`);
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
      <button className="btn-ghost" onClick={() => { setShowStart(true); loadCode(); }}>Import from Collectr</button>
      {err && <span className="text-bad text-xs ml-2">{err}</span>}
      {summary && <span className="text-win text-xs ml-2">{summary}</span>}
      {progress && <span className="text-dim text-xs ml-2">{progress}</span>}

      {showStart && !parsed && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowStart(false)}>
          <div className="card p-5 space-y-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="label">Import your Collectr portfolio</h2>
            <div className="rounded-lg border border-foil/40 p-3 space-y-2">
              <div className="font-semibold text-sm">Easiest on your phone: email it</div>
              <ol className="text-dim text-xs space-y-1 list-decimal list-inside">
                <li>In Collectr, open your portfolio and choose Export</li>
                <li>Send the export email to:</li>
              </ol>
              <button className="w-full text-left font-mono text-sm border border-edge rounded-lg px-3 py-2 hover:border-foil" onClick={() => copy("import@cardquarters.com")}>
                import@cardquarters.com <span className="text-dim text-[10px] float-right mt-0.5">tap to copy</span>
              </button>
              <p className="text-dim text-xs">
                Send it from <b>{code?.email || "your account email"}</b> and it imports automatically.
                Sending from a different email? Put your code in the subject:
              </p>
              <button className="w-full text-left font-mono text-sm border border-edge rounded-lg px-3 py-2 hover:border-foil" onClick={() => code && copy(code.code)}>
                {code?.code || "..."} <span className="text-dim text-[10px] float-right mt-0.5">tap to copy</span>
              </button>
              <p className="text-dim text-[11px]">Your cards appear in your collection within a couple of minutes of sending.</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-px bg-edge flex-1" />
              <span className="text-dim text-xs">or</span>
              <div className="h-px bg-edge flex-1" />
            </div>
            <button className="btn-ghost w-full" onClick={() => { setShowStart(false); fileRef.current?.click(); }}>
              Upload the CSV file instead
            </button>
          </div>
        </div>
      )}

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
