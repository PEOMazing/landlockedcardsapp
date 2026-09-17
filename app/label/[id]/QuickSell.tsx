"use client";
import { useEffect, useState } from "react";
import { toast } from "@/components/Toaster";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function QuickSell({ id, isManager, card }: {
  id: string;
  isManager: boolean;
  card: { cardNo?: string; name: string; setName: string; number: string; condition: string; printing: string; image: string; comp: number | null; market?: number | null; marketBasis?: string; lastSale?: { date: string; price: number } | null; status: string; salePrice: number | null; location?: string };
}) {
  const [price, setPrice] = useState(card.comp !== null ? String(card.comp) : "");
  const [busy, setBusy] = useState(false);
  const [sold, setSold] = useState(card.status === "Sold");
  const [live, setLive] = useState<{ comp: number | null; market: number | null; marketBasis: string; lastSale: { date: string; price: number } | null } | null>(null);
  const [pricing, setPricing] = useState(false);

  // Scanning a sticker is the moment the price gets acted on, so it gets a
  // live pull rather than whatever the rolling refresh last wrote.
  //
  // The page renders the stored price first and swaps in the live one when it
  // lands: someone standing at a table with a phone should never be looking at
  // a spinner where a number should be. Managers only - a customer scanning a
  // sticker does not need to trigger an upstream call, and making that
  // reachable by anyone with the URL is how you get rate-limited.
  useEffect(() => {
    if (!isManager || sold) return;
    let cancelled = false;
    (async () => {
      setPricing(true);
      try {
        const r = await fetch(`/api/singles/${id}/comp`, { method: "POST" });
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const s = d.single;
        if (!s || cancelled) return;
        setLive({ comp: s.comp ?? null, market: s.market ?? null, marketBasis: s.marketBasis || "", lastSale: s.lastSale ?? null });
        // Only move the input if it is still showing the price we put there.
        // Overwriting a number somebody has started typing would be maddening.
        setPrice((cur) => (cur === (card.comp !== null ? String(card.comp) : "") && s.comp !== null ? String(s.comp) : cur));
      } catch {
        // stored price stays on screen, which is the correct fallback
      } finally {
        if (!cancelled) setPricing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isManager, sold, card.comp]);

  const shown = {
    comp: live ? live.comp : card.comp,
    market: live ? live.market : (card.market ?? null),
    marketBasis: live ? live.marketBasis : (card.marketBasis || ""),
    lastSale: live ? live.lastSale : (card.lastSale ?? null),
  };

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
          <div className="text-dim text-sm">{card.cardNo ? <span className="mr-2 font-bold text-foil num">{card.cardNo}</span> : null}<a href="/conditions" target="_blank" className="underline decoration-dotted underline-offset-2 hover:text-foil">{card.condition}</a>{card.location ? <span className="ml-2 text-dim">{card.location}</span> : null}</div>
        </div>
        {shown.comp !== null && (
          <div>
            <div className="label">
              Listed at
              {pricing && <span className="ml-1.5 text-dim normal-case">checking live...</span>}
              {live && !pricing && <span className="ml-1.5 text-win normal-case">live</span>}
            </div>
            <div className="num text-3xl font-bold holo-text inline-block">{$(shown.comp)}</div>
            {/* This is the screen someone reads while deciding what to take
                for a card, so both reference numbers are spelled out with the
                condition they belong to. An unlabelled price here is worse
                than no price: it gets trusted. */}
            {(shown.market != null || shown.lastSale) && (
              <div className="text-dim text-xs mt-1 flex items-center justify-center gap-3 flex-wrap">
                {shown.market != null && (
                  <span title={shown.marketBasis || "lowest live TCGplayer listing"}>
                    {/any condition/i.test(shown.marketBasis)
                      ? <>market <span className="num">{$(shown.market)}</span> <span className="opacity-60">any cond.</span></>
                      : <>TCG low {card.condition} <span className="num">{$(shown.market)}</span></>}
                  </span>
                )}
                {shown.lastSale && (
                  <span>last {card.condition} sale <span className="num">{$(shown.lastSale.price)}</span> <span className="opacity-70">{shown.lastSale.date}</span></span>
                )}
              </div>
            )}
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
