"use client";
import { useEffect, useState } from "react";
import { toast } from "@/components/Toaster";

// Paste a TCGplayer product link, see exactly what it points at, then lock the
// product to it. The look-up step is deliberately separate from the save: a
// wrong link quietly repricing a product is worse than an extra click, and the
// matched name is usually the only way to tell a 4-pack from a single tin.

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
  const [url, setUrl] = useState(currentUrl || "");
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "lookup" | "save" | "remove">("");

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  function close() {
    setOpen(false);
    setMatch(null);
    setError("");
    setBusy("");
    setUrl(currentUrl || "");
  }

  async function lookup() {
    setBusy("lookup");
    setError("");
    setMatch(null);
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
              <h2 className="text-lg font-semibold leading-tight">{name}</h2>
            </div>

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
              <p className="text-dim mt-1 text-[11px]">
                Open the product on TCGplayer and copy the address bar. Tracking junk on the end is fine, it gets trimmed.
              </p>
            </div>

            {error && <div className="text-bad rounded-lg border border-bad/40 bg-bad/10 p-2.5 text-xs">{error}</div>}

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
                {!match ? (
                  <button className="btn-foil !py-1.5 text-xs disabled:opacity-40" disabled={!!busy || !url.trim()} onClick={lookup}>
                    {busy === "lookup" ? "Looking up..." : "Look up"}
                  </button>
                ) : (
                  <button className="btn-foil !py-1.5 text-xs disabled:opacity-40" disabled={!!busy} onClick={save}>
                    {busy === "save" ? "Saving..." : "Save mapping"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
