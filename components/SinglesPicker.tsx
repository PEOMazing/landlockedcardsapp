"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Thumb from "@/components/Thumb";
import { priceBound, inPriceRange, rangeBackwards } from "@/lib/priceRange";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SingleT = {
  id: string; name: string; setName: string; number: string; condition: string;
  comp: number | null; image: string; qty: number; cardNo: number | null; slot: number | null;
  compDate: string;
};

const pad4 = (n: number | null) => (n === null || n === undefined ? "" : String(n).padStart(4, "0"));

const today = () => new Date().toISOString().slice(0, 10);

// A comp is stale unless it was checked today. Deliberately strict: a wheel is
// built off these numbers and then the spot value and the streamer's pay are
// built off the wheel, so "close enough" compounds three times.
const isStale = (s: SingleT) => String(s.compDate || "").slice(0, 10) !== today();

// The bulk recomp endpoint caps a call at 60 cards.
const RECHECK_CHUNK = 60;

// How many rows to draw before asking. The old cap was 12, which quietly turned
// a working price filter into a broken-looking one: "570 in stock in this
// range, showing 12", every one of them at the top of the band, so a $1-$6
// search looked like it had only found $6 cards. A page big enough to show the
// spread, and a button for the rest.
const PAGE = 40;

// Search the singles card inventory and drop cards onto a show set - a Single
// Stream's auction list or a Surprise Set's wheel. Every add snapshots the comp
// as the line's market price so spot math and pay work exactly like sealed.
export default function SinglesPicker({
  streamId,
  onAdded,
  busy,
}: {
  streamId: string;
  onAdded: () => Promise<void> | void;
  busy?: boolean;
}) {
  const [items, setItems] = useState<SingleT[]>([]);
  const [q, setQ] = useState("");
  // Building a wheel usually starts from a price point, not a card name: show
  // me everything from $10 to $25 and let me pick. Either end works alone.
  const [minP, setMinP] = useState("");
  const [maxP, setMaxP] = useState("");
  // Price order finds the value; slot order matches the binder, so a pull walks
  // the pockets front to back instead of jumping around.
  const [sort, setSort] = useState<"price" | "slot">("price");
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState<string>("");
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(0);
  const [checked, setChecked] = useState("");

  async function loadStock() {
    const r = await fetch("/api/singles?status=In Stock");
    const d = await r.json();
    setItems(d.singles || []);
  }
  useEffect(() => { loadStock(); }, []);

  const lo = useMemo(() => priceBound(minP), [minP]);
  const hi = useMemo(() => priceBound(maxP), [maxP]);
  const priceOn = lo !== null || hi !== null;

  // Changing what you are looking for starts the list again from the top,
  // otherwise a wide page from the last search hangs around over the new one.
  useEffect(() => { setShown(PAGE); }, [q, minP, maxP, sort]);

  // Everything the range allows, before the search box narrows it. The count
  // of this is what tells you whether a $10 to $25 wheel is even buildable.
  const inBand = useMemo(
    () => (priceOn ? items.filter((s) => inPriceRange(s.comp, lo, hi)) : items),
    [items, lo, hi, priceOn]
  );

  // Every card the current search and range allow, in order. Paging happens
  // after this, so the count shown is the real one and not the page size.
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();

    // A number typed in the box is a card in someone's hand. The big number on
    // the sticker is the binder slot, so that is what gets matched first; the
    // permanent Card No prints small under the QR and still works. Either one
    // beats the price range, because asking for one card by number is not a
    // question about price.
    const asNo = /^#?\d{1,5}$/.test(n) ? parseInt(n.replace("#", ""), 10) : null;
    if (asNo !== null) {
      const bySlot = items.filter((s) => s.slot === asNo);
      if (bySlot.length) return bySlot;
      const byCardNo = items.filter((s) => s.cardNo === asNo);
      if (byCardNo.length) return byCardNo;
    }

    const list = n
      ? inBand.filter((s) =>
          s.name.toLowerCase().includes(n) ||
          s.setName.toLowerCase().includes(n) ||
          s.condition.toLowerCase().includes(n) ||
          s.number === n
        )
      : [...inBand];

    // No range and no search is just the inventory, newest first, as before.
    if (!priceOn && !n) return list;

    return sort === "slot"
      ? list.sort((a, b) => (a.slot ?? Number.MAX_SAFE_INTEGER) - (b.slot ?? Number.MAX_SAFE_INTEGER))
      : list.sort((a, b) => (b.comp ?? 0) - (a.comp ?? 0));
  }, [items, inBand, q, priceOn, sort]);

  const filtered = useMemo(() => matches.slice(0, shown), [matches, shown]);
  const more = matches.length - filtered.length;

  // Cards in the current view whose comp was not checked today. Scoped to what
  // is on screen rather than the whole band, because rechecking 570 cards to
  // pick 20 is a lot of somebody else's API for no benefit - and because the
  // ones being looked at are the ones about to be chosen.
  const stale = useMemo(() => filtered.filter(isStale), [filtered]);

  // Re-price what is on screen, then reload so the range re-filters on the new
  // numbers. A card that moves out of the band disappears, which is the point.
  async function recheck() {
    const ids = stale.map((s) => s.id);
    if (ids.length === 0) return;
    setErr(""); setChecked(""); setChecking(ids.length);
    try {
      for (let i = 0; i < ids.length; i += RECHECK_CHUNK) {
        const res = await fetch("/api/singles/comps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: ids.slice(i, i + RECHECK_CHUNK) }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `recheck failed (${res.status})`);
        }
      }
      await loadStock();
      setChecked(`Rechecked ${ids.length} card${ids.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
    setChecking(0);
  }

  async function add(s: SingleT) {
    setAdding(s.id); setErr("");
    const res = await fetch(`/api/singles/${s.id}/to-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId }),
    });
    if (!res.ok) {
      const d = await res.json();
      setErr(d.error || "Could not add card");
    } else {
      await Promise.all([onAdded(), loadStock()]);
    }
    setAdding("");
  }

  return (
    <div className="space-y-2 border border-edge rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="label">Add singles from card inventory</span>
        <Link href="/singles" className="text-foil text-xs hover:underline">Manage singles</Link>
      </div>
      <input
        className="input"
        placeholder='Search your singles - a slot number like 0068, or "Charizard"'
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <div
          className={`flex items-center gap-1 rounded-lg border px-2 py-0.5 ${priceOn ? "border-foil/60 bg-foil/10" : "border-edge"}`}
          title="Comp price range. Either box works on its own, and both ends count as in range."
        >
          <span className={priceOn ? "text-foil" : "text-dim"}>$</span>
          <input
            className="input !w-16 !px-1.5 !py-1 num"
            inputMode="decimal"
            placeholder="min"
            value={minP}
            onChange={(e) => setMinP(e.target.value)}
          />
          <span className="text-dim">to</span>
          <input
            className="input !w-16 !px-1.5 !py-1 num"
            inputMode="decimal"
            placeholder="max"
            value={maxP}
            onChange={(e) => setMaxP(e.target.value)}
          />
          {(minP || maxP) && (
            <button
              type="button"
              className="text-dim hover:text-body px-1"
              onClick={() => { setMinP(""); setMaxP(""); }}
              title="Clear the price range"
            >
              x
            </button>
          )}
        </div>

        {(priceOn || q.trim()) && (
          <div className="flex items-center gap-1 rounded-lg border border-edge px-2 py-0.5">
            <span className="text-dim">sort</span>
            <button
              type="button"
              className={sort === "price" ? "text-foil px-1" : "text-dim hover:text-body px-1"}
              onClick={() => setSort("price")}
              title="Dearest first, for hitting a value target"
            >
              price
            </button>
            <button
              type="button"
              className={sort === "slot" ? "text-foil px-1" : "text-dim hover:text-body px-1"}
              onClick={() => setSort("slot")}
              title="Binder order, so pulling the cards walks the pockets front to back"
            >
              slot
            </button>
          </div>
        )}

        {rangeBackwards(lo, hi) ? (
          <span className="text-bad">Min is above max</span>
        ) : priceOn ? (
          <span className="text-dim">
            <span className="num">{inBand.length}</span> in stock in this range
            {more > 0 ? <>, showing <span className="num">{filtered.length}</span></> : ""}
          </span>
        ) : more > 0 ? (
          <span className="text-dim">
            showing <span className="num">{filtered.length}</span> of <span className="num">{matches.length}</span>
          </span>
        ) : null}
      </div>
      {/* Stale prices are the one thing that must not pass quietly here. The
          add itself re-prices the card live, so a line never snapshots a stale
          number - but the wheel gets built by eye off this list, and picking
          from last week's prices picks the wrong cards. */}
      {stale.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-warn/50 bg-warn/10 px-2 py-1.5 text-xs">
          <span className="text-warn">
            <span className="num">{stale.length}</span> of the{" "}
            <span className="num">{filtered.length}</span> shown were last priced before today
          </span>
          <button
            type="button"
            className="btn-foil !px-3 !py-1 text-xs disabled:opacity-40"
            disabled={checking > 0 || busy}
            onClick={recheck}
          >
            {checking > 0 ? `Rechecking ${checking}...` : `Recheck ${stale.length}`}
          </button>
          <span className="text-dim">adding a card always re-prices it anyway</span>
        </div>
      )}
      {checked && <div className="text-win text-xs">{checked}</div>}
      {err && <div className="text-bad text-xs">{err}</div>}
      <div className="grid gap-1">
        {filtered.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-lg border border-edge px-3 py-2">
            {s.image && <Thumb src={s.image} size={28} className="shrink-0" />}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {/* The binder slot, which is the big number on the sticker and
                    the number you are holding when you go to find the card.
                    A card with no slot yet falls back to its Card No rather
                    than showing nothing. */}
                {s.slot !== null && s.slot !== undefined ? (
                  <span className="num text-dim mr-1.5" title="Binder slot">{pad4(s.slot)}</span>
                ) : s.cardNo !== null && s.cardNo !== undefined ? (
                  <span className="num text-dim/60 mr-1.5" title="No binder slot yet - this is the Card No">
                    {pad4(s.cardNo)}
                  </span>
                ) : null}
                {s.name}
              </div>
              <div className="text-dim text-xs truncate">
                {s.setName}{s.number ? ` #${s.number}` : ""} - {s.condition}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3 shrink-0">
              <span className="num text-sm">{s.comp !== null ? $(s.comp) : "no comp"}</span>
              <button
                className="btn-foil !px-3 !py-1 text-xs disabled:opacity-40"
                disabled={busy || adding === s.id}
                onClick={() => add(s)}
              >
                {adding === s.id ? "Adding..." : "Add"}
              </button>
            </div>
          </div>
        ))}
        {more > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className="btn !px-3 !py-1 text-xs"
              onClick={() => setShown((n) => n + PAGE)}
            >
              Show {Math.min(PAGE, more)} more
            </button>
            {more > PAGE && (
              <button
                type="button"
                className="text-dim hover:text-body text-xs underline"
                onClick={() => setShown(matches.length)}
              >
                show all {matches.length}
              </button>
            )}
          </div>
        )}
        {filtered.length === 0 && (
          <div className="text-dim text-sm">
            {priceOn
              ? "No in-stock singles in this price range. Widen it or clear it to see the rest."
              : <>No in-stock singles match. Add cards on the <Link href="/singles" className="text-foil hover:underline">Singles</Link> page first.</>}
          </div>
        )}
      </div>
    </div>
  );
}
