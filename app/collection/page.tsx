import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import Thumb from "@/components/Thumb";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";
import { toSingle } from "@/lib/singles";
import { getSnapshots } from "@/lib/priceRefresh";
import { HeroCard, TopMovers, TrendChart, ValueDelta } from "@/components/PortfolioPulse";

export const dynamic = "force-dynamic";

const $ = (n: number) =>
  "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $0 = (n: number) => "$" + Math.round(n || 0).toLocaleString("en-US");

const GRADED = ["PSA 10", "PSA 9", "PSA 8", "CGC 10", "CGC 9.5", "BGS 9.5", "Other"];

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`num text-2xl font-bold mt-1 ${tone || ""}`}>{value}</div>
      {sub && <div className="text-dim text-xs mt-1">{sub}</div>}
    </div>
  );
}

export default async function CollectionDashboard() {
  const me = await getMe();
  if (!me) redirect("/sign-in");

  const [inventoryRows, singlesRows, snaps] = await Promise.all([
    atList(T.inventory, { filterByFormula: "{Active} = TRUE()" }),
    atList(T.singles),
    getSnapshots(30),
  ]);

  const singles = singlesRows.map((r) => toSingle(r, me.isAdmin));
  const held = singles.filter((s: any) => s.status !== "Sold");

  let sealedUnits = 0, sealedMarket = 0;
  for (const r of inventoryRows) {
    const qty = r.fields["Qty On Hand"] ?? 0;
    sealedUnits += qty;
    sealedMarket += (r.fields["Market Price"] ?? 0) * qty;
  }

  const cards = held.reduce((a: number, s: any) => a + (s.qty || 1), 0);
  const slabs = held.filter((s: any) => GRADED.includes(s.condition));
  const slabValue = slabs.reduce((a: number, s: any) => a + (s.comp || 0) * (s.qty || 1), 0);
  const singlesValue = held.reduce((a: number, s: any) => a + (s.comp || 0) * (s.qty || 1), 0);
  const invested = me.isAdmin
    ? held.reduce((a: number, s: any) => a + (s.buy || 0) * (s.qty || 1), 0)
    : null;

  const topCards = [...held].sort((a: any, b: any) => (b.comp || 0) - (a.comp || 0)).slice(0, 10);
  const recent = [...held]
    .sort((a: any, b: any) => String(b.dateAdded).localeCompare(String(a.dateAdded)))
    .slice(0, 5);

  const bySet = new Map<string, { cards: number; value: number }>();
  for (const s of held as any[]) {
    const k = s.setName || "Unknown set";
    const e = bySet.get(k) || { cards: 0, value: 0 };
    e.cards += s.qty || 1;
    e.value += (s.comp || 0) * (s.qty || 1);
    bySet.set(k, e);
  }
  const sets = [...bySet.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 8);
  const maxSet = Math.max(1, ...sets.map(([, v]) => v.value));

  const byCondition = new Map<string, number>();
  for (const s of held as any[]) byCondition.set(s.condition, (byCondition.get(s.condition) || 0) + (s.qty || 1));

  const collectionValue = sealedMarket + singlesValue;

  return (
    <>
      <Nav isAdmin={me.isAdmin} isManager={me.isManager} name={me.streamer?.fields?.["Name"] || "Collector"} />
      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Collection</h1>
          <span className="text-dim text-sm">Everything you hold, at today&apos;s market</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ValueDelta snaps={snaps} fallback={collectionValue} label="Collection value" sub={`${$0(singlesValue)} singles - ${$0(sealedMarket)} sealed`} />
          <Tile label="Cards" value={String(cards)} sub={`${slabs.reduce((a: number, s: any) => a + (s.qty || 1), 0)} slabs worth ${$0(slabValue)}`} />
          <Tile label="Sealed products" value={String(sealedUnits)} sub="boxes, bundles, ETBs, and more" />
          {invested !== null ? (
            <Tile
              label="Invested"
              value={$0(invested)}
              sub={`${singlesValue - invested >= 0 ? "+" : ""}${$0(singlesValue - invested)} unrealized on singles`}
              tone={singlesValue - invested >= 0 ? "text-win" : "text-bad"}
            />
          ) : (
            <Tile label="Sets represented" value={String(bySet.size)} sub="across your singles" />
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <HeroCard card={topCards[0] || null} />
          <section className="card p-5">
            <div className="label mb-3">Value trend - nightly reprices</div>
            <TrendChart snaps={snaps} />
          </section>
        </div>

        <TopMovers snaps={snaps} />

        {(() => {
          const perf = (held as any[])
            .filter((s) => s.entryComp > 0 && s.comp !== null && Math.abs(s.comp - s.entryComp) >= 0.01)
            .map((s) => ({ ...s, delta: s.comp - s.entryComp, pct: ((s.comp - s.entryComp) / s.entryComp) * 100 }))
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 3);
          if (perf.length === 0) return null;
          return (
            <section className="card p-5">
              <div className="label mb-3">Since you added them</div>
              <div className="space-y-2">
                {perf.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3">
                    {s.image && <Thumb src={s.image} size={30} />}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{s.name}</div>
                      <div className="text-dim text-xs">added {s.dateAdded} at {"$"}{Number(s.entryComp).toFixed(2)}</div>
                    </div>
                    <span className={`num ml-auto font-semibold ${s.delta >= 0 ? "text-win" : "text-bad"}`}>
                      {s.delta >= 0 ? "\u25B2" : "\u25BC"} {"$"}{Math.abs(s.delta).toFixed(2)} ({s.delta >= 0 ? "+" : "-"}{Math.abs(s.pct).toFixed(1)}%)
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}

        <div className="grid md:grid-cols-2 gap-4">
          <section className="card p-5">
            <div className="label mb-3">Most valuable cards</div>
            <div className="space-y-2">
              {topCards.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3">
                  {s.image && <Thumb src={s.image} size={30} />}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{s.name}</div>
                    <div className="text-dim text-xs truncate">{s.setName} - {s.condition}</div>
                  </div>
                  <span className="num ml-auto text-foil font-semibold">{$(s.comp || 0)}</span>
                </div>
              ))}
              {topCards.length === 0 && <div className="text-dim text-sm">Add cards on the Singles page to see them here</div>}
            </div>
          </section>

          <div className="space-y-4">
            <section className="card p-5">
              <div className="label mb-3">Value by set</div>
              <div className="space-y-2">
                {sets.map(([name, v]) => (
                  <div key={name} className="flex items-center gap-3">
                    <div className="w-40 text-sm truncate">{name}</div>
                    <div className="flex-1 h-2 rounded bg-edge overflow-hidden">
                      <div className="h-full" style={{ width: `${(v.value / maxSet) * 100}%`, background: "linear-gradient(90deg, #7aa2ff, #c084fc)" }} />
                    </div>
                    <span className="num text-xs text-dim w-20 text-right">{$0(v.value)}</span>
                  </div>
                ))}
                {sets.length === 0 && <div className="text-dim text-sm">No sets yet</div>}
              </div>
            </section>

            <section className="card p-5">
              <div className="label mb-3">Condition breakdown</div>
              <div className="flex flex-wrap gap-2">
                {[...byCondition.entries()].sort((a, b) => b[1] - a[1]).map(([cond, n]) => (
                  <span key={cond} className="text-xs border border-edge rounded-full px-3 py-1.5 text-dim">
                    <span className="text-body font-semibold">{cond}</span> x{n}
                  </span>
                ))}
              </div>
            </section>
          </div>
        </div>

        <section className="card p-5">
          <div className="label mb-3">Recently added</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {recent.map((s: any) => (
              <div key={s.id} className="rounded-lg border border-edge p-3 text-center">
                {s.image && <img src={s.image} alt="" className="h-20 mx-auto object-contain mb-2" loading="lazy" />}
                <div className="text-xs font-medium truncate">{s.name}</div>
                <div className="text-dim text-[10px] truncate">{s.setName}</div>
                <div className="num text-foil text-sm font-semibold mt-1">{s.comp !== null ? $(s.comp) : "-"}</div>
              </div>
            ))}
            {recent.length === 0 && <div className="text-dim text-sm col-span-full">Nothing here yet</div>}
          </div>
        </section>
      </main>
    </>
  );
}
