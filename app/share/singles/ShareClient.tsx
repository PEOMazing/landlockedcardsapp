"use client";
import { useMemo, useState } from "react";

export type ShareCard = {
  id: string;
  cardNo: string;
  name: string;
  setName: string;
  number: string;
  rarity: string;
  variant: string;
  condition: string;
  language: string;
  printing: string;
  price: number | null;
  image: string;
};

const $ = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Sort = "name" | "priceDown" | "priceUp" | "set";

const SORTS: { k: Sort; label: string }[] = [
  { k: "name", label: "A to Z" },
  { k: "priceDown", label: "Price high" },
  { k: "priceUp", label: "Price low" },
  { k: "set", label: "By set" },
];

// The little grey tags under a card name. Only the ones that actually say
// something: "Normal" as a variant and "English" as a language are the default
// case and printing them on every one of eight hundred rows is just noise.
function badges(c: ShareCard): string[] {
  const out: string[] = [];
  if (c.condition) out.push(c.condition);
  if (c.variant && c.variant !== "Normal") out.push(c.variant);
  if (c.printing) out.push(c.printing);
  if (c.language && c.language !== "English") out.push(c.language);
  if (c.rarity) out.push(c.rarity);
  return out;
}

function Row({ c }: { c: ShareCard }) {
  return (
    <a
      href={`/label/${c.id}`}
      className="flex items-center gap-3 p-3 rounded-xl border border-edge/60 hover:border-edge hover:bg-edge/20 transition-colors"
    >
      {c.image ? (
        <img src={c.image} alt="" loading="lazy" className="w-12 rounded shrink-0" />
      ) : (
        <span className="w-12 h-16 rounded bg-edge/40 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{c.name}</div>
        <div className="text-dim text-xs truncate">
          {c.setName}
          {c.number ? ` · ${c.number}` : ""}
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {badges(c).map((b) => (
            <span key={b} className="text-[10px] text-dim border border-edge/60 rounded px-1.5 py-0.5">
              {b}
            </span>
          ))}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="num font-semibold">{c.price === null ? "-" : $(c.price)}</div>
        <div className="text-dim text-[10px] num">#{c.cardNo}</div>
      </div>
    </a>
  );
}

export default function ShareClient({ cards, updated }: { cards: ShareCard[]; updated: string }) {
  const [q, setQ] = useState("");
  const [set, setSet] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [shown, setShown] = useState(60);

  const sets = useMemo(
    () => Array.from(new Set(cards.map((c) => c.setName).filter(Boolean))).sort(),
    [cards],
  );

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = cards;
    if (set) out = out.filter((c) => c.setName === set);
    if (needle) {
      out = out.filter((c) =>
        `${c.name} ${c.setName} ${c.number} ${c.rarity} ${c.cardNo}`.toLowerCase().includes(needle),
      );
    }
    const by: Record<Sort, (a: ShareCard, b: ShareCard) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      priceDown: (a, b) => (b.price ?? -1) - (a.price ?? -1),
      priceUp: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
      set: (a, b) => a.setName.localeCompare(b.setName) || a.name.localeCompare(b.name),
    };
    return [...out].sort(by[sort]);
  }, [cards, q, set, sort]);

  const visible = list.slice(0, shown);

  return (
    <main className="min-h-screen">
      <div className="max-w-3xl mx-auto p-5 space-y-4">
        <header className="pt-2">
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display, sans-serif)" }}>
            LandLocked <span className="holo-text">Cards</span>
          </h1>
          <p className="text-dim text-sm mt-1">
            {cards.length.toLocaleString()} singles in stock. Prices follow recent TCGplayer sales and
            move with the market, so treat them as of today rather than a fixed list.
          </p>
        </header>

        <div className="space-y-2 sticky top-0 py-2 bg-panel/90 backdrop-blur z-10">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShown(60);
            }}
            placeholder="Search a card, set or number"
            className="w-full rounded-lg border border-edge bg-transparent px-3 py-2 text-sm"
          />
          <div className="flex gap-2 flex-wrap items-center">
            <select
              value={set}
              onChange={(e) => {
                setSet(e.target.value);
                setShown(60);
              }}
              className="rounded-lg border border-edge bg-panel px-2 py-1.5 text-sm max-w-[55%]"
            >
              <option value="">All sets</option>
              {sets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {SORTS.map((s) => (
              <button
                key={s.k}
                onClick={() => setSort(s.k)}
                className={`text-xs rounded-lg px-2.5 py-1.5 border transition-colors ${
                  sort === s.k
                    ? "border-edge bg-edge/70 font-semibold"
                    : "border-edge/60 text-dim hover:text-body"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-dim text-xs">
          {list.length.toLocaleString()} {list.length === 1 ? "card" : "cards"}
          {q || set ? " matching" : ""}
        </div>

        <div className="space-y-2">
          {visible.map((c) => (
            <Row key={c.id} c={c} />
          ))}
        </div>

        {shown < list.length && (
          <button
            onClick={() => setShown((n) => n + 120)}
            className="w-full rounded-lg border border-edge py-2.5 text-sm hover:bg-edge/30"
          >
            Show more ({(list.length - shown).toLocaleString()} left)
          </button>
        )}

        {list.length === 0 && (
          <div className="text-dim text-sm py-10 text-center">Nothing matches that search.</div>
        )}

        <footer className="text-dim text-[11px] pt-6 pb-10 border-t border-edge/50">
          Tap any card for its price detail. Updated {updated.slice(0, 10)}.
        </footer>
      </div>
    </main>
  );
}
