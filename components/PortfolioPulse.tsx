import Thumb from "@/components/Thumb";
import { Snapshot, topMovers } from "@/lib/priceRefresh";

const $ = (n: number) =>
  "$" + Math.abs(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $0 = (n: number) => "$" + Math.round(Math.abs(n || 0)).toLocaleString("en-US");

// Pure-SVG area chart of portfolio value over the snapshot history.
export function TrendChart({ snaps }: { snaps: Snapshot[] }) {
  if (snaps.length < 2) {
    return (
      <div className="h-40 flex items-center justify-center text-dim text-sm">
        {snaps.length === 1
          ? "First snapshot recorded today - the trend line starts with tomorrow's overnight reprice."
          : "No snapshots yet - the nightly reprice records the first one."}
      </div>
    );
  }
  const W = 600, H = 150, PAD = 6;
  const vals = snaps.map((s) => s.total);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const x = (i: number) => PAD + (i / (snaps.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `${PAD},${H - PAD} ${pts} ${W - PAD},${H - PAD}`;
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" preserveAspectRatio="none">
        <defs>
          <linearGradient id="trendfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? "#3ECF8E" : "#F0625D"} stopOpacity="0.35" />
            <stop offset="100%" stopColor={up ? "#3ECF8E" : "#F0625D"} stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="trendline" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#58e6d9" />
            <stop offset="50%" stopColor="#7aa2ff" />
            <stop offset="100%" stopColor={up ? "#3ECF8E" : "#c084fc"} />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#trendfill)" />
        <polyline points={pts} fill="none" stroke="url(#trendline)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r="4" fill={up ? "#3ECF8E" : "#F0625D"} />
      </svg>
      <div className="flex justify-between text-dim text-[10px] mt-1">
        <span>{snaps[0].date}</span>
        <span>{snaps[snaps.length - 1].date}</span>
      </div>
    </div>
  );
}

// Big value + day-over-day delta with arrow, dollar amount, and percent.
export function ValueDelta({ snaps, fallback, label, sub }: { snaps: Snapshot[]; fallback: number; label: string; sub?: string }) {
  const latest = snaps[snaps.length - 1];
  const prev = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
  const value = latest ? latest.total : fallback;
  let deltaEl = <div className="text-dim text-xs mt-1">{sub || "day-over-day trend starts after the next overnight reprice"}</div>;
  if (prev && latest) {
    const d = latest.total - prev.total;
    const pct = prev.total > 0 ? (d / prev.total) * 100 : 0;
    const up = d >= 0;
    deltaEl = (
      <div className={`text-sm mt-1 font-semibold num ${up ? "text-win" : "text-bad"}`}>
        {up ? "\u25B2" : "\u25BC"} {$(d)} ({up ? "+" : "-"}{Math.abs(pct).toFixed(1)}%)
        <span className="text-dim font-normal text-xs"> vs {prev.date}</span>
      </div>
    );
  }
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="num text-3xl font-bold mt-1 holo-text inline-block">{$0(value)}</div>
      {deltaEl}
    </div>
  );
}

// The cards that moved most since the previous snapshot.
export function TopMovers({ snaps }: { snaps: Snapshot[] }) {
  if (snaps.length < 2) return null;
  const movers = topMovers(snaps[snaps.length - 2], snaps[snaps.length - 1], 3);
  if (movers.length === 0) return null;
  return (
    <section className="card p-5">
      <div className="label mb-3">Top movers - since {snaps[snaps.length - 2].date}</div>
      <div className="space-y-2">
        {movers.map((m) => (
          <div key={m.key} className="flex items-center gap-3">
            {m.img && <Thumb src={m.img} size={30} />}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{m.n}</div>
              <div className="text-dim text-xs num">{$(m.from)} {"\u2192"} {$(m.to)}</div>
            </div>
            <span className={`num ml-auto font-semibold ${m.delta >= 0 ? "text-win" : "text-bad"}`}>
              {m.delta >= 0 ? "\u25B2" : "\u25BC"} {$(m.delta)} ({m.delta >= 0 ? "+" : "-"}{Math.abs(m.pct)}%)
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// Spotlight for the single most valuable card, art forward.
export function HeroCard({ card }: { card: { name: string; setName: string; condition: string; comp: number | null; image: string } | null }) {
  if (!card) return null;
  return (
    <section className="card p-5 flex items-center gap-5 overflow-hidden relative">
      {card.image && (
        <img
          src={card.image}
          alt=""
          className="h-40 rounded-lg shrink-0"
          style={{ boxShadow: "0 12px 40px rgba(122,162,255,.25)" }}
        />
      )}
      <div className="min-w-0">
        <div className="label">Crown jewel</div>
        <div className="text-xl font-bold mt-1 truncate" style={{ fontFamily: "var(--font-display)" }}>{card.name}</div>
        <div className="text-dim text-sm">{card.setName} - {card.condition}</div>
        {card.comp !== null && <div className="num text-2xl font-bold holo-text inline-block mt-2">{$(card.comp)}</div>}
      </div>
    </section>
  );
}
