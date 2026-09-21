"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { SignedIn } from "@clerk/nextjs";
import {
  groupCards, matchesQuery, sortGroups, formatNos, formatPrice, displayName, isGraded,
  type ShowCard, type ShowSort,
} from "@/lib/showCatalog";
import { priceBound, inPriceRange } from "@/lib/priceRange";

// How many tiles go on screen at a time. The full list is already in memory,
// so this is not about fetching - it keeps the page light on a phone by only
// building the tiles someone has actually scrolled to.
const PAGE = 48;

type Kind = "all" | "raw" | "graded";

export default function ShowClient({ cards, failed }: { cards: ShowCard[]; failed: boolean }) {
  const [q, setQ] = useState("");
  const [set, setSet] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<ShowSort>("az");
  const [minP, setMinP] = useState("");
  const [maxP, setMaxP] = useState("");
  const [shown, setShown] = useState(PAGE);

  // Typing stays smooth even on an old phone: the box updates at once and the
  // grid catches up a beat later instead of on every keystroke.
  const dq = useDeferredValue(q);

  const groups = useMemo(() => groupCards(cards), [cards]);
  const totalCards = useMemo(() => groups.reduce((a, g) => a + g.count, 0), [groups]);

  // Every set with stock in it, A to Z, each with how many cards are in it.
  const sets = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) m.set(g.first.set, (m.get(g.first.set) || 0) + g.count);
    return Array.from(m.entries()).filter(([s]) => s).sort((a, b) => a[0].localeCompare(b[0]));
  }, [groups]);

  const lo = priceBound(minP);
  const hi = priceBound(maxP);

  const results = useMemo(() => {
    const list = groups.filter(
      (g) =>
        (!set || g.first.set === set) &&
        (kind === "all" || (kind === "graded") === isGraded(g.first.cond)) &&
        inPriceRange(g.first.price, lo, hi) &&
        matchesQuery(g, dq)
    );
    return sortGroups(list, sort);
  }, [groups, set, kind, lo, hi, dq, sort]);

  // any change of filter starts the grid back at the top
  useEffect(() => { setShown(PAGE); }, [set, kind, lo, hi, dq, sort]);

  // Build more tiles as the bottom comes into view. The observer is rebuilt
  // after every batch on purpose: an observer only reports changes, so if the
  // marker is still on screen after a batch lands (a tall screen, a fast
  // flick) it would never fire again. A fresh one reports where it stands.
  const sentinel = useRef<HTMLDivElement>(null);
  const more = shown < results.length;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, more, results]);

  const resultCards = useMemo(() => results.reduce((a, g) => a + g.count, 0), [results]);
  const filtering = !!(dq.trim() || set || kind !== "all" || lo !== null || hi !== null);

  function clearAll() {
    setQ(""); setSet(""); setKind("all"); setMinP(""); setMaxP("");
  }

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-edge bg-ink/95 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-3 sm:px-5 py-3 space-y-2.5">
          <div className="flex items-center gap-3">
            <div className="font-bold text-lg tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
              LandLocked <span className="text-foil">Cards</span>
            </div>
            <div className="text-dim text-xs num hidden sm:block">
              {totalCards.toLocaleString()} cards in stock
            </div>
            <SignedIn>
              <a href="/singles" className="ml-auto text-xs text-dim hover:text-foil">Back to app</a>
            </SignedIn>
          </div>
          <input
            className="input w-full !text-base"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            placeholder='Search a Pokemon, a set, or a sticker number'
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search cards"
          />
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 text-xs [scrollbar-width:none]">
            <select className="input !w-auto !py-1.5 !text-xs max-w-[46vw]" value={set} onChange={(e) => setSet(e.target.value)} aria-label="Set">
              <option value="">All sets</option>
              {sets.map(([s, n]) => (
                <option key={s} value={s}>{s} ({n})</option>
              ))}
            </select>
            <div className="inline-flex shrink-0 rounded-lg border border-edge overflow-hidden">
              {([["all", "All"], ["raw", "Raw"], ["graded", "Graded"]] as [Kind, string][]).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={`px-2.5 py-1.5 ${kind === k ? "bg-foil/15 text-foil font-semibold" : "text-dim"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={`flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-0.5 ${lo !== null || hi !== null ? "border-foil/60" : "border-edge"}`}>
              <span className="text-dim">$</span>
              <input className="input !w-14 !px-1.5 !py-1 !text-xs num" inputMode="decimal" placeholder="min" value={minP} onChange={(e) => setMinP(e.target.value)} aria-label="Minimum price" />
              <span className="text-dim">to</span>
              <input className="input !w-14 !px-1.5 !py-1 !text-xs num" inputMode="decimal" placeholder="max" value={maxP} onChange={(e) => setMaxP(e.target.value)} aria-label="Maximum price" />
            </div>
            <select className="input !w-auto !py-1.5 !text-xs shrink-0" value={sort} onChange={(e) => setSort(e.target.value as ShowSort)} aria-label="Sort">
              <option value="az">A to Z</option>
              <option value="priceDesc">Price high to low</option>
              <option value="priceAsc">Price low to high</option>
              <option value="no">Sticker number</option>
            </select>
            {filtering && (
              <button type="button" className="shrink-0 text-dim hover:text-body underline underline-offset-2 px-1" onClick={clearAll}>
                Clear
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-3 sm:px-5 py-4">
        {failed ? (
          <div className="card p-6 text-center text-dim">
            The card list could not be loaded right now. Give it a moment and refresh.
          </div>
        ) : (
          <>
            <div className="text-dim text-xs mb-3 num">
              {filtering
                ? `${resultCards.toLocaleString()} card${resultCards === 1 ? "" : "s"} match`
                : `${totalCards.toLocaleString()} cards in stock`}
            </div>
            {results.length === 0 ? (
              <div className="card p-8 text-center text-dim">
                Nothing in stock matches that.{" "}
                <button type="button" className="text-foil underline underline-offset-2" onClick={clearAll}>Show everything</button>
              </div>
            ) : (
              <div className="grid gap-2.5 sm:gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                {results.slice(0, shown).map((g, i) => (
                  <a
                    key={g.key}
                    href={`/label/${g.first.id}`}
                    className="card overflow-hidden flex flex-col hover:border-foil/60 transition-colors"
                  >
                    <div className="relative aspect-square bg-white/[0.03]">
                      {g.first.img ? (
                        // Plain img, lazy below the first rows, with its size
                        // fixed up front so the grid never jumps as art arrives.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={g.first.img}
                          alt={g.first.name}
                          width={200}
                          height={200}
                          loading={i < 12 ? "eager" : "lazy"}
                          decoding="async"
                          className="absolute inset-0 h-full w-full object-contain p-1.5"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-dim text-xs">No image</div>
                      )}
                      {g.count > 1 && (
                        <span className="absolute top-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-bold num">{g.count} available</span>
                      )}
                      {(isGraded(g.first.cond) || g.first.lang) && (
                        <span className="absolute top-1.5 left-1.5 flex gap-1">
                          {isGraded(g.first.cond) && <span className="rounded-md bg-foil/90 px-1.5 py-0.5 text-[10px] font-bold text-black">{g.first.cond}</span>}
                          {g.first.lang && <span className="rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-bold">{g.first.lang === "Japanese" ? "JP" : g.first.lang}</span>}
                        </span>
                      )}
                    </div>
                    <div className="p-2 flex flex-col gap-0.5 flex-1">
                      <div className="text-[13px] font-semibold leading-tight line-clamp-2">{displayName(g.first.name)}</div>
                      <div className="text-dim text-[11px] leading-tight truncate">
                        {g.first.set}{g.first.num ? ` #${g.first.num}` : ""}
                      </div>
                      {!isGraded(g.first.cond) && g.first.cond && g.first.cond !== "NM" && (
                        <div className="text-dim text-[11px]">{g.first.cond}</div>
                      )}
                      <div className="mt-auto pt-1.5 flex items-end justify-between gap-2">
                        <span className="num text-[11px] text-dim leading-tight">{formatNos(g.nos, 2)}</span>
                        <span className={`num font-bold leading-none ${g.first.price !== null ? "text-foil text-base" : "text-dim text-sm"}`}>
                          {formatPrice(g.first.price)}
                        </span>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
            {more && <div ref={sentinel} className="h-10" />}
          </>
        )}
      </div>
    </main>
  );
}
