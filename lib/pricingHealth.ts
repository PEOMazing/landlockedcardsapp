import { AtRecord, T, atList } from "./airtable";
import { conditionFloors, floorKey } from "./tcgListings";

// Does the pricing pipeline still work?
//
// Every pricing bug this app has had was the same bug: something stopped
// working and nothing said so. The nightly job filtered on Card ID and
// silently skipped 97 of ~100 cards for a month. The estimate flag silently
// did not fire. Both were invisible because the code caught its own errors and
// carried on, which is right for one card and wrong for the system.
//
// So the fallbacks stay - a dead upstream should not blank the inventory - but
// falling back is now a reportable event rather than a quiet one. Two checks:
//
//   canary  - call the live endpoint and assert its SHAPE, not its prices
//   coverage - how many cards are actually priced from condition-specific data
//
// Coverage is the one that catches slow rot. A canary passes right up until
// the morning it does not; coverage sliding from 95% to 60% over two weeks is
// the shape most real failures take.

// Leafeon 7/100 Majestic Dawn. Chosen as the canary because it is the card
// that exposed the printing bug: one productId carrying both a Holofoil and a
// Reverse Holofoil at very different prices. If the response ever stops
// splitting those, every Reverse card in the collection is about to be priced
// as a Holofoil, and this is the check that notices.
const CANARY_PRODUCT = 86677;
const CANARY_PRINTINGS = ["Holofoil", "Reverse Holofoil"];

export type CanaryResult = { ok: boolean; detail: string; buckets: number };

// Deliberately asserts structure and nothing about price. A canary pinned to
// $98.01 would fail every time the market moved, get muted within a week, and
// then not be a canary.
export async function listingsCanary(): Promise<CanaryResult> {
  let map;
  try {
    map = await conditionFloors(CANARY_PRODUCT);
  } catch (e: any) {
    return { ok: false, detail: `listings endpoint threw: ${String(e?.message || e).slice(0, 120)}`, buckets: 0 };
  }
  if (!map) {
    return { ok: false, detail: "listings endpoint returned nothing - moved, rate-limited, or down", buckets: 0 };
  }
  const printings = new Set([...map.keys()].map((k) => k.split("|")[0]));
  const missing = CANARY_PRINTINGS.filter((p) => !printings.has(p));
  if (missing.length) {
    return {
      ok: false,
      detail: `response no longer splits printings - missing ${missing.join(", ")}. Reverse cards would be priced as Holofoil.`,
      buckets: map.size,
    };
  }
  // A card whose printings resolve but whose conditions do not is the other
  // half of the same failure: we would be back to one blended number.
  const conditions = new Set([...map.keys()].map((k) => k.split("|")[1]));
  if (conditions.size < 2) {
    return { ok: false, detail: `response no longer splits conditions (${conditions.size} seen)`, buckets: map.size };
  }
  return { ok: true, detail: `${map.size} printing+condition buckets, ${printings.size} printings`, buckets: map.size };
}

// How a comp was actually arrived at, read back off the stored source string.
export type CompBasis = "solds" | "listing" | "estimate" | "manual" | "none";

export function basisOf(rec: AtRecord): CompBasis {
  if (rec.fields["Comp"] === undefined || rec.fields["Comp"] === null) return "none";
  const s = String(rec.fields["Comp Source"] || "");
  if (/solds/i.test(s)) return "solds";
  if (/lowest .* listing/i.test(s)) return "listing";
  if (/est\./i.test(s)) return "estimate";
  return "manual";
}

export type Coverage = {
  total: number;
  solds: number;
  listing: number;
  estimate: number;
  manual: number;
  none: number;
  /** share priced from data specific to this card's condition */
  conditionSpecific: number;
  /** cards the rotation has not reached inside its expected window */
  stale: number;
  /** hours since the longest-unchecked card was last priced */
  oldestHours: number | null;
};

// The rolling reprice takes 40 cards every 15 minutes, so a collection of a
// few hundred turns over inside an hour. Past this, the rotation is not
// keeping up or has stopped firing altogether - which is the failure mode of
// a scheduled job, and one that otherwise looks exactly like nothing.
const STALE_HOURS = 3;

export async function compCoverage(): Promise<Coverage> {
  const rows = await atList(T.singles, { filterByFormula: "{Status} = 'In Stock'" });
  const now = Date.now();
  const c: Coverage = {
    total: rows.length, solds: 0, listing: 0, estimate: 0, manual: 0, none: 0,
    conditionSpecific: 0, stale: 0, oldestHours: null,
  };
  for (const r of rows) {
    c[basisOf(r)]++;
    const raw = String(r.fields["Comp Checked"] || "");
    const t = raw ? Date.parse(raw) : NaN;
    // Never checked is the worst case, not a missing data point: it is a card
    // no version of the pipeline has ever reached.
    if (!Number.isFinite(t)) { c.stale++; continue; }
    const hours = (now - t) / 3600000;
    if (hours > STALE_HOURS) c.stale++;
    if (c.oldestHours === null || hours > c.oldestHours) c.oldestHours = Math.round(hours * 10) / 10;
  }
  c.conditionSpecific = c.solds + c.listing;
  return c;
}

export type PricingHealth = {
  canary: CanaryResult;
  coverage: Coverage;
  healthy: boolean;
  problems: string[];
};

// Below this share of condition-specific pricing, something upstream is wrong
// even if the canary happens to be passing. Set low enough that a handful of
// genuinely unlistable vintage cards does not cry wolf.
const MIN_CONDITION_SHARE = 0.6;

// The singles page asks for this on every load, and answering costs a full
// table read plus an upstream call. Cached briefly so a few people opening the
// page together, or one person navigating around, does not multiply that.
// Short enough that the Re-check button still means something.
const HEALTH_TTL = 60_000;
let healthCache: { at: number; data: PricingHealth } | null = null;

export async function pricingHealth(force = false): Promise<PricingHealth> {
  if (!force && healthCache && Date.now() - healthCache.at < HEALTH_TTL) return healthCache.data;
  const data = await computeHealth();
  healthCache = { at: Date.now(), data };
  return data;
}

async function computeHealth(): Promise<PricingHealth> {
  const [canary, coverage] = await Promise.all([listingsCanary(), compCoverage()]);
  const problems: string[] = [];

  if (!canary.ok) problems.push(`Condition pricing is down: ${canary.detail}`);

  const priced = coverage.total - coverage.none;
  const share = priced > 0 ? coverage.conditionSpecific / priced : 1;
  if (priced > 0 && share < MIN_CONDITION_SHARE) {
    problems.push(
      `Only ${Math.round(share * 100)}% of priced cards use condition-specific data ` +
      `(${coverage.conditionSpecific} of ${priced}); the rest are estimates or hand-set.`
    );
  }
  if (coverage.none > 0) problems.push(`${coverage.none} in-stock cards have no comp at all.`);
  // The rotation stalling is the loudest signal that the scheduled job has
  // stopped firing, which is otherwise completely silent.
  if (coverage.stale > 0) {
    problems.push(
      `The rolling reprice has not reached ${coverage.stale} card${coverage.stale === 1 ? "" : "s"} in ${STALE_HOURS}+ hours` +
      (coverage.oldestHours !== null ? ` (oldest ${coverage.oldestHours}h)` : "") +
      ` - check that the /api/cron/reprice job is still running.`
    );
  }

  return { canary, coverage, healthy: problems.length === 0, problems };
}
