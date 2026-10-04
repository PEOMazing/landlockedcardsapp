"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import StatTile from "@/components/ui/StatTile";

// The screen for "tell me what to pull".
//
// It is a reader, not a builder. Generating a set takes nothing off the shelf
// and writes nothing down, so you can sit here and press Re-roll ten times
// while you make your mind up. Nothing you see here exists anywhere else until
// you put it on a show yourself.
//
// The pull list is the actual product of this page, so it is laid out to be
// printed and carried: sealed first because it comes off a shelf by the
// armful, then the binder in slot order so the run is one pass front to back
// instead of a scavenger hunt.

type Pick = {
  id: string;
  kind: "single" | "sealed";
  name: string;
  qty: number;
  unitValue: number;
  value: number;
  tier: string;
  slot: number | null;
};

type Resp = {
  spots: number;
  seed: number;
  medianSpots: number;
  set: {
    picks: Pick[];
    spots: number;
    value: number;
    valuePerSpot: number;
    hitPoolValue: number;
    hitPoolCount: number;
    biggest: { name: string; value: number; pct: number } | null;
    byTier: { key: string; label: string; spots: number; value: number }[];
    warnings: string[];
  };
  pull: { sealed: Pick[]; singles: Pick[] };
  shelf: { singles: number; sealedProducts: number; sealedUnits: number };
  slabs: { id: string; name: string; value: number }[];
  slabValue: number;
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 100 ? 0 : 2 });

export default function QuickSetClient() {
  // Left blank until the first response comes back. The API works out what a
  // normal show runs from what has actually sold, so the field gets filled in
  // with a real number rather than one hardcoded here and left to go stale.
  const [spots, setSpots] = useState("");
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [showSlabs, setShowSlabs] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = useCallback(async (opts: { spots?: string; seed?: number } = {}) => {
    setBusy(true);
    setErr("");
    const q = new URLSearchParams();
    const n = Number(opts.spots ?? spots);
    if (n > 0) q.set("spots", String(Math.floor(n)));
    q.set("seed", String(opts.seed ?? Math.floor(Math.random() * 100000)));
    try {
      const res = await fetch(`/api/quick-set?${q}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not generate a set");
      setData(d);
      setSpots(String(d.spots));
    } catch (e: any) {
      setErr(e?.message || "Could not generate a set");
    } finally {
      setBusy(false);
    }
  }, [spots]);

  // Fired on arrival on purpose. There is one reason to open this page and it
  // is to see a set, so making you press a button first is a toll booth.
  useEffect(() => { run({ spots: "" }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const set = data?.set;

  const copyList = async () => {
    if (!data) return;
    const lines = [
      `Quick set, ${data.set.spots} spots, ${money(data.set.value)}, seed ${data.seed}`,
      "",
      "SEALED",
      ...data.pull.sealed.map((p) => `${p.qty}x ${p.name}`),
      "",
      "SINGLES",
      ...data.pull.singles.map((p) => p.name),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { setErr("Could not reach the clipboard. Print it instead."); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Quick <span className="holo-text">set</span></>}
        subtitle={data ? `seed ${data.seed}` : undefined}
        className="print:hidden"
        actions={
          <>
            <label className="label" htmlFor="spots">Spots</label>
            <input
              id="spots"
              type="number"
              min={1}
              className="input w-24"
              value={spots}
              placeholder="auto"
              onChange={(e) => setSpots(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            />
            <button className="btn-ghost disabled:opacity-40" disabled={busy} onClick={() => run()}>
              {busy ? "Working..." : "Re-roll"}
            </button>
            <button className="btn-ghost disabled:opacity-40" disabled={busy || !data} onClick={copyList}>
              {copied ? "Copied" : "Copy list"}
            </button>
            <button className="btn-foil disabled:opacity-40" disabled={busy || !data} onClick={() => window.print()}>
              Print
            </button>
          </>
        }
      />

      <p className="t-secondary text-dim print:hidden">
        Built from what is on the shelf right now. Nothing here is reserved: the set only exists once
        you put it on a show yourself, so re-roll as many times as you like.
        {data ? ` Your shows run ${data.medianSpots} spots on a normal night.` : ""}
      </p>

      {err && <div className="card p-4 border-bad/50 text-bad t-body">{err}</div>}

      {busy && !data && (
        <div className="card p-8 text-center text-dim t-body">Reading the shelf...</div>
      )}

      {set && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-s3">
            <StatTile label="Spots" value={String(set.spots)} sub={`of ${data!.spots} asked for`} size="md" tone={set.spots < data!.spots ? "warn" : "body"} />
            <StatTile label="On the board" value={money(set.value)} sub="market value" size="md" />
            <StatTile label="Per spin" value={money(set.valuePerSpot)} sub="shows earn about $10" size="md" tone="foil" />
            <StatTile label="Hit pool" value={money(set.hitPoolValue)} sub={`${set.hitPoolCount} items`} size="md" tone="win" />
            <StatTile
              label="Biggest item"
              value={set.biggest ? `${set.biggest.pct}%` : "-"}
              sub={set.biggest ? money(set.biggest.value) : undefined}
              size="md"
              tone={set.biggest && set.biggest.pct > 15 ? "warn" : "body"}
              title={set.biggest?.name}
            />
          </div>

          <div className="card p-s4 space-y-s2 print:hidden">
            <div className="t-section">The mix</div>
            {set.byTier.map((t) => {
              const pct = set.spots ? (t.spots / set.spots) * 100 : 0;
              return (
                <div key={t.key} className="flex items-center gap-s3">
                  <div className="t-secondary w-40 shrink-0 text-dim">{t.label}</div>
                  <div className="flex-1 h-2 rounded-full bg-edge/60 overflow-hidden">
                    <div className="h-full bg-foil/70" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="num t-secondary w-28 text-right shrink-0">
                    {t.spots} spots
                    <span className="text-dim"> / {money(t.value)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {set.warnings.length > 0 && (
            <div className="card p-s4 border-warn/40 print:hidden">
              <div className="t-section text-warn mb-s2">Worth knowing</div>
              <ul className="space-y-s1 t-secondary text-dim">
                {set.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div>
            <div className="t-section mb-s2">Pull list</div>
            <div className="grid md:grid-cols-2 gap-s4">
              <div className="card p-s4">
                <div className="label mb-s2">
                  Sealed
                  <span className="text-dim font-normal"> / {data!.pull.sealed.reduce((a, p) => a + p.qty, 0)} units off the shelf</span>
                </div>
                <table className="w-full">
                  <tbody>
                    {data!.pull.sealed.map((p) => (
                      <tr key={p.id} className="border-t border-edge/60 first:border-0">
                        <td className="num py-1 pr-s3 w-10 font-bold">{p.qty}x</td>
                        <td className="t-secondary py-1">{p.name}</td>
                        <td className="num t-meta py-1 pl-s3 text-right text-dim whitespace-nowrap">{money(p.unitValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card p-s4">
                <div className="label mb-s2">
                  Singles
                  <span className="text-dim font-normal"> / {data!.pull.singles.length} cards, in slot order</span>
                </div>
                <table className="w-full">
                  <tbody>
                    {data!.pull.singles.map((p) => (
                      <tr key={p.id} className="border-t border-edge/60 first:border-0">
                        <td className="t-secondary py-1">{p.name}</td>
                        <td className="num t-meta py-1 pl-s3 text-right text-dim whitespace-nowrap">{money(p.unitValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Shown every time rather than tucked away. These are not wheel
              stock and never will be: every one is worth more than two whole
              sets, so a spin landing on one gives away a show's takings. But
              that also makes them the largest single thing this business owns
              and the only thing it owns that is doing nothing, and a number
              that size should not be something you have to go looking for. */}
          <div className="card p-s4 print:hidden">
            <div className="flex items-baseline justify-between flex-wrap gap-s2">
              <div>
                <div className="t-section">Not on the wheel</div>
                <p className="t-secondary text-dim mt-s1">
                  {data!.slabs.length} graded cards worth {money(data!.slabValue)}, held back. Any one of
                  them is worth more than this whole set, so a spin landing on one costs you the night.
                  They want selling, not spinning.
                </p>
              </div>
              <button className="btn-ghost" onClick={() => setShowSlabs((s) => !s)}>
                {showSlabs ? "Hide" : "Show them"}
              </button>
            </div>
            {showSlabs && (
              <table className="w-full mt-s3">
                <tbody>
                  {data!.slabs.map((s) => (
                    <tr key={s.id} className="border-t border-edge/60">
                      <td className="t-secondary py-1">{s.name}</td>
                      <td className="num t-secondary py-1 pl-s3 text-right whitespace-nowrap">{money(s.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="t-meta text-dim print:hidden">
            Shelf read: {data!.shelf.singles} raw singles, {data!.shelf.sealedUnits} sealed units across{" "}
            {data!.shelf.sealedProducts} products.{" "}
            <Link href="/streams/new" className="text-foil hover:underline">Start a show</Link>{" "}
            and add these from the set builder.
          </div>
        </>
      )}
    </div>
  );
}
