"use client";
import { useRef, useState } from "react";

// A tiny colored triangle beside a price. All the detail - dollar change,
// percent, and the benchmark date - lives in the hover panel, keeping the
// table itself quiet.
export default function DeltaHover({
  current,
  entry,
  date,
  label = "since",
}: {
  current: number | null;
  entry: number | null;
  date?: string;
  label?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (current === null || !entry || entry <= 0) return null;
  const delta = current - entry;
  if (Math.abs(delta) < 0.01) return null;
  const up = delta >= 0;
  const pct = (delta / entry) * 100;

  const open = (e: React.MouseEvent) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (!pos) setPos({ x: e.clientX, y: e.clientY });
  };
  const close = () => {
    closeTimer.current = setTimeout(() => setPos(null), 120);
  };

  return (
    <span onMouseEnter={open} onMouseLeave={close} className="relative inline-block">
      <span className={`text-[10px] cursor-help ${up ? "text-win" : "text-bad"}`}>
        {up ? "\u25B2" : "\u25BC"}
      </span>
      {pos && (
        <span
          className="fixed z-50 block rounded-lg border border-edge bg-panel shadow-2xl px-3 py-2 whitespace-nowrap"
          style={{
            left: Math.min(pos.x + 10, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240),
            top: Math.max(8, pos.y - 44),
          }}
        >
          <span className={`num text-sm font-semibold ${up ? "text-win" : "text-bad"}`}>
            {up ? "\u25B2" : "\u25BC"} ${Math.abs(delta).toFixed(2)} ({up ? "+" : "-"}{Math.abs(pct).toFixed(1)}%)
          </span>
          <span className="block text-dim text-xs mt-0.5">
            {label} {date || "entry"} at ${entry.toFixed(2)}
          </span>
        </span>
      )}
    </span>
  );
}
