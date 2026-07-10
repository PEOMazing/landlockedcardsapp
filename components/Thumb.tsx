"use client";
import { useState } from "react";

// Small product thumbnail that shows a large floating preview on hover.
// Fixed positioning follows the cursor so it never gets clipped by
// scrollable table containers. TCGplayer CDN thumbs get swapped to the
// higher resolution variant for the preview.
export default function Thumb({
  src,
  size = 32,
  className = "",
}: {
  src: string;
  size?: number;
  className?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!src) return null;
  const big = src.includes("_200w") ? src.replace("_200w", "_400w") : src;

  // keep the preview on screen: flip to the left of the cursor near the right edge
  const previewW = 260;
  const style = pos
    ? {
        left: Math.min(pos.x + 18, (typeof window !== "undefined" ? window.innerWidth : 1200) - previewW - 12),
        top: Math.max(12, Math.min(pos.y - 60, (typeof window !== "undefined" ? window.innerHeight : 800) - 320)),
      }
    : undefined;

  return (
    <>
      <img
        src={src}
        alt=""
        loading="lazy"
        width={size}
        height={size}
        className={`object-contain rounded-sm bg-white/5 inline-block align-middle ${className}`}
        style={{ width: size, height: size }}
        onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setPos(null)}
      />
      {pos && (
        <img
          src={big}
          alt=""
          className="fixed z-50 pointer-events-none rounded-lg border border-edge bg-panel shadow-2xl p-2"
          style={{ ...style, width: previewW, maxHeight: 320, objectFit: "contain" }}
        />
      )}
    </>
  );
}
