"use client";
import { useState } from "react";
import { toast } from "@/components/Toaster";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function QuickSell({ id, isManager, card }: {
  id: string;
  isManager: boolean;
  card: { name: string; setName: string; number: string; condition: string; printing: string; image: string; comp: number | null; status: string; salePrice: number | null; location?: string };
}) {
  const [price, setPrice] = useState(card.comp !== null ? String(card.comp) : "");
  const [busy, setBusy] = useState(false);
  const [sold, setSold] = useState(card.status === "Sold");

  async function sell() {
    const v = parseFloat(price);
    if (isNaN(v) || v <= 0) { toast("Enter the sale price first", "bad"); return; }
    setBusy(true);
    const r = await fetch(`/api/singles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salePrice: v, status: "Sold" }),
    });
    setBusy(false);
    if (r.ok) { setSold(true); toast(`Sold for ${$(v)}`); }
    else toast((await r.json()).error || "Could not mark sold", "bad");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 gap-4">
      <div className="font-bold text-lg" style={{ fontFamily: "var(--font-display)" }}>
        LandLocked <span className="holo-text">Cards</span>
      </div>
      <div className="card p-6 w-full max-w-sm text-center space-y-4">
        {card.image && <img src={card.image} alt="" className="h-48 mx-auto rounded-lg" style={{ boxShadow: "0 12px 40px rgba(122,162,255,.25)" }} />}
        <div>
          <div className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{card.name}</div>
          <div className="text-dim text-sm">
            {card.setName}{card.number ? ` #${card.number}` : ""}
            {card.printing && <span className="ml-1.5 text-[10px] text-foil border border-foil/40 rounded px-1 py-px align-middle">{card.printing}</span>}
          </div>
          <div className="text-dim text-sm">{card.condition}{card.location ? <span className="ml-2 font-bold text-foil">#{card.location}</span> : null}</div>
        </div>
        {card.comp !== null && (
          <div>
            <div className="label">Listed at</div>
            <div className="num text-3xl font-bold holo-text inline-block">{$(card.comp)}</div>
          </div>
        )}
        {sold ? (
          <div className="text-win font-bold text-lg">{"\u2713"} Sold</div>
        ) : isManager ? (
          <div className="space-y-2">
            <input
              type="number" step="0.01" inputMode="decimal"
              className="input text-center text-xl !py-3 w-40 mx-auto"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Sale $"
            />
            <button className="btn-foil w-full !py-3 text-lg disabled:opacity-40" disabled={busy} onClick={sell}>
              {busy ? "Booking..." : "Mark sold"}
            </button>
            <a href="/singles" className="block text-dim text-xs hover:text-body">open full singles page</a>
          </div>
        ) : (
          <div className="text-dim text-sm">Available now - ask at the table to purchase</div>
        )}
      </div>
    </main>
  );
}
