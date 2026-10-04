// Generating a show set from what is on the shelf.
//
// WHAT THIS IS OPTIMISING, AND WHY IT IS NOT WHAT YOU WOULD GUESS.
//
// Across 56 shows with earnings recorded, revenue per spot sits at a median of
// $10.27 and does not move with how many spots sell: the correlation between
// spots sold and revenue per spot is -0.06. Total take tracks spots sold at
// +0.92. In other words the wheel earns about ten dollars a spin whatever is
// on it, and the money is made by selling spins, not by loading the board.
//
// So the job here is not to maximise what goes up. It is to put up the least
// value that still looks worth ten dollars a spin, spread so that no single
// item is carrying the show. Every dollar of market value above that is margin
// handed back.
//
// Slabs are deliberately excluded. All 37 in stock are $50 or more and 18 of
// them average around $900, against a normal wheel carrying roughly $700 of
// value in total: one slab IS the set. They are better sold than spun, and the
// generator reports them separately rather than quietly reaching for them.

export type Candidate = {
  id: string;
  kind: "single" | "sealed";
  name: string;
  /** Comp for a single, market price for a sealed product. Per unit. */
  value: number;
  /** 1 for a single card, qty on hand for a sealed product. */
  available: number;
  /** Binder slot, so the pull list can be walked in filing order. */
  slot?: number | null;
  category?: string;
  /** How many shows ago this last went on a set. Undefined means never. */
  lastUsedShowsAgo?: number;
};

export type Tier = {
  key: string;
  label: string;
  /** Share of the set's spots this tier should fill. */
  share: number;
  /** Per-unit value band, min inclusive, max exclusive. */
  min: number;
  max: number;
  /** Restrict the tier to one kind of stock. */
  kind?: "single" | "sealed";
};

// The shape of a working wheel, read off the sets that have actually run:
// a deep floor of cheap packs so there is always something to win, a wide
// middle of raw singles for variety, and a handful of real prizes.
//
// The middle is split by kind on purpose. Left as one open band it fills with
// whatever happens to sort first, and a run of $19 blisters will beat a run of
// $15 cards every time, so a set that was meant to be a mixture quietly comes
// out as sealed with a few cards on it. Naming the shares is the only way the
// mixture is guaranteed rather than hoped for.
export const DEFAULT_TIERS: Tier[] = [
  { key: "prize", label: "Prizes", share: 0.10, min: 25, max: Infinity },
  { key: "midSingle", label: "Good cards", share: 0.10, min: 6, max: 25, kind: "single" },
  { key: "midSealed", label: "Blisters and boxes", share: 0.05, min: 6, max: 25, kind: "sealed" },
  { key: "low", label: "Low singles", share: 0.20, min: 1, max: 6, kind: "single" },
  { key: "filler", label: "Packs", share: 0.55, min: 0, max: 3, kind: "sealed" },
];

export type QuickSetOptions = {
  spots: number;
  /** Market value to aim for per spot. The recent sets run about $6.20. */
  valuePerSpot?: number;
  /** No single item may carry more than this share of the set's value. */
  maxItemPct?: number;
  /** Skip anything that was on a set within this many shows. */
  cooldownShows?: number;
  /** Above this, an item counts towards the hit pool. Matches the app setting. */
  hitThreshold?: number;
  tiers?: Tier[];
  seed?: number;
};

export type Pick = {
  id: string;
  kind: "single" | "sealed";
  name: string;
  qty: number;
  unitValue: number;
  value: number;
  tier: string;
  slot?: number | null;
};

export type QuickSet = {
  picks: Pick[];
  spots: number;
  value: number;
  valuePerSpot: number;
  hitPoolValue: number;
  hitPoolCount: number;
  biggest: { name: string; value: number; pct: number } | null;
  byTier: { key: string; label: string; spots: number; value: number }[];
  warnings: string[];
};

/** Deterministic shuffle, so the same seed gives the same set and a different
 *  seed gives a genuinely different one. Mulberry32. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const inBand = (c: Candidate, t: Tier) =>
  c.value >= t.min && c.value < t.max && (!t.kind || c.kind === t.kind);

export function generateQuickSet(pool: Candidate[], opts: QuickSetOptions): QuickSet {
  const spots = Math.max(1, Math.floor(opts.spots));
  const valuePerSpot = opts.valuePerSpot ?? 6.2;
  const maxItemPct = opts.maxItemPct ?? 0.12;
  const cooldown = opts.cooldownShows ?? 3;
  const hitThreshold = opts.hitThreshold ?? 10;
  const tiers = opts.tiers ?? DEFAULT_TIERS;
  const rand = rng(opts.seed ?? 1);

  const budget = spots * valuePerSpot;
  const cap = budget * maxItemPct;
  const warnings: string[] = [];

  // Anything too big for the set, or seen too recently by the same audience,
  // is off the table before the picking starts.
  //
  // THE COOLDOWN IS FOR SINGLES ONLY, and finding that out cost a run against
  // the real shelf. A card is one physical object with a number on it, and a
  // regular who watched it go up unwon last Tuesday will notice it again on
  // Thursday. A booster pack is not: one Brilliant Fantasy pack is every other
  // Brilliant Fantasy pack, and nobody has ever recognised one.
  //
  // Applied to everything, the cooldown ate the floor of the wheel. Packs go
  // up every single show by definition, so all 708 of them were always inside
  // the window, and a 119 spot set came back with 52 spots on it and a note
  // saying the shelf had one pack left. The shelf had 708.
  const onCooldown = (c: Candidate) =>
    c.kind === "single" && c.lastUsedShowsAgo !== undefined && c.lastUsedShowsAgo < cooldown;
  const tooBig = pool.filter((c) => c.value > cap);
  const eligible = pool.filter((c) => c.value <= cap && c.available > 0 && !onCooldown(c));

  const picks: Pick[] = [];
  const takenQty = new Map<string, number>();
  let spent = 0;
  let filled = 0;

  // Prizes are filled first, because they define the show and the filler
  // should absorb what is left rather than crowd them out.
  //
  // Fill each tier purely by spot count. The value budget is not enforced
  // here on purpose: starving a tier mid-fill is how you end up with four
  // prizes on a wheel that was supposed to have eleven. Value is brought back
  // into line afterwards by swapping, which keeps the spot count intact.
  const take = (c: Candidate, n: number, tierKey: string) => {
    const used = takenQty.get(c.id) || 0;
    const n2 = Math.min(n, c.available - used);
    if (n2 <= 0) return 0;
    takenQty.set(c.id, used + n2);
    const existing = picks.find((p) => p.id === c.id && p.tier === tierKey);
    if (existing) { existing.qty += n2; existing.value = round2(existing.qty * existing.unitValue); }
    else picks.push({
      id: c.id, kind: c.kind, name: c.name, qty: n2,
      unitValue: c.value, value: round2(n2 * c.value), tier: tierKey, slot: c.slot ?? null,
    });
    spent += n2 * c.value;
    return n2;
  };

  // Rounding each share independently overshoots: 10/15/20/55 percent of 110
  // rounds to 11+17+22+61, which is 111 spots for a 110 spot show. The last
  // tier takes the remainder instead, which is what filler is for anyway.
  const wants = tiers.map((t, i) =>
    i === tiers.length - 1
      ? Math.max(0, spots - tiers.slice(0, -1).reduce((a, x) => a + Math.round(spots * x.share), 0))
      : Math.round(spots * t.share),
  );

  for (const [ti, tier] of tiers.entries()) {
    const want = wants[ti];
    let got = 0;
    // Longest unused first, so stock rotates instead of the same cards going
    // up every week, with the shuffle breaking ties.
    const candidates = shuffled(
      eligible.filter((c) => inBand(c, tier)),
      rand,
    ).sort((a, b) => (b.lastUsedShowsAgo ?? 9999) - (a.lastUsedShowsAgo ?? 9999));

    for (const c of candidates) {
      if (got >= want) break;
      got += take(c, want - got, tier.key);
    }
    filled += got;
    if (got < want) warnings.push(`${tier.label}: wanted ${want} spots, the shelf had ${got}`);
  }

  if (filled < spots) {
    warnings.push(`Short by ${spots - filled} spots. Nothing left in stock that fits the bands.`);
  }

  // Bring the value down to budget by DOWNGRADING, not deleting: the dearest
  // item gives up one unit and the cheapest thing on the shelf takes its spot.
  // A set that is one prize lighter still reads fine; a set that is nine spots
  // short does not, and deleting was quietly doing the second.
  const cheapest = eligible
    .filter((c) => c.kind === "sealed")
    .sort((a, b) => a.value - b.value)[0];
  let swaps = 0;
  while (spent > budget * 1.1 && picks.length > 1 && swaps < spots) {
    const dearest = picks.reduce((b, p) => (p.unitValue > b.unitValue ? p : b), picks[0]);
    if (cheapest && dearest.unitValue <= cheapest.value) break; // nothing left to gain
    dearest.qty -= 1;
    spent -= dearest.unitValue;
    if (dearest.qty <= 0) picks.splice(picks.indexOf(dearest), 1);
    else dearest.value = round2(dearest.qty * dearest.unitValue);
    const back = cheapest ? take(cheapest, 1, "filler") : 0;
    if (!back) warnings.push(`Dropped a ${dearest.name} and had nothing cheap left to put in its spot`);
    swaps++;
  }
  if (swaps) {
    warnings.push(`Swapped ${swaps} dear spot${swaps === 1 ? "" : "s"} down to packs to stay inside the value budget`);
  }

  const totalSpots = picks.reduce((a, p) => a + p.qty, 0);
  const value = round2(picks.reduce((a, p) => a + p.value, 0));
  const hits = picks.filter((p) => p.unitValue >= hitThreshold);
  const biggestPick = picks.reduce<Pick | null>((b, p) => (!b || p.unitValue > b.unitValue ? p : b), null);

  if (tooBig.length) {
    warnings.push(
      `${tooBig.length} item${tooBig.length === 1 ? "" : "s"} skipped for being worth more than ${Math.round(maxItemPct * 100)}% of the set on their own`,
    );
  }

  return {
    picks,
    spots: totalSpots,
    value,
    valuePerSpot: totalSpots ? round2(value / totalSpots) : 0,
    hitPoolValue: round2(hits.reduce((a, p) => a + p.value, 0)),
    hitPoolCount: hits.reduce((a, p) => a + p.qty, 0),
    biggest: biggestPick
      ? { name: biggestPick.name, value: biggestPick.unitValue, pct: value ? round2((biggestPick.unitValue / value) * 100) : 0 }
      : null,
    byTier: tiers.map((t) => {
      const mine = picks.filter((p) => p.tier === t.key);
      return { key: t.key, label: t.label, spots: mine.reduce((a, p) => a + p.qty, 0), value: round2(mine.reduce((a, p) => a + p.value, 0)) };
    }),
    warnings,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The pull list, in the order someone actually walks the room: sealed off the
 *  shelf by product, then the binder in slot order. */
export function pullList(set: QuickSet): { sealed: Pick[]; singles: Pick[] } {
  return {
    sealed: set.picks.filter((p) => p.kind === "sealed").sort((a, b) => b.value - a.value),
    singles: set.picks
      .filter((p) => p.kind === "single")
      .sort((a, b) => (a.slot ?? Number.MAX_SAFE_INTEGER) - (b.slot ?? Number.MAX_SAFE_INTEGER)),
  };
}
