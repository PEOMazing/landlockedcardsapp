"use client";
import { useEffect, useState } from "react";
import { toast } from "@/components/Toaster";

// Lock an inventory product to one exact TCGplayer product, either by typing
// its name or by pasting its link, then see exactly what was found before
// anything is saved. The look-up step is deliberately separate from the save:
// a wrong match quietly repricing a product is worse than an extra click, and
// the matched name is usually the only way to tell a 4-pack from a single tin.
//
// sl-v1. Name search came second but is now the default. Pasting links meant
// leaving the app, finding the product on TCGplayer and coming back, for every
// single row, which is why most of the sealed inventory was never mapped at
// all. The link box stays for the products no name search will ever get right
// - club exclusives, repackaged bundles, anything TCGplayer named differently
// than the rest of the world does.

type Match = {
  productId: number;
  groupName: string;
  productName: string;
  imageUrl: string;
  market: number | null;
  cleanUrl: string;
};

const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TcgMapper({
  id,
  name,
  currentUrl,
  mapped,
  onDone,
}: {
  id: string;
  name: string;
  currentUrl: string;
  mapped: boolean;
  onDone: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"name" | "link">("name");
  const [q, setQ] = useState(name || "");
  const [results, setResults] = useState<Match[] | null>(null);
  const [note, setNote] = useState("");
  const [url, setUrl] = useState(currentUrl || "");
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "lookup" | "search" | "save" | "remove">("");

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  function close() {
    setOpen(false);
    setMode("name");
    setQ(name || "");
    setResults(null);
    setNote("");
    setMatch(null);
    setError("");
    setBusy("");
    setUrl(currentUrl || "");
  }

  async function search() {
    setBusy("search");
    setError("");
    setNote("");
    setMatch(null);
    setResults(null);
    try {
      const r = await fetch("/api/inventory/tcg-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error || "Could not search for that.");
      else {
        setResults(d.matches || []);
        setNote(d.note || (d.truncated ? "Showing the closest 20. Add a word to narrow it." : ""));
      }
    } catch {
      setError("Could not reach the price mirror. Try again in a minute.");
    }
    setBusy("");
  }

  async function lookup() {
    setBusy("lookup");
    setError("");
    setNote("");
    setMatch(null);
    setResults(null);
    try {
      const r = await fetch("/api/inventory/tcg-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error || "Could not look that link up.");
      else setMatch(d.match);
    } catch {
      setError("Could not reach the price mirror. Try again in a minute.");
    }
    setBusy("");
  }

  // Picking a search result is the same thing as pasting its link: the chosen
  // product goes through the one save path, which re-resolves it server side.
  function pick(m: Match) {
    setMatch(m);
    setUrl(m.cleanUrl);
    setResults(null);
  }

  async function save() {
    setBusy("save");
    const r = await fetch(`/api/inventory/${id}/map`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) {
      setError(d.error || "Could not save that mapping.");
      return;
    }
    const priced = d.pricedNow ? `priced at ${money(d.match.market)}` : "no market price on TCGplayer yet";
    toast(d.renamedTo ? `Mapped, ${priced}, renamed to ${d.renamedTo}` : `Mapped, ${priced}`);
    close();
    await onDone();
  }

  async function remove() {
    if (!confirm(`Unlink ${name} from TCGplayer? Its last known market price stays put, but nightly refreshes will go back to matching it by name.`)) return;
    setBusy("remove");
    const r = await fetch(`/api/inventory/${id}/map`, { method: "DELETE" });
    setBusy("");
    if (!r.ok) { setError("Could not remove that mapping."); return; }
    toast("Mapping removed");
    close();
    await onDone();
  }

  return (
    <>
      <button
        className={`text-xs hover:underline whitespace-nowrap ${mapped ? "text-dim hover:text-body" : "text-givvy"}`}
        title={mapped ? "This product is locked to an exact TCGplayer product" : "Not mapped - the nightly refresh has to guess this one by name"}
        onClick={() => setOpen(true)}
      >
        {mapped ? "mapped" : "map"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="card w-full max-w-lg space-y-4 p-5">
            <div>
              <div className="label">Map to TCGplayer</div>
              <h2 className="t-section leading-tight">{name}</h2>
            </div>

            <div className="flex gap-1.5">
              {(["name", "link"] as const).map((m) => (
                <button
                  key={m}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    mode === m ? "border-foil bg-foil/10 text-foil" : "border-edge text-dim hover:text-body"
                  }`}
                  onClick={() => { setMode(m); setError(""); setNote(""); setMatch(null); setResults(null); }}
                >
                  {m === "name" ? "Search by name" : "Paste a link"}
                </button>
              ))}
            </div>

            {mode === "name" ? (
              <div>
                <label className="label" htmlFor={`tcg-q-${id}`}>Sealed product name</label>
                <div className="mt-1 flex gap-2">
                  <input
                    id={`tcg-q-${id}`}
                    className="input flex-1"
                    autoFocus
                    placeholder="Prismatic Evolutions Elite Trainer Box"
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) search(); }}
                  />
                  <button className="btn-foil !py-1.5 text-xs disabled:opacity-40" disabled={!!busy || !q.trim()} onClick={search}>
                    {busy === "search" ? "Searching..." : "Search"}
                  </button>
                </div>
                <p className="text-dim mt-1 t-meta">
                  Sealed product only. Include the set name - that is what narrows it down.
                </p>
              </div>
            ) : (
              <div>
                <label className="label" htmlFor={`tcg-url-${id}`}>TCGplayer product link</label>
                <input
                  id={`tcg-url-${id}`}
                  className="input mt-1"
                  autoFocus
                  placeholder="https://www.tcgplayer.com/product/662302/..."
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setMatch(null); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) lookup(); }}
                />
                <p className="text-dim mt-1 t-meta">
                  Open the product on TCGplayer and copy the address bar. Tracking junk on the end is fine, it gets trimmed.
                </p>
              </div>
            )}

            {error && <div className="text-bad rounded-lg border border-bad/40 bg-bad/10 p-2.5 text-xs">{error}</div>}
            {note && !error && <div className="text-dim t-meta">{note}</div>}

            {results && results.length > 0 && (
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {results.map((m) => (
                  <button
                    key={m.productId}
                    className="flex w-full items-center gap-3 rounded-lg border border-edge p-2 text-left hover:border-foil/60 hover:bg-foil/5"
                    onClick={() => pick(m)}
                  >
                    {m.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.imageUrl} alt="" width={40} height={40} className="rounded border border-edge object-contain" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium leading-snug">{m.productName}</span>
                      <span className="text-dim block truncate text-xs">{m.groupName}</span>
                    </span>
                    <span className="num whitespace-nowrap text-sm">
                      {m.market !== null ? <span className="text-foil font-semibold">{money(m.market)}</span> : <span className="text-dim text-xs">no price</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {match && (
              <div className="rounded-lg border border-foil/40 bg-foil/5 p-3">
                <div className="label mb-2">Is this the right product?</div>
                <div className="flex items-start gap-3">
                  {match.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={match.imageUrl} alt="" width={56} height={56} className="rounded border border-edge object-contain" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-snug">{match.productName}</div>
                    <div className="text-dim text-xs">{match.groupName}</div>
                    <div className="num mt-1 text-sm">
                      {match.market !== null
                        ? <span className="text-foil font-semibold">{money(match.market)} market</span>
                        : <span className="text-dim">No market price on TCGplayer yet</span>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {mapped && (
                  <button className="text-bad text-xs hover:underline disabled:opacity-40" disabled={!!busy} onClick={remove}>
                    {busy === "remove" ? "Removing..." : "Remove mapping"}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-ghost !py-1.5 text-xs" onClick={close}>Cancel</button>
                {match ? (
                  <button className="btn-foil !py-1.5 text-xs disabled:opacity-40" disabled={!!busy} onClick={save}>
                    {busy === "save" ? "Saving..." : "Save mapping"}
                  </button>
                ) : mode === "link" ? (
                  <button className="btn-foil !py-1.5 text-xs disabled:opacity-40" disabled={!!busy || !url.trim()} onClick={lookup}>
                    {busy === "lookup" ? "Looking up..." : "Look up"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
