"use client";
import { useState } from "react";
import { toast } from "@/components/Toaster";

// Pull the real TCGplayer name for every mapped product and show it against the
// name you are carrying. Nothing is renamed until you tick it, because some of
// your shorthand is deliberate and only you know which.

type Row = { id: string; current: string; proposed: string; changed: boolean };

export default function TcgNameSync({ onDone }: { onDone: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mappedCount, setMappedCount] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "load" | "apply">("");

  async function load() {
    setBusy("load");
    setError("");
    setOpen(true);
    try {
      const r = await fetch("/api/admin/tcg-names");
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Could not read names from TCGplayer.");
      } else {
        const changed: Row[] = (d.rows || []).filter((x: Row) => x.changed);
        setRows(changed);
        setMappedCount(d.mappedCount || 0);
        setPicked(new Set(changed.map((x) => x.id))); // all on by default
      }
    } catch {
      setError("Could not reach the price mirror. Try again in a minute.");
    }
    setBusy("");
  }

  async function apply() {
    setBusy("apply");
    const r = await fetch("/api/admin/tcg-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(picked) }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) { setError(d.error || "Rename failed."); return; }
    toast(`Renamed ${d.renamed} ${d.renamed === 1 ? "product" : "products"}`);
    setOpen(false);
    setRows([]);
    await onDone();
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  return (
    <>
      <button
        className="btn-ghost !py-1.5 text-xs disabled:opacity-40"
        disabled={busy === "load"}
        title="Compare every mapped product against the name TCGplayer gives it"
        onClick={load}
      >
        {busy === "load" ? "Checking..." : "Fix names"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="card my-8 w-full max-w-3xl space-y-4 p-5">
            <div>
              <div className="label">Names from TCGplayer</div>
              <h2 className="text-lg font-semibold leading-tight">
                {busy === "load" ? "Reading names..." : `${rows.length} of ${mappedCount} mapped products differ`}
              </h2>
              <p className="text-dim mt-1 text-xs">
                Renaming keeps the old name on the product, so a show set pasted from memory still finds it.
                Past streams keep the name they were built with.
              </p>
            </div>

            {error && <div className="text-bad rounded-lg border border-bad/40 bg-bad/10 p-2.5 text-xs">{error}</div>}

            {busy !== "load" && rows.length === 0 && !error && (
              <div className="text-dim text-sm">
                Every mapped product already matches its TCGplayer name. Map more products to check more of them.
              </div>
            )}

            {rows.length > 0 && (
              <>
                <div className="flex items-center gap-3 text-xs">
                  <button className="text-foil hover:underline" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>
                    Select all
                  </button>
                  <button className="text-dim hover:text-body" onClick={() => setPicked(new Set())}>
                    Select none
                  </button>
                  <span className="text-dim ml-auto num">{picked.size} selected</span>
                </div>

                <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
                  {rows.map((r) => (
                    <label
                      key={r.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 transition-colors ${
                        picked.has(r.id) ? "border-foil/40 bg-foil/5" : "border-edge"
                      }`}
                    >
                      <input type="checkbox" className="mt-1" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                      <div className="min-w-0 flex-1 text-sm leading-snug">
                        <div className="text-dim line-through">{r.current}</div>
                        <div className="font-medium">{r.proposed}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            <div className="flex items-center justify-end gap-2">
              <button className="btn-ghost !py-1.5 text-xs" onClick={() => setOpen(false)}>Cancel</button>
              {rows.length > 0 && (
                <button
                  className="btn-foil !py-1.5 text-xs disabled:opacity-40"
                  disabled={!!busy || picked.size === 0}
                  onClick={apply}
                >
                  {busy === "apply" ? "Renaming..." : `Rename ${picked.size}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
