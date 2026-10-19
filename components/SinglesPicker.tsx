"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Thumb from "@/components/Thumb";
import { priceBound, inPriceRange, rangeBackwards } from "@/lib/priceRange";
import { isSlab } from "@/lib/slab";
import {
  matchesKind, needsRecheck, slabCompCold,
  SLAB_COMP_STALE_DAYS, type PickKind,
} from "@/lib/singlesPicker";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SingleT = {
  id: string; name: string; setName: string; number: string; condition: string;
  comp: number | null; image: string; qty: number; cardNo: number | null; slot: number | null;
  compDate: string;
};

const pad4 = (n: number | null) => (n === null || n === undefined ? "" : String(n).padStart(4, "0"));

// sp-v1. Staleness used to be one rule: not priced today. That is right for a
// raw card, whose price the nightly rotation owns, and wrong for a slab, whose
// price a person sets by hand and which the rotation deliberately never
// touches. Under one rule every slab read stale forever and the Recheck button
// offered to fix it could not, because the bulk endpoint refuses graded cards.
// The two rules now live in lib/singlesPicker, tested.

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
  kind: lockedKind,
}: {
  streamId: string;
  onAdded: () => Promise<void> | void;
  busy?: boolean;
  /** sp-v2. Which shelf this picker is showing, when the page above it already
   *  has a control for that - the Sealed / Singles / Graded buttons on a
   *  Surprise Set. Supplied means the picker drops its own toggle rather than
   *  putting a second set of the same buttons underneath the first. Left off,
   *  it shows its own, which is what a Single Stream gets: an auction list can
   *  hold raw cards and slabs together and there is nothing above it to choose. */
  kind?: PickKind;
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
  // sp-v1. Raw cards and slabs are two different shelves and a wheel usually
  // wants one or the other. 88 slabs in a list of 700 sleeved cards is not
  // findable, which is why adding a slab to a set felt impossible even though
  // nothing ever blocked it.
  const [ownKind, setOwnKind] = useState<PickKind>("all");
  const kind = lockedKind ?? ownKind;
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState<string>("");
  // Cards with an add already in the air. A ref rather than state because it
  // has to be true the instant a click handler runs: disabling the button is a
  // render away, and a fast double click gets both clicks in before that.
  const inFlight = useRef<Set<string>>(new Set());
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
  useEffect(() => { setShown(PAGE); }, [q, minP, maxP, sort, kind]);

  // The shelf being picked from. Everything below works off this rather than
  // the full inventory, so a slot number typed while Graded is selected finds
  // nothing instead of silently jumping back to the raw card that holds it.
  const pool = useMemo(() => items.filter((s) => matchesKind(s.condition, kind)), [items, kind]);

  // Everything the range allows, before the search box narrows it. The count
  // of this is what tells you whether a $10 to $25 wheel is even buildable.
  const inBand = useMemo(
    () => (priceOn ? pool.filter((s) => inPriceRange(s.comp, lo, hi)) : pool),
    [pool, lo, hi, priceOn]
  );

  const counts = useMemo(() => {
    let graded = 0;
    for (const s of items) if (isSlab(s.condition)) graded++;
    return { all: items.length, graded, raw: items.length - graded };
  }, [items]);

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
      const bySlot = pool.filter((s) => s.slot === asNo);
      if (bySlot.length) return bySlot;
      const byCardNo = pool.filter((s) => s.cardNo === asNo);
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
  }, [pool, inBand, q, priceOn, sort]);

  const filtered = useMemo(() => matches.slice(0, shown), [matches, shown]);
  const more = matches.length - filtered.length;

  // Cards in the current view whose comp was not checked today. Scoped to what
  // is on screen rather than the whole band, because rechecking 570 cards to
  // pick 20 is a lot of somebody else's API for no benefit - and because the
  // ones being looked at are the ones about to be chosen.
  const stale = useMemo(() => filtered.filter((s) => needsRecheck(s, new Date())), [filtered]);

  // Slabs on screen whose hand-set comp has gone cold. Separate from the above
  // because nothing in the app can re-price these automatically: the fix is to
  // open the card and run the slab comp tool, so this says that instead of
  // offering a button that would refuse them.
  const coldSlabs = useMemo(() => filtered.filter((s) => slabCompCold(s, new Date())), [filtered]);

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
    // Two clicks on the same card used to make two lines for one physical
    // card, which on a wheel is a slot that can be won twice. The server turns
    // the second one away now as well; this is so it never gets sent.
    if (inFlight.current.has(s.id)) return;
    inFlight.current.add(s.id);
    setAdding(s.id); setErr("");
    try {
      const res = await fetch(`/api/singles/${s.id}/to-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || "Could not add card");
      } else {
        // Drop the card from the list here rather than re-reading the whole
        // inventory. Building a 40-card wheel was pulling all 800-odd singles
        // back down after every single add, which is most of why adding felt
        // slow. The server has already taken the card out of stock; this is just
        // the screen agreeing with it.
        setItems((prev) => prev.filter((x) => x.id !== s.id));
        await onAdded();
      }
    } catch (e: any) {
      setErr(String(e?.message || e) || "Could not add card");
    } finally {
      inFlight.current.delete(s.id);
      setAdding("");
    }
  }

  return (
    <div className="space-y-2 border border-edge rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="label">
          {kind === "graded"
            ? `Add graded slabs from card inventory (${counts.graded} in stock)`
            : kind === "raw"
              ? `Add raw singles from card inventory (${counts.raw} in stock)`
              : "Add singles and slabs from card inventory"}
        </span>
        <Link href={kind === "graded" ? "/singles?mode=graded" : "/singles"} className="text-foil text-xs hover:underline">
          {kind === "graded" ? "Manage slabs" : "Manage singles"}
        </Link>
      </div>
      <input
        className="input"
        placeholder={
          kind === "graded"
            ? 'Search your slabs - "Charizard", a set, or a grade like "PSA 9"'
            : 'Search your singles - a slot number like 0068, or "Charizard"'
        }
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="flex items-center gap-2 text-xs flex-wrap">
        {/* sp-v1. Raw and graded are two shelves. A slab could always go on a
            set; it just could not be found in a list of 700 sleeved cards.
            Only drawn when nothing above has already made the choice. */}
        {!lockedKind && (
          <div className="flex items-center gap-1 rounded-lg border border-edge px-2 py-0.5">
            {([
              ["all", "all", counts.all],
              ["raw", "raw", counts.raw],
              ["graded", "slabs", counts.graded],
            ] as [PickKind, string, number][]).map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                className={kind === k ? "text-foil px-1" : "text-dim hover:text-body px-1"}
                onClick={() => setOwnKind(k)}
                title={
                  k === "graded"
                    ? "Graded cards in cases. These go on a wheel exactly like a raw card."
                    : k === "raw"
                      ? "Sleeved cards with a binder pocket"
                      : "Everything in stock"
                }
              >
                {label} <span className="num opacity-60">{n}</span>
              </button>
            ))}
          </div>
        )}

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
      {/* sp-v1. Slabs get told, not offered a button. Nothing here can re-price
          a graded card: the nightly rotation skips them and the bulk endpoint
          answers "graded comps are manual" for every one. The fix is to open
          the card and paste sold rows into the slab comp tool, so say that. */}
      {coldSlabs.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-edge px-2 py-1.5 text-xs">
          <span className="text-dim">
            <span className="num">{coldSlabs.length}</span> slab{coldSlabs.length === 1 ? "" : "s"} shown
            {coldSlabs.length === 1 ? " was" : " were"} last priced over {SLAB_COMP_STALE_DAYS} days ago
          </span>
          <Link href="/singles?mode=graded" className="text-foil hover:underline">
            price them on the Singles page
          </Link>
          <span className="text-dim">graded comps are set by hand, so adding one does not re-price it</span>
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
              <div className="text-dim text-xs truncate flex items-center gap-1.5">
                {/* The grade reads as a chip rather than trailing text, so a
                    slab is obvious at a glance in a mixed list. */}
                {isSlab(s.condition) && (
                  <span className="rounded border border-foil/50 bg-foil/10 text-foil px-1 shrink-0">
                    {s.condition}
                  </span>
                )}
                <span className="truncate">
                  {s.setName}{s.number ? ` #${s.number}` : ""}
                  {isSlab(s.condition) ? "" : ` - ${s.condition}`}
                </span>
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
            {kind === "graded" && counts.graded === 0
              ? <>No slabs in stock. Add graded cards on the <Link href="/singles" className="text-foil hover:underline">Singles</Link> page first.</>
              : priceOn
                ? `No in-stock ${kind === "graded" ? "slabs" : kind === "raw" ? "raw singles" : "singles"} in this price range. Widen it or clear it to see the rest.`
                : <>No in-stock {kind === "graded" ? "slabs" : "singles"} match. Add cards on the <Link href="/singles" className="text-foil hover:underline">Singles</Link> page first.</>}
          </div>
        )}
      </div>
    </div>
  );
}
