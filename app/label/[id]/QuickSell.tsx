"use client";
import { useEffect, useState } from "react";
import { toast } from "@/components/Toaster";
import { JudgedSale, judgeSales } from "@/lib/salesWindow";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function QuickSell({ id, isManager, card }: {
  id: string;
  isManager: boolean;
  card: { cardNo?: string; name: string; setName: string; number: string; condition: string; printing: string; image: string; comp: number | null; market?: number | null; marketBasis?: string; sales?: { date: string; price: number; qty?: number }[]; compSource?: string; tcgProductId?: number | null; status: string; salePrice: number | null; location?: string };
}) {
  const [price, setPrice] = useState(card.comp !== null ? String(card.comp) : "");
  const [busy, setBusy] = useState(false);
  const [sold, setSold] = useState(card.status === "Sold");
  const [live, setLive] = useState<{ comp: number | null; market: number | null; marketBasis: string; sales: { date: string; price: number }[] } | null>(null);
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
        setLive({ comp: s.comp ?? null, market: s.market ?? null, marketBasis: s.marketBasis || "", sales: Array.isArray(s.compDetail) ? s.compDetail : [] });
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

  // TCGplayer's own page for this card, filtered to the condition in hand, so
  // the number on screen can be checked against the source in one tap rather
  // than retyping the card name into a phone at a table.
  const CONDITION_FULL: Record<string, string> = {
    NM: "Near Mint", Raw: "Near Mint", LP: "Lightly Played",
    MP: "Moderately Played", HP: "Heavily Played", DM: "Damaged",
  };

  const shown = {
    comp: live ? live.comp : card.comp,
    market: live ? live.market : (card.market ?? null),
    marketBasis: live ? live.marketBasis : (card.marketBasis || ""),
    sales: live ? live.sales : (card.sales || []),
  };

  // Same module the pricing uses, so the working shown here cannot disagree
  // with the number it is working out.
  const judged = judgeSales(shown.sales);
  const used = judged.filter((j) => j.used);
  const lastSale = judged[0] || null;

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

  const blindMarket = /any condition/i.test(shown.marketBasis);
  const tcgUrl = card.tcgProductId
    ? `https://www.tcgplayer.com/product/${card.tcgProductId}?Language=English${
        CONDITION_FULL[card.condition] ? `&Condition=${encodeURIComponent(CONDITION_FULL[card.condition])}` : ""
      }`
    : null;

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
            {/* The two reference numbers, side by side and big enough to read
                at arm's length. This is a phone screen being glanced at across
                a table mid-break, so the previous single line of 10px grey was
                technically correct and practically invisible.

                Both carry the condition they belong to. An unlabelled price
                here is worse than no price, because it gets trusted. */}
            {isManager && (shown.market != null || lastSale) && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-left">
                <Ref
                  label={blindMarket ? "Market, any cond." : `Lowest ${card.condition} listed`}
                  value={shown.market}
                  sub={shown.marketBasis.replace(/^.*?,\s*/, "") || undefined}
                  href={tcgUrl}
                  warn={blindMarket}
                />
                <Ref
                  label={`Last ${card.condition} sale`}
                  value={lastSale ? lastSale.price : null}
                  sub={lastSale ? lastSale.date : "no sales on record"}
                />
              </div>
            )}
            {isManager && judged.length > 0 && (
              <details className="mt-3 text-left group" open>
                <summary className="label !text-[10px] cursor-pointer select-none hover:text-body">
                  {used.length > 0
                    ? `Why ${$(shown.comp)} - ${used.length} ${card.condition} sale${used.length === 1 ? "" : "s"} in 30 days`
                    : `No ${card.condition} sale in 30 days`}
                </summary>
                <div className="mt-1.5 space-y-0.5">
                  {judged.slice(0, 8).map((j, i) => <SaleRow key={i} s={j} />)}
                  {judged.length > 8 && (
                    <div className="text-dim text-[10px] pt-0.5">+{judged.length - 8} older</div>
                  )}
                </div>
              </details>
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

// One reference number, labelled with what it actually is. Tapping through to
// TCGplayer matters more here than anywhere else in the app: this is the one
// screen where someone is about to name a price out loud.
function Ref({ label, value, sub, href, warn }: {
  label: string; value: number | null; sub?: string; href?: string | null; warn?: boolean;
}) {
  const body = (
    <>
      <div className={`label !text-[10px] ${warn ? "text-givvy" : ""}`}>{label}</div>
      <div className="num text-lg font-bold">{value != null ? $(value) : "-"}</div>
      {sub && <div className="text-dim text-[10px] leading-tight">{sub}</div>}
    </>
  );
  const cls = "rounded-lg border border-edge px-2.5 py-2 block";
  return href && value != null
    ? <a href={href} target="_blank" rel="noreferrer" className={`${cls} hover:border-foil/60 transition-colors`}>{body}</a>
    : <div className={cls}>{body}</div>;
}

// One sale, and whether it counted. Excluded sales are shown rather than
// hidden: "five sales, we used three" is a statement someone can check, and
// silently dropping the other two is how a price stops being explainable.
function SaleRow({ s }: { s: JudgedSale }) {
  const dim = !s.used;
  return (
    <div className={`flex items-baseline justify-between text-[11px] ${dim ? "text-dim opacity-60" : "text-body"}`}>
      <span className="tabular-nums">{s.date}</span>
      <span className="flex items-baseline gap-1.5">
        {s.excluded === "old" && <span className="text-[9px] uppercase tracking-wide">past 30d</span>}
        {s.excluded === "outlier" && <span className="text-[9px] uppercase tracking-wide text-givvy">outlier</span>}
        {s.isMedian && <span className="text-[9px] uppercase tracking-wide text-foil">median</span>}
        <span className={`num ${dim ? "line-through" : s.isMedian ? "font-bold text-foil" : ""}`}>{$(s.price)}</span>
      </span>
    </div>
  );
}
