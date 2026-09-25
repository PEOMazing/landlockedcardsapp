"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// The OBS card board.
//
// Built for a Browser Source, which means a few things this codebase does not
// normally have to care about:
//
//   - the background is transparent, so whatever is behind it in OBS shows
//     through. No page chrome, no panel, no scrollbars.
//   - nobody can click it. Everything is driven by polling.
//   - it has to survive being left running for four hours.
//
// Tiles size themselves to the count. Twenty cards left is a wall of small
// art; three cards left is three enormous ones. That is the behaviour worth
// having on stream, because the board gets more readable exactly as the
// remaining cards get more interesting.

type Card = { id: string; image: string; thumb: string; left: number; shiny?: boolean };

const POLL_MS = 3000;

// Banner scroll speed, pixels a second. Slow enough to read a card as it goes
// past and fast enough that a short board does not look frozen.
const BANNER_PX_PER_SEC = 70;

// Pokemon card art is 734x1024, near enough to 5:7.
const CARD_RATIO = 5 / 7;

// Fit n tiles of a fixed aspect ratio into a box and hand back the column
// count that makes them biggest. Pure arithmetic rather than a CSS guess,
// because "as large as will fit" is the entire brief and grid auto-fit cannot
// express it.
function bestColumns(n: number, w: number, h: number, gap: number): number {
  if (n <= 0 || w <= 0 || h <= 0) return 1;
  let best = 1;
  let bestSide = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const tileW = (w - gap * (cols - 1)) / cols;
    const tileH = (h - gap * (rows - 1)) / rows;
    if (tileW <= 0 || tileH <= 0) continue;
    // the limiting dimension decides how big the art actually renders
    const side = Math.min(tileW, tileH * CARD_RATIO);
    if (side > bestSide) { bestSide = side; best = cols; }
  }
  return best;
}

export default function OverlayClient({ apiKey }: { apiKey: string }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [layout, setLayout] = useState<"grid" | "banner">("grid");
  const [speed, setSpeed] = useState(1);
  const [gone, setGone] = useState(false);
  const [size, setSize] = useState({ w: 1920, h: 980 });
  const gridRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/public/overlay/${apiKey}`, { cache: "no-store" });
      if (r.status === 404) { setGone(true); return; }
      if (!r.ok) return;
      const d = await r.json();
      setGone(false);
      setLayout(d.layout === "banner" ? "banner" : "grid");
      setSpeed(Number(d.speed) > 0 ? Number(d.speed) : 1);
      setCards(Array.isArray(d.cards) ? d.cards : []);
    } catch {
      // A blip on someone's home wifi should leave the last good board on
      // screen, not blank it. The next tick will catch up.
    }
  }, [apiKey]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Measured off the grid rather than the window, because the banner takes a
  // slice off the top and tiles sized to the whole viewport would overflow it.
  useEffect(() => {
    const measure = () => {
      const el = gridRef.current;
      if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    const t = setInterval(measure, 1000); // the banner appearing changes the box
    return () => { window.removeEventListener("resize", measure); clearInterval(t); };
  }, []);

  // One tile per remaining copy, so a line holding three chances looks like
  // three chances.
  const tiles: Card[] = [];
  for (const c of cards || []) {
    for (let i = 0; i < Math.max(1, c.left); i++) tiles.push({ ...c, id: `${c.id}:${i}` });
  }

  const gap = tiles.length > 24 ? 8 : tiles.length > 8 ? 14 : 22;
  const cols = bestColumns(tiles.length, size.w, size.h, gap);
  const empty = gone || tiles.length === 0;

  // Banner geometry. Tile width follows the strip height, so the whole thing
  // scales with whatever size the Browser Source is set to - 1920x400 gives a
  // lower third, 1920x1080 gives very large cards.
  const bannerTileW = Math.max(1, (size.h - gap * 2) * CARD_RATIO);
  const runWidth = tiles.length * (bannerTileW + gap);
  // Nothing to scroll when the whole board already fits. Motion for its own
  // sake is just something else for a viewer to track.
  const scrolls = runWidth > size.w;
  // Speed is a multiplier on the pace, so doubling it halves the time a full
  // run takes. The floor keeps a two-card board from becoming a blur.
  const duration = Math.max(4, runWidth / (BANNER_PX_PER_SEC * speed));

  const tile = (c: Card, i: number, w?: number) => (
    <div
      key={c.id}
      style={{
        position: "relative",
        height: "100%",
        width: w,
        aspectRatio: w ? undefined : String(CARD_RATIO),
        flex: w ? "0 0 auto" : undefined,
        maxWidth: w ? undefined : "100%",
        // The card art is the thing; the glow just lifts it off whatever
        // is behind it in the scene so it does not disappear into a busy
        // background.
        filter: c.shiny
          ? "drop-shadow(0 0 14px rgba(255,215,120,.45)) drop-shadow(0 0 10px rgba(0,0,0,.85)) drop-shadow(0 4px 18px rgba(0,0,0,.6))"
          : "drop-shadow(0 0 10px rgba(0,0,0,.85)) drop-shadow(0 4px 18px rgba(0,0,0,.6))",
        animation: "llcIn .35s ease-out",
      }}
    >
      {/* The foil layers are siblings of the art, all clipped to the same
          rounded rectangle, so they sit on the card rather than around it.
          The stagger is a negative delay, which starts each card partway
          through its loop: without it forty cards tilt and flash in perfect
          unison, which looks like a screen fault rather than foil. */}
      <div
        className={c.shiny ? "llc-card llc-tilt" : "llc-card"}
        style={{ ["--d" as any]: `${((i % 7) * 0.83).toFixed(2)}s` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={c.image}
          alt=""
          // The big art is a rewrite of the stored URL, so a size this CDN
          // does not happen to have must fall back rather than leave a hole
          // on stream. Guarded so a broken thumbnail cannot loop.
          onError={(e) => {
            const el = e.currentTarget;
            if (c.thumb && el.src !== c.thumb) el.src = c.thumb;
          }}
          style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "4%" }}
        />
        {c.shiny && (
          <>
            <span className="llc-holo" />
            <span className="llc-sparkle" />
            <span className="llc-glarewrap">
              <span className="llc-glare" />
            </span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "transparent",
        overflow: "hidden",
      }}
    >
      {/* Nothing at all when the board is empty. A banner over an empty scene
          announcing hits that do not exist is worse than no banner. */}
      {!empty && (
        <div
          style={{
            flex: "0 0 auto",
            textAlign: "center",
            padding: "1.4vh 0 0.6vh",
            fontFamily: '"Space Grotesk", Inter, system-ui, sans-serif',
            fontWeight: 700,
            fontSize: "clamp(22px, 5.2vh, 74px)",
            letterSpacing: ".06em",
            lineHeight: 1,
            color: "#FFE9A8",
            // Heavy outline and glow rather than a panel behind it, so it stays
            // readable over a bright card or a busy scene without putting an
            // opaque bar across the shot.
            textShadow:
              "0 0 6px rgba(0,0,0,.95), 0 0 18px rgba(0,0,0,.8), 0 3px 0 rgba(0,0,0,.85), 0 0 46px rgba(245,196,81,.55)",
            WebkitTextStroke: "1px rgba(0,0,0,.55)",
            animation: "llcFlash 1.15s ease-in-out infinite",
            whiteSpace: "nowrap",
          }}
        >
          HITS STILL LIVE
        </div>
      )}

      <div
        ref={gridRef}
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          ...(layout === "banner"
            ? { overflow: "hidden", position: "relative" }
            : {
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridAutoRows: "1fr",
                gap,
                padding: gap,
                placeItems: "center",
              }),
        }}
      >
        {layout === "banner" ? (
          // Two copies of the run, translated by exactly half. When the first
          // copy has walked off the left the second is sitting where it
          // started, so the loop has no seam and no jump.
          <div
            style={{
              display: "flex",
              height: "100%",
              width: "max-content",
              padding: gap,
              gap,
              animation: scrolls ? `llcScroll ${duration}s linear infinite` : undefined,
              justifyContent: scrolls ? undefined : "center",
            }}
          >
            {tiles.map((c, i) => tile(c, i, bannerTileW))}
            {scrolls && tiles.map((c, i) => tile({ ...c, id: c.id + ":b" }, i, bannerTileW))}
          </div>
        ) : (
          tiles.map((c, i) => tile(c, i))
        )}
      </div>

      <style>{`
        html, body { background: transparent !important; margin: 0; overflow: hidden; }
        @keyframes llcIn { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
        @keyframes llcScroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes llcFlash {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: .45; transform: scale(.985); }
        }

        /* ---- foil ----------------------------------------------------- */
        /* Four layers over the art, the way a real holo reads: the card
           turns, a hard specular band runs across it, a rainbow sits in the
           surface and shifts as it turns, and glitter catches the light.
           Every one of them is a transform or an opacity so the GPU does the
           work - OBS renders these frames on the same machine that is
           encoding the stream, and a layout-thrashing effect would cost
           dropped frames, which viewers notice long before they notice
           a card looking flat. */
        .llc-card { position: relative; width: 100%; height: 100%; }
        .llc-card > span { position: absolute; inset: 0; border-radius: 4%; pointer-events: none; }

        .llc-tilt {
          animation: llcTilt 5.6s ease-in-out infinite;
          animation-delay: calc(var(--d, 0s) * -1);
          will-change: transform;
        }
        @keyframes llcTilt {
          0%, 100% { transform: perspective(1000px) rotateY(-8deg) rotateX(3.5deg); }
          50%      { transform: perspective(1000px) rotateY(8deg) rotateX(-3.5deg); }
        }

        /* Overlay rather than screen: it tints the art and keeps its
           contrast, where screen washes a dark card out to pastel. */
        .llc-holo {
          background: linear-gradient(115deg,
            rgba(255,0,140,.65) 0%, rgba(255,190,0,.60) 18%, rgba(70,255,190,.60) 36%,
            rgba(0,170,255,.65) 54%, rgba(180,60,255,.60) 72%, rgba(255,0,140,.65) 100%);
          background-size: 260% 260%;
          mix-blend-mode: overlay;
          /* Low. At anything like full strength the rainbow stops reading as
             a sheen on the surface and starts reading as a colour filter over
             the art, and a purple Espeon is not what anybody is spinning for. */
          opacity: .24;
          animation: llcHolo 7.2s ease-in-out infinite;
          animation-delay: calc(var(--d, 0s) * -1);
        }
        @keyframes llcHolo {
          0%, 100% { background-position: 0% 50%; }
          50%      { background-position: 100% 50%; }
        }

        /* Two grids of specks rather than one. A single tiled gradient is a
           perfectly regular dot grid, and the eye finds it instantly - it
           reads as a dirty lens, not as glitter. Two layers at sizes that do
           not divide into each other, drifting in different directions, never
           line up long enough to look like a pattern. */
        .llc-sparkle {
          background-image:
            radial-gradient(circle, rgba(255,255,255,.90) .4px, transparent 1px),
            radial-gradient(circle, rgba(255,255,255,.55) .5px, transparent 1.7px);
          background-size: 9.7% 6.3%, 17.3% 12.9%;
          mix-blend-mode: screen;
          animation: llcSparkle 3.4s ease-in-out infinite;
          animation-delay: calc(var(--d, 0s) * -1);
        }
        @keyframes llcSparkle {
          0%, 100% { opacity: .05; background-position: 0% 0%, 40% 20%; }
          50%      { opacity: .21; background-position: 25% 18%, 12% 44%; }
        }

        /* The band is wider and taller than the card and runs off both
           edges, so the sweep has no visible start or stop. */
        .llc-glarewrap { overflow: hidden; }
        .llc-glare {
          position: absolute;
          top: -40%; bottom: -40%; left: 0; width: 38%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.85), transparent);
          filter: blur(7px);
          mix-blend-mode: screen;
          transform: rotate(16deg) translateX(-300%);
          animation: llcGlare 4.4s ease-in-out infinite;
          animation-delay: calc(var(--d, 0s) * -1);
          will-change: transform;
        }
        @keyframes llcGlare {
          0%        { transform: rotate(16deg) translateX(-300%); }
          45%, 100% { transform: rotate(16deg) translateX(420%); }
        }

        /* OBS respects this, and a banner that stops moving is better than one
           that makes somebody ill. */
        @media (prefers-reduced-motion: reduce) {
          [style*="llcFlash"] { animation: none !important; }
          .llc-tilt, .llc-holo, .llc-sparkle, .llc-glare { animation: none !important; }
          .llc-holo, .llc-sparkle, .llc-glare { opacity: .18; }
        }
      `}</style>
    </div>
  );
}
