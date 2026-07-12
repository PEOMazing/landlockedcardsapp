"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/Toaster";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SetT = { id: string; name: string; series: string; releaseDate: string; total: number; symbol?: string; logo?: string };
type CardT = { id: string; name: string; number: string; rarity: string; image?: string; imageLarge?: string; market: number | null; printings?: { label: string; market: number | null }[] };

const PRINTING_ORDER = ["1st Edition", "Shadowless", "Unlimited"];

// Browse every Pokemon set and its full card checklist with TCGplayer market
// prices. This is the planning tool for character breaks: check what is in a
// set before committing product to a show.
export default function SetsClient() {
  const [sets, setSets] = useState<SetT[]>([]);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<SetT | null>(null);
  const [customSets, setCustomSets] = useState<{ id: string; name: string; query: string }[]>([]);
  const [newPokemon, setNewPokemon] = useState("");
  const [creating, setCreating] = useState(false);

  function loadCustomSets() {
    fetch("/api/custom-sets").then((r) => r.json()).then((d) => setCustomSets(d.customSets || [])).catch(() => {});
  }

  async function createCustomSet() {
    const q = newPokemon.trim();
    if (!q) return;
    setCreating(true);
    const r = await fetch("/api/custom-sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    });
    setCreating(false);
    if (r.ok) {
      const d = await r.json();
      setNewPokemon("");
      loadCustomSets();
      toast(`Created ${d.name}`);
      setActive({ id: `custom:${d.query}`, name: d.name } as any);
    } else {
      toast((await r.json()).error || "Could not create master set", "bad");
    }
  }

  async function deleteCustomSet(id: string, name: string) {
    if (!confirm(`Delete "${name}"? Your cards are untouched - this only removes the saved master set.`)) return;
    const r = await fetch(`/api/custom-sets/${id}`, { method: "DELETE" });
    if (r.ok) { loadCustomSets(); toast("Master set deleted"); }
  }
  const [cards, setCards] = useState<CardT[]>([]);
  const [loading, setLoading] = useState(false);
  const [cardQ, setCardQ] = useState("");
  const [onlyChase, setOnlyChase] = useState(false);
  const [ownFilter, setOwnFilter] = useState<"all" | "owned" | "missing">("all");
  const [printing, setPrinting] = useState<string>("");
  const [adding, setAdding] = useState<string>("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [owned, setOwned] = useState<Map<string, number> | null>(null);
  const [err, setErr] = useState("");

  // key that survives the different data sources: normalized name + card number numerator
  function ownKey(name: string, number: string): string {
    const n = String(name).toLowerCase().replace(/\s*-\s*[\w]+\/[\w]+\s*$/, "").replace(/[^a-z0-9]/g, "");
    let num = String(number).split("/")[0].trim().toLowerCase();
    if (/^\d+$/.test(num)) num = String(parseInt(num));
    return `${n}#${num}`;
  }

  function loadOwned() {
    fetch("/api/singles")
      .then((r) => r.json())
      .then((d) => {
        const map = new Map<string, number>();
        for (const sg of d.singles || []) {
          if (sg.status === "Sold") continue;
          const key = ownKey(sg.name, sg.number || "");
          map.set(key, (map.get(key) || 0) + (sg.qty || 1));
        }
        setOwned(map);
      })
      .catch(() => setOwned(new Map()));
  }
  useEffect(() => { loadOwned(); loadCustomSets(); }, []);

  const ownedQty = (c: CardT) => (owned ? owned.get(ownKey(c.name, c.number)) || 0 : 0);

  useEffect(() => {
    fetch("/api/pokemon/sets")
      .then((r) => r.json())
      .then((d) => (d.sets ? setSets(d.sets) : setErr(d.error || "Could not load sets")))
      .catch(() => setErr("Could not load sets"));
  }, []);

  useEffect(() => {
    if (!active) return;
    setLoading(true); setCards([]); setCardQ(""); setPrinting(""); setAdded(new Set());
    loadOwned();
    fetch(active.id.startsWith("custom:")
      ? `/api/pokemon/cards?nameQuery=${encodeURIComponent(active.id.slice(7))}`
      : `/api/pokemon/cards?setId=${encodeURIComponent(active.id)}`)
      .then((r) => r.json())
      .then((d) => (d.cards ? setCards(d.cards) : setErr(d.error || "Could not load cards")))
      .catch(() => setErr("Could not load cards"))
      .finally(() => setLoading(false));
  }, [active]);

  const filteredSets = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return sets;
    return sets.filter((s) => s.name.toLowerCase().includes(n) || s.series.toLowerCase().includes(n));
  }, [sets, q]);

  const shownCards = useMemo(() => {
    let list = cards;
    if (onlyChase) list = list.filter((c) => c.rarity && !/^(common|uncommon)$/i.test(c.rarity));
    if (ownFilter === "owned") list = list.filter((c) => ownedQty(c) > 0);
    if (ownFilter === "missing") list = list.filter((c) => ownedQty(c) === 0);
    const n = cardQ.trim().toLowerCase();
    if (n) list = list.filter((c) => c.name.toLowerCase().includes(n) || c.number === n || (c.rarity || "").toLowerCase().includes(n));
    return list;
  }, [cards, cardQ, onlyChase, ownFilter, owned]);

  const masteryOwned = useMemo(() => cards.filter((c) => ownedQty(c) > 0).length, [cards, owned]);

  const setPrintings = useMemo(() => {
    const labels = new Set<string>();
    for (const c of cards) for (const pr of c.printings || []) labels.add(pr.label);
    return [...labels].sort((a, b) => PRINTING_ORDER.indexOf(a) - PRINTING_ORDER.indexOf(b));
  }, [cards]);
  const hasPrintings = setPrintings.length >= 2;
  const activePrinting = hasPrintings
    ? (printing && setPrintings.includes(printing) ? printing : setPrintings.includes("Unlimited") ? "Unlimited" : setPrintings[0])
    : "";

  const priceFor = (c: CardT): number | null => {
    if (!hasPrintings) return c.market;
    const hit = (c.printings || []).find((pr) => pr.label === activePrinting);
    return hit ? hit.market : null;
  };

  const setValue = cards.reduce((a, c) => a + (priceFor(c) || 0), 0);
  const pricedCount = cards.filter((c) => priceFor(c) !== null).length;

  function exportSetCsv() {
    if (!active || cards.length === 0) return;
    const esc = (v: any) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const header = ["Card", "Number", "Rarity", hasPrintings ? `Price (${activePrinting})` : "Price", "Owned Qty"];
    const rows = shownCards.map((c) => [c.name, c.number, c.rarity, priceFor(c) ?? "", ownedQty(c)]);
    const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${active.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-checklist.csv`;
    a.click();
  }

  async function quickAdd(c: CardT) {
    setAdding(c.id);
    const body: Record<string, any> = { cardId: c.id, condition: "Raw" };
    const pr = hasPrintings ? (c.printings || []).find((x) => x.label === activePrinting) : null;
    if (pr && pr.market !== null) {
      body.printing = activePrinting;
      body.comp = pr.market;
      body.compSource = `TCGplayer ${activePrinting} (Set Lists)`;
    }
    const r = await fetch("/api/singles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setAdding("");
    if (r.ok) {
      setAdded((prev) => new Set(prev).add(c.id));
      setOwned((prev) => {
        const next = new Map(prev || []);
        const key = ownKey(c.name, c.number);
        next.set(key, (next.get(key) || 0) + 1);
        return next;
      });
      toast(`Added ${c.name}${body.printing ? ` (${body.printing})` : ""} to Singles`);
    } else {
      toast((await r.json()).error || "Could not add card", "bad");
    }
  }

  if (active) {
    return (
      <main className="max-w-6xl mx-auto p-6 space-y-5">
        <button className="text-dim text-sm hover:text-body" onClick={() => setActive(null)}>&larr; All sets</button>
        <div className="flex items-center gap-4 flex-wrap">
          {active.logo && <img src={active.logo} alt="" className="h-10 object-contain" />}
          <div>
            <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{active.name}</h1>
            <div className="text-dim text-sm">
              {active.series} - released {active.releaseDate} - {active.total} cards
              {setValue > 0 && (
                <span className="text-foil ml-2 num">
                  {hasPrintings ? `${activePrinting} checklist market` : "full checklist market"} {$(setValue)}
                  {hasPrintings && <span className="text-dim"> ({pricedCount} priced)</span>}
                </span>
              )}
            </div>
          </div>
        </div>
        {hasPrintings && !loading && (
          <p className="text-dim text-xs">
            1st Edition, Shadowless and Unlimited are priced separately here from TCGplayer listings, because the single pokemontcg.io market price cannot say which printing it belongs to.
          </p>
        )}
        {!loading && cards.length > 0 && owned && (
          <div className="card p-4 space-y-2">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <span className="label">Set mastery</span>
              <span className="text-sm num">
                <span className="text-win font-bold">{masteryOwned}</span>
                <span className="text-dim"> of {cards.length} cards owned - </span>
                <span className="holo-text font-bold">{Math.round((masteryOwned / cards.length) * 100)}%</span>
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-edge overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(masteryOwned / cards.length) * 100}%`, background: "linear-gradient(90deg, #58e6d9, #7aa2ff, #c084fc)" }}
              />
            </div>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <input className="input !w-64" placeholder="Filter cards" value={cardQ} onChange={(e) => setCardQ(e.target.value)} />
          {hasPrintings && (
            <div className="flex rounded-lg border border-foil/40 overflow-hidden text-sm">
              {setPrintings.map((pl) => (
                <button
                  key={pl}
                  className={`px-3 py-1.5 ${activePrinting === pl ? "bg-foil/20 text-body font-semibold" : "text-dim hover:text-body"}`}
                  onClick={() => setPrinting(pl)}
                >
                  {pl}
                </button>
              ))}
            </div>
          )}
          <button className="btn-ghost !py-1.5 text-xs" onClick={exportSetCsv}>Export CSV</button>
          <div className="flex rounded-lg border border-edge overflow-hidden text-sm">
            {(["all", "owned", "missing"] as const).map((f) => (
              <button
                key={f}
                className={`px-3 py-1.5 capitalize ${ownFilter === f ? "bg-edge text-body font-semibold" : "text-dim hover:text-body"}`}
                onClick={() => setOwnFilter(f)}
              >
                {f === "all" ? "All" : f === "owned" ? `Owned (${masteryOwned})` : `Missing (${cards.length - masteryOwned})`}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={onlyChase} onChange={(e) => setOnlyChase(e.target.checked)} />
            Chase cards only
          </label>
          <span className="text-dim text-xs">{loading ? "Loading checklist..." : `${shownCards.length} cards`}</span>
        </div>
        {err && <div className="text-bad text-sm">{err}</div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {shownCards.map((c) => (
            <div key={c.id} className={`card p-3 space-y-2 relative ${ownedQty(c) > 0 ? "!border-win/50" : ""}`}>
              {ownedQty(c) > 0 && (
                <span className="absolute top-2 right-2 z-10 text-[10px] font-bold text-win bg-ink/90 border border-win/50 rounded-full px-2 py-0.5">
                  Owned{ownedQty(c) > 1 ? ` x${ownedQty(c)}` : ""}
                </span>
              )}
              {c.image && (
                <a href={c.imageLarge || c.image} target="_blank" rel="noreferrer">
                  <img src={c.image} alt={c.name} className="w-full rounded-md" loading="lazy" />
                </a>
              )}
              <div>
                <div className="text-sm font-medium leading-tight">{c.name}</div>
                <div className="text-dim text-xs">#{c.number} - {c.rarity || "no rarity"}</div>
                <div className="num text-foil text-sm font-bold mt-1">{priceFor(c) !== null ? $(priceFor(c) as number) : "-"}</div>
                <button
                  className={`mt-1.5 text-xs rounded px-2 py-1 border transition-colors disabled:opacity-40 ${
                    added.has(c.id)
                      ? "border-win/50 text-win cursor-default"
                      : "border-edge text-dim hover:text-body hover:border-foil/50"
                  }`}
                  disabled={adding === c.id || added.has(c.id)}
                  onClick={() => !added.has(c.id) && quickAdd(c)}
                >
                  {added.has(c.id) ? "\u2713 Added" : adding === c.id ? "Adding..." : "+ Add to Singles"}
                </button>
              </div>
            </div>
          ))}
        </div>
        {!loading && shownCards.length === 0 && <div className="text-dim">No cards match</div>}
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-5">
      <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
        Set <span className="text-foil">checklists</span>
      </h1>
      <p className="text-dim text-sm">
        Every Pokemon TCG set, newest first. Open a set to see the full card checklist with market prices -
        useful for planning what goes in a character break.
      </p>
      <input className="input !max-w-md" placeholder='Search sets - try "Prismatic" or "Scarlet"' value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <div className="text-bad text-sm">{err}</div>}
      <section className="card p-4 space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <span className="label">My master sets</span>
          <span className="text-dim text-xs">every printing of one pokemon, across every set</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            className="input !w-44 !py-1.5"
            placeholder="Pokemon name, e.g. raichu"
            value={newPokemon}
            onChange={(e) => setNewPokemon(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createCustomSet(); }}
          />
          <button className="btn-foil !py-1.5 text-sm disabled:opacity-40" disabled={creating || !newPokemon.trim()} onClick={createCustomSet}>
            {creating ? "Creating..." : "Create master set"}
          </button>
        </div>
        {customSets.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {customSets.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-foil/40 bg-foil/5 pl-3 pr-1.5 py-1 text-sm">
                <button className="hover:text-foil font-medium" onClick={() => setActive({ id: `custom:${c.query}`, name: c.name } as any)}>
                  {c.name}
                </button>
                <button className="text-dim hover:text-bad px-1" title="Delete master set" onClick={() => deleteCustomSet(c.id, c.name)}>{"\u2715"}</button>
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {filteredSets.map((s) => (
          <button key={s.id} className="card p-4 text-left hover:border-foil/50 transition-colors" onClick={() => setActive(s)}>
            <div className="flex items-center gap-3">
              {s.symbol && <img src={s.symbol} alt="" className="w-6 h-6 object-contain" />}
              <div className="min-w-0">
                <div className="font-medium truncate">{s.name}</div>
                <div className="text-dim text-xs">{s.series} - {s.releaseDate} - {s.total} cards</div>
              </div>
            </div>
          </button>
        ))}
        {sets.length === 0 && !err && <div className="text-dim">Loading sets...</div>}
      </div>
    </main>
  );
}
