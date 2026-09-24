"use client";
import { useEffect, useState } from "react";
import Thumb from "@/components/Thumb";

type Mover = {
  id: string;
  cardNo: number;
  name: string;
  setName: string;
  condition: string;
  image: string;
  slot: number | null;
  comp: number;
  from: number;
  delta: number;
  pct: number;
};

type Payload = {
  days: number;
  ranked: number;
  of: number;
  up: number;
  down: number;
  net: number;
  movers: Mover[];
};

const $ = (n: number) =>
  "$" + Math.abs(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const WINDOWS: { days: number; label: string }[] = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 0, label: "Since added" },
];

const SHOWN = 25;

function Row({ m, rank }: { m: Mover; rank: number }) {
  const up = m.delta >= 0;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-edge/50 last:border-0">
      <span className="num text-dim text-xs w-6 shrink-0 text-right">{rank}</span>
      {m.image ? <Thumb src={m.image} size={34} /> : <span className="w-[34px] shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{m.name}</div>
        <div className="text-dim text-xs truncate">
          {m.setName}
          {m.condition ? ` - ${m.condition}` : ""}
          {m.slot ? <span className="num"> - pocket {m.slot}</span> : null}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`num text-sm font-semibold ${up ? "text-win" : "text-bad"}`}>
          {up ? "▲" : "▼"} {Math.abs(m.pct).toFixed(1)}%
        </div>
        <div className="text-dim text-xs num">
          {$(m.from)} {"→"} {$(m.comp)}
        </div>
      </div>
      <div className={`num text-sm font-semibold w-20 text-right shrink-0 ${up ? "text-win" : "text-bad"}`}>
        {up ? "+" : "-"}
        {$(m.delta)}
      </div>
    </div>
  );
}

function Panel({ title, note, list }: { title: string; note: string; list: Mover[] }) {
  return (
    <section className="card p-5">
      <div className="label mb-1">{title}</div>
      <div className="text-dim text-xs mb-3">{note}</div>
      {list.length === 0 ? (
        <div className="text-dim text-sm py-6 text-center">Nothing moved in this direction yet.</div>
      ) : (
        <div>
          {list.slice(0, SHOWN).map((m, i) => (
            <Row key={m.id} m={m} rank={i + 1} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function MoversClient() {
  const [days, setDays] = useState(30);
  const [by, setBy] = useState<"pct" | "dollars">("pct");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr("");
    fetch(`/api/singles/movers?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("could not load movers"))))
      .then((d) => live && setData(d))
      .catch((e) => live && setErr(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [days]);

  const movers = data?.movers || [];
  // Two different questions. Percent asks what is heating up, which is how you
  // find a card worth pulling. Dollars asks where the money actually went,
  // which on a collection with a few four-figure cards is a different list.
  const key = (m: Mover) => (by === "pct" ? m.pct : m.delta);
  const up = movers.filter((m) => m.delta > 0).sort((a, b) => key(b) - key(a));
  const down = movers.filter((m) => m.delta < 0).sort((a, b) => key(a) - key(b));

  const windowLabel = days === 0 ? "since each card was added" : `over the last ${days} days`;

  return (
    <main className="md:pl-56">
      <div className="max-w-5xl mx-auto p-5 space-y-5">
        <header>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
            Movers
          </h1>
          <p className="text-dim text-sm mt-1">
            What the binder is doing. Prices come from the rolling reprice, so this follows the same
            comps the labels and streams use.
          </p>
        </header>

        <div className="flex flex-wrap gap-2 items-center">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              className={`text-sm rounded-lg px-3 py-1.5 border transition-colors ${
                days === w.days
                  ? "border-edge bg-edge/70 text-body font-semibold"
                  : "border-edge/60 text-dim hover:text-body hover:bg-edge/40"
              }`}
            >
              {w.label}
            </button>
          ))}
          <span className="ml-auto flex gap-2">
            {(["pct", "dollars"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setBy(k)}
                className={`text-sm rounded-lg px-3 py-1.5 border transition-colors ${
                  by === k
                    ? "border-edge bg-edge/70 text-body font-semibold"
                    : "border-edge/60 text-dim hover:text-body hover:bg-edge/40"
                }`}
              >
                {k === "pct" ? "By percent" : "By dollars"}
              </button>
            ))}
          </span>
        </div>

        {err && <div className="card p-4 text-bad text-sm">{err}</div>}

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-4">
              <div className="label">Net change</div>
              <div className={`num text-2xl font-bold mt-1 ${data.net >= 0 ? "text-win" : "text-bad"}`}>
                {data.net >= 0 ? "+" : "-"}
                {$(data.net)}
              </div>
            </div>
            <div className="card p-4">
              <div className="label">Up</div>
              <div className="num text-2xl font-bold mt-1 text-win">{data.up}</div>
            </div>
            <div className="card p-4">
              <div className="label">Down</div>
              <div className="num text-2xl font-bold mt-1 text-bad">{data.down}</div>
            </div>
            <div className="card p-4">
              <div className="label">Cards with history</div>
              <div className="num text-2xl font-bold mt-1">
                {data.ranked}
                <span className="text-dim text-sm font-normal"> / {data.of}</span>
              </div>
            </div>
          </div>
        )}

        {loading && <div className="text-dim text-sm">Loading...</div>}

        {!loading && data && data.ranked === 0 && (
          <div className="card p-6 text-sm text-dim">
            Nothing to rank for this window yet. The price log starts filling from the next reprice,
            so the 7, 30 and 90 day views build up over the coming days. Since added works straight
            away on any card that has been repriced at least once.
          </div>
        )}

        {!loading && data && data.ranked > 0 && (
          <div className="grid md:grid-cols-2 gap-5 items-start">
            <Panel title="Gainers" note={`Biggest increases ${windowLabel}`} list={up} />
            <Panel title="Fallers" note={`Biggest drops ${windowLabel}`} list={down} />
          </div>
        )}
      </div>
    </main>
  );
}
