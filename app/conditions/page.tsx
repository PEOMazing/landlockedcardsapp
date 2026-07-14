// Public card condition guide. Linked from the singles form, the quick-sell
// page a customer lands on after scanning a label, and anywhere a condition
// code appears. The illustrations are schematic - wear zones drawn on a card
// diagram - so vendors and customers share one standard at the table.

const $note = "text-dim text-sm leading-relaxed";

function CardArt({ grade }: { grade: string }) {
  // A stylized card with wear drawn per grade. Not a photo - a diagram of
  // exactly where to look.
  const edge = "#8b93a7";
  const wear = "#f4f5f7";
  const crease = "#fbbf24";
  return (
    <svg viewBox="0 0 120 168" className="w-full max-w-[150px]" aria-hidden="true">
      <rect x="4" y="4" width="112" height="160" rx="8" fill="#171b25" stroke={edge} strokeWidth="2" />
      <rect x="14" y="16" width="92" height="66" rx="4" fill="#22283a" />
      <rect x="14" y="92" width="92" height="8" rx="2" fill="#2a3147" />
      <rect x="14" y="106" width="70" height="6" rx="2" fill="#2a3147" />
      <rect x="14" y="118" width="80" height="6" rx="2" fill="#2a3147" />
      {grade !== "NM" && (
        <>
          {/* corner whitening grows with wear */}
          <path d="M4 14 Q4 4 14 4 L20 4 Q6 6 6 20 Z" fill={wear} opacity={grade === "LP" ? 0.5 : 0.9} />
          <path d="M116 154 Q116 164 106 164 L100 164 Q114 162 114 148 Z" fill={wear} opacity={grade === "LP" ? 0.4 : 0.9} />
        </>
      )}
      {(grade === "MP" || grade === "HP" || grade === "DM") && (
        <>
          <path d="M106 4 Q116 4 116 14 L116 20 Q114 6 100 6 Z" fill={wear} opacity="0.8" />
          <path d="M14 164 Q4 164 4 154 L4 148 Q6 162 20 162 Z" fill={wear} opacity="0.8" />
          {/* edgewear runs */}
          <rect x="30" y="3" width="30" height="2.5" rx="1" fill={wear} opacity="0.7" />
          <rect x="60" y="162.5" width="34" height="2.5" rx="1" fill={wear} opacity="0.7" />
          {/* surface scratches */}
          <line x1="30" y1="30" x2="70" y2="56" stroke={wear} strokeWidth="1" opacity="0.5" />
          <line x1="52" y1="24" x2="88" y2="44" stroke={wear} strokeWidth="0.8" opacity="0.4" />
        </>
      )}
      {(grade === "HP" || grade === "DM") && (
        <>
          <rect x="3" y="40" width="2.5" height="44" rx="1" fill={wear} opacity="0.8" />
          <rect x="114.5" y="70" width="2.5" height="50" rx="1" fill={wear} opacity="0.8" />
          <line x1="20" y1="140" x2="60" y2="120" stroke={wear} strokeWidth="1.2" opacity="0.6" />
          {/* crease */}
          <path d="M10 70 Q50 78 110 62" stroke={crease} strokeWidth="1.6" fill="none" opacity={grade === "DM" ? 0.9 : 0.55} />
        </>
      )}
      {grade === "DM" && (
        <>
          {/* hard fold, tear, water blotch, ink */}
          <path d="M60 4 Q64 80 56 164" stroke={crease} strokeWidth="2.2" fill="none" opacity="0.9" />
          <path d="M4 120 L18 126 L8 132 Z" fill={wear} opacity="0.9" />
          <ellipse cx="86" cy="132" rx="16" ry="10" fill="#7aa2ff" opacity="0.25" />
          <path d="M24 148 q6 -6 12 0 q6 6 12 0" stroke="#f472b6" strokeWidth="1.4" fill="none" opacity="0.7" />
        </>
      )}
    </svg>
  );
}

const GRADES = [
  {
    code: "NM", name: "Near Mint",
    summary: "Looks pack-fresh at arm's length.",
    detail: "Clean front and back with bright, sharp corners. At most one or two tiny flaws you have to hunt for: a speck of edgewear or a faint surface mark visible only under direct light. No whitening you can see at a glance, no scratches, no bends.",
    value: "Full market price - this is the baseline every comp is quoted against.",
  },
  {
    code: "LP", name: "Lightly Played",
    summary: "Minor wear you can find, not wear that finds you.",
    detail: "Light corner whitening on one or two corners, minor edgewear, or light surface scratches visible when the card is tilted under light. Border wear is minimal. The card has no creases, no bends, and looks clean in a sleeve or binder.",
    value: "Roughly 80 to 90 percent of the NM price.",
  },
  {
    code: "MP", name: "Moderately Played",
    summary: "Wear is obvious at a glance, structure is fine.",
    detail: "Noticeable whitening on multiple corners and edges, moderate surface scratching, and visible border wear. May have very light bending from shuffling, but no hard creases. The wear announces itself as soon as you look at the card.",
    value: "Roughly 65 to 75 percent of the NM price.",
  },
  {
    code: "HP", name: "Heavily Played",
    summary: "A long life, but still in one piece.",
    detail: "Major whitening around most of the border, heavy scratching across the surface, and possibly light creasing that does not break the card's structure. All corners show wear. The card is complete and legible - just deeply used.",
    value: "Roughly 50 to 60 percent of the NM price.",
  },
  {
    code: "DM", name: "Damaged",
    summary: "Structural problems, not just wear.",
    detail: "Hard creases or folds, tears, water damage, ink or writing, peeling, or major stains. Any single defect of this kind makes a card Damaged regardless of how clean the rest of it is.",
    value: "Roughly 40 to 50 percent of NM or less - priced per card.",
  },
];

export const metadata = { title: "Card condition guide" };

export default function ConditionsPage() {
  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Card condition guide</h1>
        <p className={$note + " mt-1 max-w-2xl"}>
          Every card is graded to this standard, and every comp is a Near Mint baseline adjusted for the condition on the label. The illustrations show where wear appears - corners, edges, surface, structure - as it accumulates from grade to grade.
        </p>
      </div>
      <div className="space-y-4">
        {GRADES.map((g) => (
          <section key={g.code} className="card p-5 flex gap-5 items-start flex-wrap sm:flex-nowrap">
            <CardArt grade={g.code} />
            <div className="min-w-0">
              <h2 className="text-lg font-bold">
                {g.name} <span className="text-foil">({g.code})</span>
              </h2>
              <p className="font-medium mt-0.5">{g.summary}</p>
              <p className={$note + " mt-2"}>{g.detail}</p>
              <p className="text-sm mt-2"><span className="label">Typical value</span> <span className="text-dim">{g.value}</span></p>
            </div>
          </section>
        ))}
      </div>
      <p className={$note}>
        Graded slabs (PSA, CGC, BGS) carry their own scale and are listed by their grade instead. Value ranges above are rough market tendencies, not promises - the live comp on each card is always the source of truth.
      </p>
    </main>
  );
}
