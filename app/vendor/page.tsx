import Link from "next/link";
import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import Thumb from "@/components/Thumb";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";
import { getSettings } from "@/lib/settings";
import { buildWeekPay, buildManagerPay, StreamRow, toLine, weekStartOf } from "@/lib/calc";
import { toSingle } from "@/lib/singles";
import { getSnapshots } from "@/lib/priceRefresh";
import { HeroCard, TopMovers, TrendChart, ValueDelta } from "@/components/PortfolioPulse";

export const dynamic = "force-dynamic";

const $ = (n: number) =>
  "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $0 = (n: number) => "$" + Math.round(n || 0).toLocaleString("en-US");

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`num text-2xl font-bold mt-1 ${tone || ""}`}>{value}</div>
      {sub && <div className="text-dim text-xs mt-1">{sub}</div>}
    </div>
  );
}

export default async function VendorDashboard() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isAdmin) redirect("/dashboard");

  const [settings, streamerRows, streamRows, lineRows, inventoryRows, singlesRows, snaps] = await Promise.all([
    getSettings(),
    atList(T.streamers),
    atList(T.streams, { filterByFormula: "{Deleted At} = BLANK()" }),
    atList(T.lines),
    atList(T.inventory, { filterByFormula: "{Active} = TRUE()" }),
    atList(T.singles),
    getSnapshots(30),
  ]);

  // ---- sealed inventory ----
  let sealedUnits = 0, sealedMarket = 0, sealedCost = 0, sealedNeedBuy = 0, sealedUnpriced = 0;
  const byCategory = new Map<string, { units: number; market: number }>();
  for (const r of inventoryRows) {
    const qty = r.fields["Qty On Hand"] ?? 0;
    const market = r.fields["Market Price"] ?? 0;
    const buy = r.fields["Buy Price"] ?? 0;
    sealedUnits += qty;
    sealedMarket += market * qty;
    sealedCost += buy * qty;
    if (qty > 0 && !(buy > 0)) sealedNeedBuy++;
    if (qty > 0 && !(market > 0)) sealedUnpriced++;
    const cat = r.fields["Category"]?.name || r.fields["Category"] || "Other";
    const c = byCategory.get(cat) || { units: 0, market: 0 };
    c.units += qty; c.market += market * qty;
    byCategory.set(cat, c);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1].market - a[1].market);

  // ---- singles ----
  const singles = singlesRows.map((r) => toSingle(r, true));
  const inStock = singles.filter((s: any) => s.status === "In Stock" || s.status === "In Stream");
  const sold = singles.filter((s: any) => s.status === "Sold");
  const singlesMarket = inStock.reduce((a: number, s: any) => a + (s.comp || 0) * (s.qty || 1), 0);
  const singlesCost = inStock.reduce((a: number, s: any) => a + (s.buy || 0) * (s.qty || 1), 0);
  const soldRevenue = sold.reduce((a: number, s: any) => a + (s.salePrice || 0), 0);
  const soldProfit = sold.reduce((a: number, s: any) => a + ((s.salePrice || 0) - (s.buy || 0)) * (s.qty || 1), 0);
  const thinComps = inStock.filter(
    (s: any) => (Array.isArray(s.compDetail) && s.compDetail.length < 4) || (s.comp !== null && String(s.compSource).includes("est."))
  ).length;
  const topCards = [...inStock].sort((a: any, b: any) => (b.comp || 0) - (a.comp || 0)).slice(0, 5);

  // singles sales by week, last 8 weeks
  const weeks: { start: string; total: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i * 7);
    weeks.push({ start: weekStartOf(d.toISOString().slice(0, 10)), total: 0 });
  }
  for (const s of sold as any[]) {
    if (!s.soldDate || !s.salePrice) continue;
    const ws = weekStartOf(s.soldDate);
    const w = weeks.find((x) => x.start === ws);
    if (w) w.total += s.salePrice;
  }
  const maxWeek = Math.max(1, ...weeks.map((w) => w.total));

  // ---- streams ----
  const nameById: Record<string, string> = {}, rateById: Record<string, number> = {}, overrideById: Record<string, number> = {};
  for (const s of streamerRows) {
    nameById[s.id] = s.fields["Name"] || "Streamer";
    if (typeof s.fields["Hourly Rate"] === "number") rateById[s.id] = s.fields["Hourly Rate"];
    if (typeof s.fields["Override %"] === "number") overrideById[s.id] = s.fields["Override %"];
  }
  const costByStream: Record<string, number> = {}, marketCostByStream: Record<string, number> = {};
  for (const l of lineRows) {
    const sid = l.fields["Stream Rec Id"];
    if (!sid) continue;
    const line = toLine(l);
    costByStream[sid] = (costByStream[sid] || 0) + line.qty * line.buy;
    marketCostByStream[sid] = (marketCostByStream[sid] || 0) + line.qty * line.market;
  }
  const rows: StreamRow[] = streamRows.map((r: any) => ({
    id: r.id,
    date: r.fields["Stream Date"],
    streamerId: r.fields["Streamer Rec Id"] || "unknown",
    streamerName: nameById[r.fields["Streamer Rec Id"]] || "Streamer",
    afterFees: r.fields["After Fees"] || 0,
    giveaways: r.fields["Giveaways Run"] || 0,
    promotion: r.fields["Promotion"] || 0,
    tips: r.fields["Tips"] || 0,
    hours: r.fields["Hours Streamed"] || 0,
    packingHours: r.fields["Packing Hours"] || 0,
    managerPackingHours: r.fields["Manager Packing Hours"] || 0,
    managerId: r.fields["Manager Rec Id"] || null,
    productCost: costByStream[r.id] || 0,
    productMarketCost: marketCostByStream[r.id] || 0,
    status: r.fields["Status"] || "Planned",
  }));

  const cutoff30 = new Date(); cutoff30.setDate(cutoff30.getDate() - 30);
  const recent = rows.filter((r) => r.status === "Complete" && r.date && new Date(r.date) >= cutoff30);
  const streamRevenue = recent.reduce((a, r) => a + r.afterFees, 0);
  const streamGross = recent.reduce(
    (a, r) => a + (r.afterFees - r.promotion - r.tips - (r.giveaways || 0) * settings.giveaway_cost - r.productCost),
    0
  );
  const planned = rows.filter((r) => r.status !== "Complete").length;

  // labor owed this week
  const thisWeek = weekStartOf(new Date().toISOString().slice(0, 10));
  const pay = buildWeekPay(rows, settings, rateById).filter((w) => w.weekStart === thisWeek);
  const mgr = buildManagerPay(rows, settings, overrideById, nameById, rateById).filter((w) => w.weekStart === thisWeek);
  const laborThisWeek = pay.reduce((a, w) => a + w.totalPay, 0) + mgr.reduce((a, w) => a + w.totalPay, 0);

  const totalMarket = sealedMarket + singlesMarket;
  const totalCost = sealedCost + singlesCost;

  const alerts: { text: string; href: string }[] = [];
  if (sealedNeedBuy > 0) alerts.push({ text: `${sealedNeedBuy} sealed products need a buy price`, href: "/admin/inventory" });
  if (sealedUnpriced > 0) alerts.push({ text: `${sealedUnpriced} sealed products have no market price`, href: "/admin/inventory" });
  if (thinComps > 0) alerts.push({ text: `${thinComps} singles have thin or estimated comps`, href: "/singles" });
  if (planned > 0) alerts.push({ text: `${planned} streams planned or awaiting results`, href: "/admin/streams" });

  return (
    <>
      <Nav isAdmin name={me.streamer?.fields?.["Name"] || "Admin"} />
      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Vendor dashboard</h1>
          <span className="text-dim text-sm">The whole operation at a glance</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ValueDelta snaps={snaps} fallback={totalMarket} label="Inventory market value" sub={`${$0(sealedMarket)} sealed - ${$0(singlesMarket)} singles`} />
          <Tile label="Cost basis" value={$0(totalCost)} sub="what you paid for what you hold" />
          <Tile label="Unrealized est. profit" value={$0(totalMarket - totalCost)} tone={totalMarket - totalCost >= 0 ? "text-win" : "text-bad"} sub="market minus cost, on hand" />
          <Tile label="Singles sold to date" value={$0(soldRevenue)} sub={`${sold.length} sales - ${$0(soldProfit)} profit`} tone="text-win" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Streams - 30 day revenue" value={$0(streamRevenue)} sub={`${recent.length} completed streams`} />
          <Tile label="Streams - 30 day gross" value={$0(streamGross)} tone={streamGross >= 0 ? "text-win" : "text-bad"} sub="after fees, promo, giveaways, product cost - before labor" />
          <Tile label="Labor owed this week" value={$0(laborThisWeek)} sub="streamer + manager pay, live" />
          <Tile label="Sealed on hand" value={String(sealedUnits)} sub={`${inStock.reduce((a: number, s: any) => a + (s.qty || 1), 0)} singles in stock`} />
        </div>

        {alerts.length > 0 && (
          <section className="card p-4">
            <div className="label mb-2">Needs attention</div>
            <div className="flex flex-wrap gap-2">
              {alerts.map((a) => (
                <Link key={a.text} href={a.href} className="text-amber-400 text-xs border border-amber-400/30 bg-amber-400/5 rounded-full px-3 py-1.5 hover:bg-amber-400/10">
                  {a.text}
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <section className="card p-5">
            <div className="label mb-3">Portfolio value - nightly reprices</div>
            <TrendChart snaps={snaps} />
          </section>
          <TopMovers snaps={snaps} />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <section className="card p-5">
            <div className="label mb-3">Singles sales - last 8 weeks</div>
            <div className="flex items-end gap-2 h-36">
              {weeks.map((w) => (
                <div key={w.start} className="flex-1 flex flex-col items-center gap-1">
                  <div className="num text-[10px] text-dim">{w.total > 0 ? $0(w.total) : ""}</div>
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${Math.max(3, (w.total / maxWeek) * 100)}%`,
                      background: w.total > 0 ? "linear-gradient(180deg, #7aa2ff, #58e6d9)" : "#262B38",
                    }}
                  />
                  <div className="text-dim text-[10px]">{w.start.slice(5)}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <div className="label mb-3">Top singles in stock</div>
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
              {topCards.length === 0 && <div className="text-dim text-sm">No singles in stock yet</div>}
            </div>
          </section>
        </div>

        <section className="card p-5">
          <div className="label mb-3">Sealed value by category</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th>Category</th><th>Units</th><th>Market value</th><th>Share</th></tr></thead>
              <tbody>
                {categories.map(([cat, c]) => (
                  <tr key={cat}>
                    <td className="!font-medium">{cat}</td>
                    <td>{c.units}</td>
                    <td>{$(c.market)}</td>
                    <td>
                      <div className="w-32 h-2 rounded bg-edge overflow-hidden">
                        <div className="h-full" style={{ width: `${sealedMarket ? (c.market / sealedMarket) * 100 : 0}%`, background: "linear-gradient(90deg, #58e6d9, #7aa2ff)" }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
