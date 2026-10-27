"use client";

import { useState } from "react";

// lk-v1. Pasting a TCGplayer link onto a card the resolvers cannot find.
//
// The last 13 cards, and why they need a human. After the set-name work the
// automatic path got 11 of 24 blanks, every one through a corrected set name.
// What is left has no mechanical route to a TCGplayer group at all: Japanese
// era codes (M2a, SV8a, ASC, MEG), "Start Deck 100: CoroCoro Comic", a couple
// of deck exclusives. Searching those by name and number was measured against
// the live mirror and comes back with the wrong card - a Celebrations metal
// Charizard for a Base Set Charizard - so the only honest fix is somebody
// pasting the right link once.
//
// Deliberately not just a picture fix. The link is the thing: a card with no
// Card ID does not reprice, has no condition-specific sold comp and never
// enters the graded sweep. The missing art was the visible half.

export type LinkRow = {
  id: string;
  cardNo: number | null;
  name: string;
  setName: string;
  number: string;
  condition: string;
  language: string;
  comp: number | null;
  image: string;
};

const money = (n: number | null) =>
  n === null ? "-" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The search TCGplayer needs to land on the right product, which is the name
 *  and the set and nothing else. The collector number is left out on purpose:
 *  most sellers do not put it in a product title, and including it is how a
 *  search returns nothing on a card that is plainly there. */
const searchUrl = (r: LinkRow) =>
  "https://www.tcgplayer.com/search/pokemon/product?q=" +
  encodeURIComponent([r.name.replace(/\s*-\s*[\d/]+.*$/, ""), r.setName].filter(Boolean).join(" ")) +
  "&view=grid";

export default function LinkClient({ rows }: { rows: LinkRow[] }) {
  const [state, setState] = useState<Record<string, { busy?: boolean; err?: string; ok?: string }>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});

  async function link(r: LinkRow) {
    const url = (draft[r.id] || "").trim();
    if (!url) {
      setState((s) => ({ ...s, [r.id]: { err: "Paste the TCGplayer product link first" } }));
      return;
    }
    setState((s) => ({ ...s, [r.id]: { busy: true } }));
    try {
      const res = await fetch(`/api/singles/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tcgLink: url }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState((s) => ({ ...s, [r.id]: { err: d.error || "Could not link that" } }));
        return;
      }
      setState((s) => ({ ...s, [r.id]: { ok: "Linked" } }));
      setDone((s) => ({ ...s, [r.id]: true }));
    } catch {
      setState((s) => ({ ...s, [r.id]: { err: "Network error, try again" } }));
    }
  }

  const left = rows.filter((r) => !done[r.id]).length;

  if (rows.length === 0) {
    return (
      <div className="card p-5 text-sm">
        <p className="font-medium mb-1">Everything in stock is linked.</p>
        <p className="text-dim">
          Every card has a TCGplayer product behind it, so they all reprice on their own and all
          of them reach the graded sweep.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-dim text-xs">
        {left} of {rows.length} still to do. Open the card on TCGplayer, copy the URL out of the
        address bar and paste it in. Search opens a TCGplayer search already filled in with the
        name and set.
      </p>
      <div className="space-y-2">
        {rows.map((r) => {
          const st = state[r.id] || {};
          const isDone = !!done[r.id];
          return (
            <div
              key={r.id}
              className={`card p-3 flex flex-col sm:flex-row sm:items-center gap-3 ${isDone ? "opacity-60" : ""}`}
            >
              <div className="w-10 h-10 shrink-0 rounded bg-edge/40 overflow-hidden flex items-center justify-center">
                {r.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image} alt="" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-dim t-meta">none</span>
                )}
              </div>
              <div className="min-w-0 sm:w-72 shrink-0">
                <div className="t-secondary font-semibold leading-tight truncate">{r.name}</div>
                <div className="text-dim t-meta truncate">
                  {r.setName}
                  {r.number ? ` #${r.number}` : ""}
                  {" · "}
                  <span className="num">{r.condition}</span>
                  {r.language && r.language !== "English" ? ` · ${r.language}` : ""}
                  {r.cardNo !== null ? ` · ${String(r.cardNo).padStart(4, "0")}` : ""}
                </div>
              </div>
              <div className="num text-dim text-sm sm:w-20 shrink-0">{money(r.comp)}</div>
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <input
                  className="input flex-1 min-w-0"
                  placeholder="https://www.tcgplayer.com/product/..."
                  value={draft[r.id] || ""}
                  disabled={isDone}
                  onChange={(e) => setDraft((s) => ({ ...s, [r.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") link(r); }}
                />
                <a
                  href={searchUrl(r)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost shrink-0 whitespace-nowrap"
                  title="Opens a TCGplayer search for this card's name and set"
                >
                  Search
                </a>
                <button
                  type="button"
                  className="btn shrink-0"
                  onClick={() => link(r)}
                  disabled={isDone || st.busy}
                >
                  {st.busy ? "Linking..." : isDone ? "Linked" : "Link"}
                </button>
              </div>
              <div className="sm:w-40 shrink-0 text-xs">
                {st.err && <span className="text-bad">{st.err}</span>}
                {st.ok && <span className="text-win">{st.ok}, art and printing written</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
