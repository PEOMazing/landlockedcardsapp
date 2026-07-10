"use client";
import { useEffect, useMemo, useState } from "react";
import Thumb from "@/components/Thumb";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SetT = { id: string; name: string; series: string; releaseDate: string; total: number; symbol?: string };
type CardT = { id: string; name: string; number: string; rarity: string; image?: string; market: number | null };
export type Checklist = {
  setId: string;
  setName: string;
  pulled: Record<string, { winner: string }>;
};

// Character break panel. Attach a set to the stream, browse its checklist,
// and mark cards as they get pulled with the winner's name. Saves onto the
// stream's Checklist JSON field in the background, same optimistic pattern
// as the hit tracker.
export default function BreakChecklist({
  streamId,
  initial,
  locked,
}: {
  streamId: string;
  initial: Checklist | null;
  locked: boolean;
}) {
  const [sets, setSets] = useState<SetT[]>([]);
  const [setQ, setSetQ] = useState("");
  const [checklist, setChecklist] = useState<Checklist | null>(initial);
  const [cards, setCards] = useState<CardT[]>([]);
  const [cardQ, setCardQ] = useState("");
  const [loadingCards, setLoadingCards] = useState(false);
  const [onlyChase, setOnlyChase] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/pokemon/sets")
      .then((r) => r.json())
      .then((d) => setSets(d.sets || []))
      .catch(() => setErr("Could not load the set list"));
  }, []);

  useEffect(() => {
    if (!checklist?.setId) { setCards([]); return; }
    setLoadingCards(true);
    fetch(`/api/pokemon/cards?setId=${encodeURIComponent(checklist.setId)}`)
      .then((r) => r.json())
      .then((d) => setCards(d.cards || []))
      .catch(() => setErr("Could not load the checklist for this set"))
      .finally(() => setLoadingCards(false));
  }, [checklist?.setId]);

  function save(next: Checklist | null) {
    setChecklist(next);
    fetch(`/api/streams/${streamId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checklist: next }),
    });
  }

  function chooseSet(s: SetT) {
    save({ setId: s.id, setName: s.name, pulled: {} });
    setSetQ("");
  }

  function togglePulled(card: CardT) {
    if (!checklist || locked) return;
    const pulled = { ...checklist.pulled };
    if (pulled[card.id]) delete pulled[card.id];
    else pulled[card.id] = { winner: "" };
    save({ ...checklist, pulled });
  }

  function setWinner(cardId: string, winner: string) {
    if (!checklist || locked) return;
    save({ ...checklist, pulled: { ...checklist.pulled, [cardId]: { winner } } });
  }

  const filteredSets = useMemo(() => {
    const n = setQ.trim().toLowerCase();
    if (!n) return sets.slice(0, 10);
    return sets.filter((s) => s.name.toLowerCase().includes(n) || s.series.toLowerCase().includes(n)).slice(0, 10);
  }, [sets, setQ]);

  // "chase" view: the interesting cards - anything past common/uncommon
  const shownCards = useMemo(() => {
    const n = cardQ.trim().toLowerCase();
    let list = cards;
    if (onlyChase) {
      list = list.filter((c) => c.rarity && !/^(common|uncommon)$/i.test(c.rarity));
    }
    if (n) list = list.filter((c) => c.name.toLowerCase().includes(n) || c.number === n || (c.rarity || "").toLowerCase().includes(n));
    return list;
  }, [cards, cardQ, onlyChase]);

  const pulledCount = checklist ? Object.keys(checklist.pulled).length : 0;
  const pulledValue = checklist
    ? cards.filter((c) => checklist.pulled[c.id]).reduce((a, c) => a + (c.market || 0), 0)
    : 0;

  return (
    <section className="card p-5 space-y-4 border-foil/40">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="label">Character break checklist</h2>
        {checklist && (
          <div className="text-sm">
            <span className="text-foil font-bold">{checklist.setName}</span>
            <span className="text-dim ml-3">{pulledCount} pulled</span>
            {pulledValue > 0 && <span className="text-win ml-3 num font-bold">{$(pulledValue)} market</span>}
            {!locked && (
              <button className="text-bad text-xs hover:underline ml-4" onClick={() => save(null)}>change set</button>
            )}
          </div>
        )}
      </div>

      {err && <div className="text-bad text-sm">{err}</div>}

      {!checklist && (
        <div className="space-y-2">
          <p className="text-dim text-sm">
            Pick the set being broken. The full card checklist loads with live TCGplayer market prices, so
            everyone can see what is in the pool before spots go up.
          </p>
          <input
            className="input"
            placeholder='Search sets - try "Surging Sparks" or "151"'
            value={setQ}
            onChange={(e) => setSetQ(e.target.value)}
          />
          <div className="grid gap-1">
            {filteredSets.map((s) => (
              <button
                key={s.id}
                className="flex items-center gap-3 text-left rounded-lg border border-edge px-3 py-2 hover:border-foil/50"
                onClick={() => chooseSet(s)}
              >
                {s.symbol && <img src={s.symbol} alt="" className="w-5 h-5 object-contain" />}
                <span className="text-sm font-medium">{s.name}</span>
                <span className="text-dim text-xs ml-auto">{s.series} - {s.releaseDate} - {s.total} cards</span>
              </button>
            ))}
            {sets.length === 0 && <div className="text-dim text-sm">Loading sets...</div>}
          </div>
        </div>
      )}

      {checklist && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              className="input !w-64"
              placeholder="Filter cards by name, number, rarity"
              value={cardQ}
              onChange={(e) => setCardQ(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
              <input type="checkbox" checked={onlyChase} onChange={(e) => setOnlyChase(e.target.checked)} />
              Chase cards only (hide commons)
            </label>
            <span className="text-dim text-xs">{loadingCards ? "Loading checklist..." : `${shownCards.length} shown`}</span>
          </div>
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto border border-edge rounded-lg">
            <table className="w-full">
              <thead className="sticky top-0 bg-panel">
                <tr><th>Pulled</th><th>#</th><th>Card</th><th>Rarity</th><th>Market</th><th>Winner</th></tr>
              </thead>
              <tbody>
                {shownCards.map((c) => {
                  const hit = checklist.pulled[c.id];
                  return (
                    <tr key={c.id} className={hit ? "bg-foil/5" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!hit}
                          disabled={locked}
                          onChange={() => togglePulled(c)}
                        />
                      </td>
                      <td className="text-dim">{c.number}</td>
                      <td className="!font-medium">
                        <span className="inline-flex items-center gap-2">
                          {c.image && <Thumb src={c.image} size={28} />}
                          {c.name}
                        </span>
                      </td>
                      <td className="text-dim text-xs">{c.rarity}</td>
                      <td>{c.market !== null ? $(c.market) : <span className="text-dim">-</span>}</td>
                      <td>
                        {hit ? (
                          <input
                            className="input !w-36 !py-1 text-xs"
                            placeholder="Whatnot username"
                            defaultValue={hit.winner}
                            disabled={locked}
                            onBlur={(e) => setWinner(c.id, e.target.value.trim())}
                          />
                        ) : (
                          <span className="text-dim text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loadingCards && shownCards.length === 0 && (
                  <tr><td colSpan={6} className="text-dim">No cards match the filter</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-dim text-xs">
            Check a card the moment it gets ripped and drop in the winner&apos;s username. Everything saves
            automatically to this stream.
          </p>
        </>
      )}
    </section>
  );
}
