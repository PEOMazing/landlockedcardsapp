"use client";
import { useEffect, useMemo, useState } from "react";
import { orderNote, orderTotal, venmoUrl } from "@/lib/venmo";

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
  pending: boolean;
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

const CART_KEY = "llc.cart.v1";
const MAX_CARDS = 40;

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

function Row({ c, inCart, onToggle }: { c: ShareCard; inCart: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-edge/60">
      <a href={`/label/${c.id}`} className="flex items-center gap-3 min-w-0 flex-1">
        {c.image ? (
          <img src={c.image} alt="" loading="lazy" className="w-12 rounded shrink-0" />
        ) : (
          <span className="w-12 h-16 rounded bg-edge/40 shrink-0" />
        )}
        <span className="min-w-0 flex-1 block">
          <span className="font-medium truncate block">{c.name}</span>
          <span className="text-dim text-xs truncate block">
            {c.setName}
            {c.number ? ` · ${c.number}` : ""}
          </span>
          <span className="flex flex-wrap gap-1 mt-1">
            {c.pending && (
              <span className="text-[10px] rounded px-1.5 py-0.5 border border-edge text-foil">
                Order pending
              </span>
            )}
            {badges(c).map((b) => (
              <span key={b} className="text-[10px] text-dim border border-edge/60 rounded px-1.5 py-0.5">
                {b}
              </span>
            ))}
          </span>
        </span>
      </a>
      <div className="text-right shrink-0">
        <div className="num font-semibold">{c.price === null ? "-" : $(c.price)}</div>
        <div className="text-dim text-[10px] num">#{c.cardNo}</div>
        <button
          onClick={onToggle}
          className={`mt-1 text-xs rounded-lg px-2.5 py-1 border transition-colors ${
            inCart ? "border-edge bg-edge/70 font-semibold" : "border-edge/60 text-dim hover:text-body"
          }`}
        >
          {inCart ? "In cart" : "Add"}
        </button>
      </div>
    </div>
  );
}

export default function ShareClient({ cards, updated }: { cards: ShareCard[]; updated: string }) {
  const [q, setQ] = useState("");
  const [set, setSet] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [shown, setShown] = useState(60);
  const [cart, setCart] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [placed, setPlaced] = useState<{ cardNos: string[]; total: number; unavailable: number } | null>(null);

  // The cart survives a refresh, because a phone browsing eight hundred cards
  // will reload at some point and losing the pile is the fastest way to lose
  // the sale. Wrapped because storage throws in private windows.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setCart(JSON.parse(raw).filter((x: unknown) => typeof x === "string"));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {}
  }, [cart]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  // a cart entry whose card has since sold is dropped rather than shown as a gap
  const inCart = useMemo(() => cart.map((id) => byId.get(id)).filter(Boolean) as ShareCard[], [cart, byId]);
  const total = orderTotal(inCart.map((c) => c.price));

  const toggle = (id: string) =>
    setCart((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_CARDS ? c : [...c, id]));

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

  async function place() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/public/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: inCart.map((c) => c.id), name, contact }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "could not place the order");
      setPlaced({
        cardNos: d.cards.map((c: any) => c.cardNo),
        total: d.total,
        unavailable: d.unavailable || 0,
      });
      setCart([]);
    } catch (e: any) {
      setErr(e.message || "could not place the order");
    } finally {
      setBusy(false);
    }
  }

  const note = placed ? orderNote(placed.cardNos) : orderNote(inCart.map((c) => c.cardNo));
  const pay = placed ? venmoUrl(placed.total, note) : venmoUrl(total, note);

  return (
    <main className="min-h-screen">
      <div className="max-w-3xl mx-auto p-5 space-y-4 pb-28">
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
          {list.slice(0, shown).map((c) => (
            <Row key={c.id} c={c} inCart={cart.includes(c.id)} onToggle={() => toggle(c.id)} />
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

        <footer className="text-dim text-[11px] pt-6 border-t border-edge/50">
          Tap a card for its price detail. Updated {updated.slice(0, 10)}.
        </footer>
      </div>

      {cart.length > 0 && !open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-edge bg-panel px-5 py-3 text-sm font-semibold shadow-lg"
        >
          Cart · {cart.length} · <span className="num">{$(total)}</span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-edge bg-panel p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">{placed ? "Order placed" : "Your cart"}</h2>
              <button onClick={() => setOpen(false)} className="text-dim px-2">
                {"✕"}
              </button>
            </div>

            {placed ? (
              <div className="space-y-3">
                <p className="text-sm">
                  Held for you: <span className="num font-semibold">{placed.cardNos.length}</span>{" "}
                  {placed.cardNos.length === 1 ? "card" : "cards"} for{" "}
                  <span className="num font-semibold">{$(placed.total)}</span>.
                </p>
                {placed.unavailable > 0 && (
                  <p className="text-bad text-sm">
                    {placed.unavailable} {placed.unavailable === 1 ? "card was" : "cards were"} already
                    gone and {placed.unavailable === 1 ? "is" : "are"} not in this total.
                  </p>
                )}
                <a
                  href={pay}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-center rounded-xl border border-edge bg-edge/70 py-3 font-semibold"
                >
                  Pay {$(placed.total)} with Venmo
                </a>
                <div className="text-dim text-xs space-y-1">
                  <p>
                    Venmo to <b className="text-body">@landlockedcards</b>. If the amount or note does not
                    carry over, put this in the note:
                  </p>
                  <p className="text-body border border-edge/60 rounded p-2 break-words">{note}</p>
                  <p>Nothing is confirmed until the payment lands and we message you back.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {inCart.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm">
                      <span className="num text-dim text-xs w-12 shrink-0">#{c.cardNo}</span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="num shrink-0">{c.price === null ? "-" : $(c.price)}</span>
                      <button onClick={() => toggle(c.id)} className="text-dim hover:text-bad px-1 shrink-0">
                        {"✕"}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between border-t border-edge pt-2 font-semibold">
                  <span>Total</span>
                  <span className="num">{$(total)}</span>
                </div>
                {cart.length >= MAX_CARDS && (
                  <p className="text-dim text-xs">
                    {MAX_CARDS} cards is the most one order takes. Message us for anything bigger.
                  </p>
                )}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-edge bg-transparent px-3 py-2 text-sm"
                />
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Phone, email or Whatnot handle"
                  className="w-full rounded-lg border border-edge bg-transparent px-3 py-2 text-sm"
                />
                {err && <p className="text-bad text-sm">{err}</p>}
                <button
                  disabled={busy || !name.trim() || !contact.trim() || inCart.length === 0}
                  onClick={place}
                  className="w-full rounded-xl border border-edge bg-edge/70 py-3 font-semibold disabled:opacity-40"
                >
                  {busy ? "Placing..." : `Checkout · ${$(total)}`}
                </button>
                <p className="text-dim text-[11px]">
                  Checkout marks these cards pending and shows you a Venmo link. Your name and contact
                  go to LandLocked Cards so the payment can be matched to you.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
