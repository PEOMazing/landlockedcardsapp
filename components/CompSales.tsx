"use client";
import { useRef, useState } from "react";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CONDITION_FULL: Record<string, string> = {
  NM: "Near Mint", Raw: "Near Mint", LP: "Lightly Played",
  MP: "Moderately Played", HP: "Heavily Played", DM: "Damaged",
};

type Sale = { date: string; price: number; qty: number };

// Small "{n} solds" chip. Hovering it opens a panel listing every sale the
// comp median was computed from, with a link to the card's TCGplayer page
// filtered to that condition (their Latest Sales panel shows the same data).
export default function CompSales({
  detail,
  condition,
  productId,
}: {
  detail: Sale[];
  condition: string;
  productId: number | null;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!Array.isArray(detail) || detail.length === 0) return null;

  const open = (e: React.MouseEvent) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (!pos) setPos({ x: e.clientX, y: e.clientY });
  };
  const close = () => {
    closeTimer.current = setTimeout(() => setPos(null), 180);
  };

  const thin = detail.length < 4; // 1-3 sales is shaky ground for a comp

  const url = productId
    ? `https://www.tcgplayer.com/product/${productId}?Language=English&Condition=${encodeURIComponent(CONDITION_FULL[condition] || "Near Mint")}`
    : null;

  const style = pos
    ? {
        left: Math.min(pos.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300),
        top: Math.max(12, Math.min(pos.y - 40, (typeof window !== "undefined" ? window.innerHeight : 800) - 320)),
      }
    : undefined;

  return (
    <span onMouseEnter={open} onMouseLeave={close} className="relative">
      <span
        className={`text-xs cursor-help whitespace-nowrap underline decoration-dotted ${
          thin ? "text-amber-400" : "text-dim"
        }`}
      >
        {detail.length} sold{detail.length > 1 ? "s" : ""}
      </span>
      {pos && (
        <span
          className="fixed z-50 block w-72 rounded-lg border border-edge bg-panel shadow-2xl p-3 space-y-1"
          style={style}
          onMouseEnter={open}
          onMouseLeave={close}
        >
          <span className="block label">Comp basis - {condition} sales</span>
          {detail.map((x, i) => (
            <span key={i} className="flex justify-between text-xs">
              <span className="text-dim">{x.date}{x.qty > 1 ? ` x${x.qty}` : ""}</span>
              <span className="num">{$(x.price)}</span>
            </span>
          ))}
          <span className="block text-dim text-xs pt-1 border-t border-edge">
            Comp = median of these sales
          </span>
          {thin && (
            <span className="block text-amber-400 text-xs font-semibold">
              Thin data: only {detail.length} recent sale{detail.length > 1 ? "s" : ""} in this condition. Verify before pricing.
            </span>
          )}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="block text-foil text-xs hover:underline">
              View on TCGplayer ({CONDITION_FULL[condition] || condition}) &#8599;
            </a>
          )}
        </span>
      )}
    </span>
  );
}
