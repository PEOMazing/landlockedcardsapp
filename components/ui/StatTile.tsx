// One number with a label on it. The most repeated shape in the app.
//
// Before this there were five of these, written separately:
//
//   app/collection/page.tsx       Tile({label, value, sub, tone})
//   app/admin/audit/AuditClient   Tile({label, value, sub, tone})   byte-identical
//   app/vendor/page.tsx           Tile({label, value, sub, tone})   byte-identical
//   app/admin/inventory           Count({label, units, value, tone, strong})
//   app/streams/[id]/StreamEditor Stat({label, value, accent, warn})
//
// Three of them were the same function copied three times. The other two were
// the same idea with a different prop vocabulary, a different value size and,
// in StreamEditor's case, an off-palette `text-amber-400` that exists nowhere
// else in the product. None of that was a decision anyone made; it is what
// happens when the fifth screen needs a tile and the fastest route is to copy
// the fourth.
//
// The variants here are the real differences between those five, and nothing
// more. No prop was invented for a case that does not exist today.

export type Tone = "body" | "foil" | "win" | "givvy" | "warn" | "bad";

// Semantic, not a class name. The old components took `tone?: string` and call
// sites passed "text-win" straight through, which is how `text-amber-400` got
// in: if the prop accepts any class, the palette is a suggestion.
const TONE: Record<Tone, string> = {
  body: "text-body",
  foil: "text-foil",
  win: "text-win",
  givvy: "text-givvy",
  warn: "text-warn",
  bad: "text-bad",
};

export type StatTileProps = {
  label: string;
  /** Already formatted. Currency, percent and unit formatting belong to the
   *  screen, which knows whether $1,284.50 or 1,284 units is the honest
   *  rounding. A primitive that formatted numbers would be guessing. */
  value: string;
  /** Quiet second line: what the number is measured against. */
  sub?: string;
  /** Second line that needs attention rather than context, for example
   *  "12 unpriced items understate this". Rendered in the warn colour. */
  note?: string;
  tone?: Tone;
  /** lg is the dashboard size. md is for a dense grid of six or more, where
   *  the big size stops scanning and starts shouting. */
  size?: "lg" | "md";
  /** card is a panel with a hairline, the default. inline is a bordered box
   *  that sits inside an existing card without nesting two panels. */
  surface?: "card" | "inline";
  /** The one tile in a group that is the total, or the answer. Only has a
   *  visible effect on `inline`, which is the only place it is used. */
  highlight?: boolean;
  /** Makes the whole tile a button, for a number that can be opened.
   *  Rendered as a real <button> rather than a div with a handler, so it is
   *  reachable by keyboard and announced as something you can press. A tile
   *  without this stays a plain div: most of them are not actionable and a
   *  page full of fake buttons is worse than none. */
  onClick?: () => void;
  /** Tooltip, and the accessible name of the button when onClick is set. */
  title?: string;
};

export default function StatTile({
  label,
  value,
  sub,
  note,
  tone = "body",
  size = "lg",
  surface = "card",
  highlight = false,
  onClick,
  title,
}: StatTileProps) {
  const shell =
    surface === "card"
      ? "card p-s4"
      : `rounded-lg border px-s3 py-s2 ${
          highlight ? "border-foil/40 bg-foil/5" : "border-edge"
        }`;

  const valueSize = size === "lg" ? "text-2xl" : "text-lg leading-tight";

  const inner = (
    <>
      <div className="label">{label}</div>
      <div className={`num font-bold mt-s1 ${valueSize} ${TONE[tone]}`}>{value}</div>
      {sub && <div className="text-dim t-meta mt-s1">{sub}</div>}
      {note && <div className="text-warn t-meta mt-s1">{note}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`${shell} text-left w-full transition-colors hover:border-foil/60 focus:outline-none focus-visible:border-foil`}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={shell} title={title}>
      {inner}
    </div>
  );
}
