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

// How long each headline holds before the other takes over. Long enough to
// read twice at a glance, short enough that somebody arriving mid-stream sees
// both within a few seconds.
const HEADLINE_MS = 2600;

// Six dry spins is a full blaze. Mirrors HEAT_MAX in lib/overlay, which is
// where the rule actually lives - this is only a guard on what arrives.
const HEAT_MAX = 6;

// Banner scroll speed, pixels a second. Slow enough to read a card as it goes
// past and fast enough that a short board does not look frozen.
const BANNER_PX_PER_SEC = 70;

// Fixed particle counts. Rendered once and driven entirely by CSS off their
// index, so a change in heat never remounts them - a remount would restart
// every animation at the same instant and the fire would visibly hiccup on
// the spin that lit it.
const SMOKE = [0, 1, 2, 3, 4, 5];
const FLAMES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const SPARKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

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
  const [scale, setScale] = useState(1);
  // The dry streak the streamer is tallying, and the banner's temperature.
  const [spins, setSpins] = useState(0);
  const [heat, setHeat] = useState(0);
  // Which of the two headlines is up right now.
  const [alt, setAlt] = useState(false);
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
      setScale(Number(d.scale) > 0 ? Number(d.scale) : 1);
      setSpins(Math.max(0, Number(d.spins) || 0));
      setHeat(Math.max(0, Math.min(HEAT_MAX, Number(d.heat) || 0)));
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

  // Swap the headline back and forth. Off entirely on a fresh streak: "0 spins
  // since last hit" is a true sentence that says nothing, and half the banner's
  // airtime is too expensive to spend on it.
  useEffect(() => {
    if (spins <= 0) { setAlt(false); return; }
    const t = setInterval(() => setAlt((v) => !v), HEADLINE_MS);
    return () => clearInterval(t);
  }, [spins]);

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

  // What the headline counts. One per remaining copy, same as the tiles, so
  // the number in the words and the number of pictures under them can never
  // disagree - a viewer reading "4 HITS STILL LIVE" over three cards would
  // rightly assume one is being hidden from them.
  const liveCount = tiles.length;

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
        top: 0,
        left: 0,
        right: 0,
        // Height only. The board keeps the full width of the Browser Source
        // and gives back height, which is the axis that was crowding the
        // scene. A uniform transform would have shrunk the width too and left
        // a narrow strip floating in the middle of the shot.
        //
        // This is a smaller layout box, not a scaled-down picture of a big
        // one: everything inside measures the box it is actually in, so the
        // banner still fills the width and simply fits more, smaller cards
        // across it. Nothing is stretched to fit, so nothing squashes - the
        // tiles hold 5:7 off their own height and the art is object-fit
        // contain on top of that, which is two independent guarantees.
        height: scale === 1 ? "100%" : `${Math.round(scale * 10000) / 100}%`,
        display: "flex",
        flexDirection: "column",
        background: "transparent",
        overflow: "hidden",
        // The headline is the one thing that does not size itself off the box,
        // because it is text. Tying it to the scale keeps it in the same
        // proportion to the cards it sits above at every size.
        ["--s" as any]: scale,
      }}
    >
      {/* Nothing at all when the board is empty. A banner over an empty scene
          announcing hits that do not exist is worse than no banner. */}
      {!empty && (
        <div className="llc-headwrap" style={{ ["--h" as any]: heat }}>
          {/* One shrink-wrapped box around the words, so every layer below
              sizes and positions itself against the text rather than against
              the full width of the scene. Sized in em off the headline's own
              font-size, which means the fire scales with the words at any
              Browser Source height instead of needing numbers per size.

              Back to front: ember glow, smoke, flame tongues, the words, then
              sparks and lightning over the top. Each layer fades in off the
              same --h, so there is one dial and no stage-by-stage branching. */}
          <span className="llc-headline">
            <span className="llc-ember" />
            {heat >= 1 && (
              <span className="llc-smoke">
                {SMOKE.map((i) => <i key={i} style={{ ["--i" as any]: i }} />)}
              </span>
            )}
            {heat >= 3 && (
              <span className="llc-fire">
                {FLAMES.map((i) => <i key={i} style={{ ["--i" as any]: i }} />)}
              </span>
            )}

            <span className="llc-words">
              {spins > 0 && alt
                ? `${spins} SPIN${spins === 1 ? "" : "S"} SINCE LAST HIT`
                : `${liveCount} HIT${liveCount === 1 ? "" : "S"} LIVE!`}
            </span>

            {heat >= 2 && (
              <span className="llc-sparks">
                {SPARKS.map((i) => <i key={i} style={{ ["--i" as any]: i }} />)}
              </span>
            )}
            {heat >= 4 && (
              <>
                <span className="llc-flash" />
                <svg className="llc-bolt" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden>
                  <path d="M15 0 L8 18 L17 18 L5 42 L11 22 L2 22 Z" />
                  <path d="M87 3 L80 20 L89 20 L77 42 L83 25 L74 25 Z" />
                </svg>
              </>
            )}
          </span>
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

        /* ---- the banner, and how it catches fire -----------------------
           Everything here reads off --h, the dry-spin count clamped to 0-6.
           Nothing is keyed to a specific stage: each layer sets its own
           opacity and size as a function of --h, so the banner ramps
           continuously instead of jumping between six hand-drawn looks, and
           there is one number to change to retune the whole thing.

           All sizes are in em against the headline's own font-size. The
           Browser Source can be 1920x400 or full canvas and the fire stays in
           proportion to the words - percentages of the wrapper do not, because
           the wrapper is as wide as the scene and only as tall as one line.

           --h is 0 for most of a good show, and at 0 every layer here
           resolves to zero opacity or zero amplitude. The calm banner is the
           same banner, not a different branch. */
        .llc-headwrap {
          position: relative;
          flex: 0 0 auto;
          padding: 1.4vh 0 0.6vh;
          text-align: center;
          /* Shake amplitude and lean, both linear in heat. At --h 0 they are
             0px and 0deg, which makes the shake a no-op rather than something
             that has to be switched off. */
          --shake: calc(var(--h, 0) * 0.62px);
          --lean: calc(var(--h, 0) * 0.06deg);
          animation: llcShake .17s linear infinite;
        }
        @keyframes llcShake {
          0%   { transform: translate(calc(var(--shake) * -1), 0) rotate(calc(var(--lean) * -1)); }
          25%  { transform: translate(var(--shake), calc(var(--shake) * -.6)) rotate(var(--lean)); }
          50%  { transform: translate(calc(var(--shake) * -.7), var(--shake)) rotate(0deg); }
          75%  { transform: translate(calc(var(--shake) * .8), calc(var(--shake) * -.3)) rotate(var(--lean)); }
          100% { transform: translate(calc(var(--shake) * -1), 0) rotate(calc(var(--lean) * -1)); }
        }

        .llc-headline {
          position: relative;
          display: inline-block;
          font-family: "Space Grotesk", Inter, system-ui, sans-serif;
          font-weight: 700;
          font-size: clamp(15px, calc(var(--s, 1) * 5.2vh), 74px);
          letter-spacing: .06em;
          line-height: 1;
          white-space: nowrap;
        }

        .llc-words {
          position: relative;
          z-index: 3;
          color: #FFE9A8;
          /* Heavy outline and glow rather than a panel behind it, so it stays
             readable over a bright card or a busy scene without putting an
             opaque bar across the shot. The last stop grows with the heat, so
             the words themselves go from gold to white-hot. */
          text-shadow:
            0 0 6px rgba(0,0,0,.95), 0 0 18px rgba(0,0,0,.8),
            0 3px 0 rgba(0,0,0,.85),
            0 0 46px rgba(245,196,81,.55),
            0 0 calc(var(--h, 0) * .16em) rgba(255,110,10,.9);
          -webkit-text-stroke: 1px rgba(0,0,0,.55);
          animation: llcFlash 1.15s ease-in-out infinite;
        }

        /* The heat the words sit in. Kept tight to the text and weak on
           purpose: the board underneath is the product, and an ember glow
           wide enough to tint the top row of cards is a fog, not a fire.
           Opacity rather than a colour with a calc alpha, because opacity is
           the one property that takes a bare calc without argument. */
        .llc-ember {
          position: absolute;
          inset: -.35em -.45em -.25em;
          z-index: 0;
          pointer-events: none;
          background: radial-gradient(ellipse at 50% 68%,
            rgba(255,140,25,.75), rgba(255,60,0,.22) 48%, rgba(255,40,0,0) 74%);
          filter: blur(.22em);
          opacity: calc(var(--h, 0) / 16);
          animation: llcEmber 1.6s ease-in-out infinite;
        }
        @keyframes llcEmber {
          0%, 100% { transform: scale(1) translateY(0); }
          50%      { transform: scale(1.07) translateY(-3%); }
        }

        .llc-smoke, .llc-fire, .llc-sparks {
          position: absolute;
          left: 0; right: 0;
          pointer-events: none;
        }

        /* Smoke is the first sign, and it is grey and slow on purpose: it has
           to read as "nothing yet" while still telling the room something is
           building. */
        .llc-smoke { bottom: .1em; height: 1em; z-index: 1; }
        .llc-smoke i {
          position: absolute;
          bottom: 0;
          left: calc(var(--i) * 16% + 8%);
          width: calc(.3em + var(--h, 0) * .03em);
          aspect-ratio: 1;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(205,205,213,.5), rgba(150,150,160,0) 68%);
          filter: blur(.09em);
          opacity: 0;
          animation: llcSmoke 2.8s ease-out infinite;
          animation-delay: calc(var(--i) * -.47s);
        }
        @keyframes llcSmoke {
          0%   { opacity: 0; transform: translate(0, 10%) scale(.5); }
          20%  { opacity: .45; }
          100% { opacity: 0; transform: translate(calc(var(--i) * .04em - .1em), -220%) scale(1.9); }
        }

        /* Tongues along the baseline, licking up behind the letters. Narrow
           and tall: the width barely moves with heat and the height nearly
           triples, which is the difference between a flame and a blob. They
           start at a quarter opacity on the third spin and reach full on the
           sixth, so the fire arrives over three spins rather than switching
           on. */
        .llc-fire { bottom: -.1em; height: 1.6em; z-index: 2; }
        .llc-fire i {
          position: absolute;
          bottom: 0;
          left: calc(var(--i) * 11% + 2%);
          width: calc(.2em + var(--h, 0) * .012em);
          /* Tips land just over the cap height at full heat. Taller than that
             and they stop licking the letters and become a curtain hanging in
             front of the board. */
          height: calc(.3em + var(--h, 0) * .12em);
          background: linear-gradient(to top,
            #fff6c4 0%, #ffd24a 18%, #ff9500 45%, #ff3c00 72%, rgba(255,40,0,0) 100%);
          border-radius: 50% 50% 46% 46% / 66% 66% 34% 34%;
          filter: blur(.035em);
          mix-blend-mode: screen;
          transform-origin: 50% 100%;
          opacity: calc((var(--h, 0) - 2) / 4);
          animation: llcFlame .46s ease-in-out infinite alternate;
          animation-delay: calc(var(--i) * -.087s);
        }
        @keyframes llcFlame {
          from { transform: scaleY(.72) scaleX(1.08) skewX(-6deg); }
          to   { transform: scaleY(1.3) scaleX(.86) skewX(7deg); }
        }

        /* Embers thrown off the top. In front of the text, because a spark
           crossing a letter is what sells the words as the thing burning
           rather than something standing in front of a fire. */
        .llc-sparks { bottom: 0; height: 1em; z-index: 4; }
        .llc-sparks i {
          position: absolute;
          bottom: .15em;
          left: calc(var(--i) * 7.8% + 4%);
          width: .05em; height: .05em;
          border-radius: 50%;
          background: #fff3c6;
          box-shadow: 0 0 .1em .02em rgba(255,165,40,.95);
          opacity: 0;
          animation: llcSpark 1.5s ease-out infinite;
          animation-delay: calc(var(--i) * -.124s);
        }
        @keyframes llcSpark {
          0%   { opacity: 0; transform: translate(0, 0) scale(.4); }
          12%  { opacity: 1; }
          100% { opacity: 0; transform: translate(calc(var(--i) * .03em - .15em), -340%) scale(.15); }
        }

        /* Lightning: two struck bolts and a sky flash behind them, on a cycle
           that is dark for most of its length. A strike that is always
           happening is a light, not lightning. */
        .llc-bolt {
          position: absolute;
          left: -.3em; right: -.3em;
          bottom: .1em;
          width: calc(100% + .6em);
          height: 2.4em;
          z-index: 5;
          pointer-events: none;
          fill: #eaf4ff;
          filter: drop-shadow(0 0 .14em rgba(150,205,255,.95)) drop-shadow(0 0 .35em rgba(90,170,255,.6));
          opacity: 0;
          animation: llcStrike 4.1s linear infinite;
        }
        .llc-flash {
          position: absolute;
          inset: -1.2em -.8em -.3em;
          z-index: 2;
          pointer-events: none;
          background: linear-gradient(180deg,
            rgba(200,230,255,0) 0%, rgba(215,238,255,.6) 55%, rgba(255,255,255,0) 100%);
          mix-blend-mode: screen;
          opacity: 0;
          animation: llcStrike 4.1s linear infinite;
        }
        @keyframes llcStrike {
          0%, 100%   { opacity: 0; }
          0.8%       { opacity: .95; }
          1.9%       { opacity: 0; }
          3.1%       { opacity: .7; }
          4.2%       { opacity: 0; }
          5.0%       { opacity: .4; }
          6.2%, 99%  { opacity: 0; }
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
          .llc-words, .llc-headwrap { animation: none !important; }
          .llc-tilt, .llc-holo, .llc-sparkle, .llc-glare { animation: none !important; }
          .llc-holo, .llc-sparkle, .llc-glare { opacity: .18; }
          /* The fire is the one thing that has to stay legible without motion,
             so the flames hold still rather than disappearing - the banner
             still reads as hot, it just stops flickering. */
          .llc-ember, .llc-fire i { animation: none !important; }
          .llc-smoke, .llc-sparks, .llc-bolt, .llc-flash { display: none !important; }
        }
      `}</style>
    </div>
  );
}
