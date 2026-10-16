"use client";
import { useEffect, useState } from "react";
import { toast } from "@/components/Toaster";
import { JudgedSale, isThinComp, judgeSales } from "@/lib/salesWindow";
import { oddLowAsk } from "@/lib/tcgListings";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function QuickSell({ id, isManager, isSlab = false, card }: {
  id: string;
  isManager: boolean;
  /** sl-v4. This sticker is on a slab case, not a sleeve. */
  isSlab?: boolean;
  card: { cardNo?: string; name: string; setName: string; number: string; condition: string; printing: string; image: string; comp: number | null; market?: number | null; marketBasis?: string; sales?: { date: string; price: number; qty?: number }[]; listings?: number[]; compSource?: string; compSales?: number | null; tcgProductId?: number | null; status: string; salePrice: number | null; location?: string };
}) {
  const [price, setPrice] = useState(card.comp !== null ? String(card.comp) : "");
  const [busy, setBusy] = useState(false);
  const [sold, setSold] = useState(card.status === "Sold");
  const [live, setLive] = useState<{ comp: number | null; market: number | null; marketBasis: string; sales: { date: string; price: number }[]; compSales: number | null } | null>(null);
  const [pricing, setPricing] = useState(false);

  // Scanning a sticker is the moment the price gets acted on, so it gets a
  // live pull rather than whatever the rolling refresh last wrote.
  //
  // The page renders the stored price first and swaps in the live one when it
  // lands: someone standing at a table with a phone should never be looking at
  // a spinner where a number should be. Managers only - a customer scanning a
  // sticker does not need to trigger an upstream call, and making that
  // reachable by anyone with the URL is how you get rate-limited.
  // sl-v4. Not on a slab. This calls the raw pipeline, which prices off the
  // TCGplayer feed - a feed with no grade dimension, so it would answer a PSA
  // 10 with NM-raw money. A slab reprices on the button below instead, which
  // is also why it is a button: each one is a metered eBay sold-listings call,
  // where this is a cached lookup that costs nothing to fire on every scan.
  useEffect(() => {
    if (!isManager || sold || isSlab) return;
    let cancelled = false;
    (async () => {
      setPricing(true);
      try {
        const r = await fetch(`/api/singles/${id}/comp`, { method: "POST" });
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const s = d.single;
        if (!s || cancelled) return;
        setLive({ comp: s.comp ?? null, market: s.market ?? null, marketBasis: s.marketBasis || "", sales: Array.isArray(s.compDetail) ? s.compDetail : [], compSales: typeof s.compSales === "number" ? s.compSales : null });
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
  }, [id, isManager, sold, isSlab, card.comp]);

  // sl-v4. Reprice a slab from eBay sold prices, on demand.
  //
  // A button rather than an automatic pull on scan, for two reasons that point
  // the same way. One eBay call per card against a metered quota is not
  // something to spend every time a sticker is scanned, and a slab's price
  // does not move the way a raw card's does - these are $50 to $9,000 cards
  // whose comps rest on a handful of sales, so repricing is a thing you choose
  // to do while holding the card, not a thing that happens at you.
  //
  // No sales leaves the existing comp alone and says so, which matters more
  // here than anywhere: a hand-researched number on a four figure slab must
  // never be silently replaced with a blank.
  const [slabBusy, setSlabBusy] = useState(false);
  const [slabNote, setSlabNote] = useState("");
  async function recompSlab() {
    setSlabBusy(true);
    setSlabNote("");
    try {
      const r = await fetch("/api/singles/slab-comp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setSlabNote(d?.error || `Could not reprice (${r.status})`); return; }
      if (!d.ok) { setSlabNote(d.reason || "No matching sales, price unchanged"); return; }
      setLive({
        comp: d.comp ?? null,
        market: null,
        marketBasis: d.source || "",
        sales: Array.isArray(d.used) ? d.used.map((s: any) => ({ date: s.date, price: s.price })) : [],
        compSales: typeof d.sampleSize === "number" ? d.sampleSize : null,
      });
      setPrice((cur) => (cur === (card.comp !== null ? String(card.comp) : "") && d.comp != null ? String(d.comp) : cur));
      // Said on screen rather than in a toast that slides away: somebody is
      // holding the card and deciding whether to trust the number.
      setSlabNote(
        d.stale
          ? `No sales in 30 days. Priced off the last one, ${d.asOf}.`
          : `${$(d.comp)} from ${d.sampleSize} sale${d.sampleSize === 1 ? "" : "s"}${d.dropped?.length ? `, ${d.dropped.length} low set aside` : ""}`,
      );
    } catch {
      setSlabNote("Could not reach the pricing service");
    } finally {
      setSlabBusy(false);
    }
  }

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
    // the live pull can change how many sales are behind the price, so the
    // confidence note has to follow the number it describes
    compSales: live ? live.compSales : (card.compSales ?? null),
  };

  // Same module the pricing uses, so the working shown here cannot disagree
  // with the number it is working out.
  const judged = judgeSales(shown.sales);
  const lastSale = judged[0] || null;

  // The cheapest live asks for this exact condition, and whether the cheapest
  // one is far enough below the rest to deserve a look before it gets quoted.
  const asks = card.listings || [];
  const oddLow = oddLowAsk(asks);

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
        {card.image ? (
          <img src={card.image} alt="" className="h-48 mx-auto rounded-lg" style={{ boxShadow: "0 12px 40px rgba(122,162,255,.25)" }} />
        ) : (
          // Some cards have no art on TCGplayer to find - mostly old Japanese
          // vending sets. Rendering nothing left a gap that reads as a broken
          // page to whoever just scanned the sticker, so the card shape stays
          // and says what it is holding instead of pretending there is nothing.
          <div
            className="h-48 mx-auto rounded-lg flex flex-col items-center justify-center text-center px-3 gap-1"
            style={{ width: "8.6rem", border: "1px dashed rgba(122,162,255,.35)", background: "rgba(122,162,255,.06)" }}
          >
            <div className="t-meta font-bold leading-tight">{card.name}</div>
            <div className="text-dim t-meta leading-tight">{card.setName}</div>
            {card.number && <div className="text-dim t-meta num">#{card.number}</div>}
            <div className="text-dim t-meta mt-s1 opacity-70">no art on file</div>
          </div>
        )}
        <div>
          <div className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{card.name}</div>
          <div className="text-dim text-sm">
            {card.setName}{card.number ? ` #${card.number}` : ""}
            {card.printing && <span className="ml-1.5 t-meta text-foil border border-foil/40 rounded px-1 py-px align-middle">{card.printing}</span>}
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
            {/* Said where the price is said. This is the screen someone reads
                a number off out loud at a table, so if the number is standing
                on one sale that is the moment to know, not later in a
                spreadsheet. Managers only: it is a note about our own
                confidence, not something a customer needs. */}
            {isManager && isThinComp(shown.compSales) && (
              <div className="text-givvy t-meta mt-1 leading-snug">
                {shown.compSales === 0
                  ? "No sales behind this - priced off live asks"
                  : `Only ${shown.compSales} sale${shown.compSales === 1 ? "" : "s"} in 30 days behind this`}
              </div>
            )}
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
                  warn={blindMarket || oddLow}
                />
                <Ref
                  label={`Last ${card.condition} sale`}
                  value={lastSale ? lastSale.price : null}
                  sub={lastSale ? lastSale.date : "no sales on record"}
                />
              </div>
            )}
            {/* Closed by default, but still here. The spread is the only thing
                that catches a graded slab listed against the raw card, so it
                stays one tap away rather than being taken out - and it opens
                itself when the cheapest ask looks wrong, which is the moment
                it actually earns the space. */}
            {isManager && asks.length > 1 && (
              <details className="mt-3 text-left" open={oddLow}>
                <summary className="label !t-meta cursor-pointer select-none hover:text-body">
                  Live {card.condition} Asks:
                  {oddLow && <span className="ml-1.5 text-givvy normal-case">check the cheapest one</span>}
                </summary>
                {/* Shown rather than filtered. A graded slab listed against the
                    raw card carries no marker in the feed, and price alone
                    cannot separate one from a real bargain - trimming the
                    cheapest ask moved 14 of 98 cards in this collection, some
                    by 10x. One glance at the spread does what no rule could,
                    so this opens by default: a $70 sitting under four asks at
                    $95-$100 is obvious to a person and invisible to a filter. */}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {asks.map((p, i) => (
                    <span key={i} className={`num t-meta rounded px-1.5 py-0.5 border ${
                      i === 0 && oddLow ? "border-givvy/60 text-givvy"
                        : i === 0 ? "border-foil/50 text-foil"
                        : "border-edge text-dim"
                    }`}>{$(p)}</span>
                  ))}
                </div>
              </details>
            )}
            {isManager && judged.length > 0 && (
              <details className="mt-3 text-left group" open>
                <summary className="label !t-meta cursor-pointer select-none hover:text-body">
                  TCG Sales History:
                </summary>
                <div className="mt-1.5 space-y-0.5">
                  {judged.slice(0, 8).map((j, i) => <SaleRow key={i} s={j} />)}
                  {judged.length > 8 && (
                    <div className="text-dim t-meta pt-0.5">+{judged.length - 8} older</div>
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
            {/* sl-v4. Slabs only, and above the sale price on purpose: the
                order of operations at a table is price it, then sell it, and
                a button that reprices sitting under the one that books the
                sale invites doing those backwards. */}
            {isSlab && (
              <div className="space-y-1">
                <button
                  className="btn-ghost w-full !py-2.5 disabled:opacity-40"
                  disabled={slabBusy}
                  onClick={recompSlab}
                  title="Pull this slab's recent eBay sales for its exact grade and reprice from the median"
                >
                  {slabBusy ? "Checking eBay..." : "Recomp from eBay"}
                </button>
                {slabNote && (
                  <div className="t-meta text-dim leading-snug px-1">{slabNote}</div>
                )}
              </div>
            )}
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
        {/* The card on TCGplayer, for anyone who scans.
            Deep-linked to this exact printing and condition, so it lands on
            the same thing the sticker is describing rather than the product's
            front page. Public on purpose: someone holding the card wants to
            check the number for themselves, and a price that only holds while
            nobody looks is not a price worth quoting. */}
        {tcgUrl && (
          <a
            href={tcgUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border border-edge px-3 py-2.5 text-sm hover:border-foil/60 hover:text-foil transition-colors"
          >
            View on TCGplayer
            <span className="block text-dim t-meta mt-0.5 normal-case">
              {card.printing || "this printing"} · {card.condition}
            </span>
          </a>
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
      <div className={`label !t-meta ${warn ? "text-givvy" : ""}`}>{label}</div>
      <div className="num text-lg font-bold">{value != null ? $(value) : "-"}</div>
      {sub && <div className="text-dim t-meta leading-tight">{sub}</div>}
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
    <div className={`flex items-baseline justify-between t-meta ${dim ? "text-dim opacity-60" : "text-body"}`}>
      <span className="tabular-nums">{s.date}</span>
      <span className="flex items-baseline gap-1.5">
        {s.excluded === "old" && <span className="label">past 30d</span>}
        {s.excluded === "outlier" && <span className="label !text-givvy">outlier</span>}
        {s.isMedian && <span className="label !text-foil">median</span>}
        <span className={`num ${dim ? "line-through" : s.isMedian ? "font-bold text-foil" : ""}`}>{$(s.price)}</span>
      </span>
    </div>
  );
}
