import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import StatTile from "@/components/ui/StatTile";
import { atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { isSlab } from "@/lib/slab";
import {
  ALL_GRADES, MIN_SAMPLE, SHIP_PER_CARD, gradingCost, rankTriage, rollupSetUpside,
  sweepCandidates, triage, type GradeKey, type TriageCard,
} from "@/lib/gradeTriage";

export const dynamic = "force-dynamic";

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "-"
    : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// gt-v1. Which raw cards are worth sending off to be graded.
//
// Every number here is CONDITIONAL and that is deliberate. The page will tell
// you what a card makes if it lands a 10, and what it makes if it lands an 8.
// It will not tell you which it will land, because nobody knows that, and a
// single expected-value column blending the two with an invented probability
// would look far more authoritative than it had any right to.
export default async function GradingPage({ searchParams }: { searchParams?: { floor?: string } }) {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isTeam) redirect("/dashboard");

  const [settings, rows] = await Promise.all([
    getSettings(),
    atList(T.singles, {
      filterByFormula: "AND({Card Name} != '', OR({Status} = 'In Stock', {Status} = 'In Stream'))",
    }).catch(() => [] as any[]),
  ]);
  const fee = Number((settings as any).grading_fee) || 59.99;
  const maxInsured = Number((settings as any).grading_max_insured) || 1000;
  const cost = gradingCost(fee, SHIP_PER_CARD);

  const raw = (rows as any[]).filter((r) => !isSlab(String(r.fields["Condition"] || "")));

  const cards: TriageCard[] = raw.map((r) => {
    let detail: any = {};
    try { detail = JSON.parse(String(r.fields["Graded Detail"] || "{}")); } catch { detail = {}; }
    const grades: TriageCard["grades"] = {};
    for (const g of ALL_GRADES) {
      // Every grade comes out of the JSON; only 10, 9 and 8 have columns.
      const price = Number(detail?.[g]?.price);
      grades[g as GradeKey] = {
        price: Number.isFinite(price) && price > 0 ? price : null,
        date: detail?.[g]?.date || null,
      };
    }
    return {
      id: r.id,
      name: [r.fields["Card Name"], r.fields["Set Name"]].filter(Boolean).join(" - "),
      setName: r.fields["Set Name"] || "",
      rarity: r.fields["Rarity"] || "",
      rawComp: typeof r.fields["Comp"] === "number" ? r.fields["Comp"] : null,
      grades,
      checked: r.fields["Graded Checked"] || null,
    };
  });

  // gt-v3. The floor grade. "9" asks: worth sending if it comes back no
  // better than a 9? Lower is the harsher test, so the list SHRINKS as you go
  // down, which is the opposite of what a dropdown usually does.
  const floor = (ALL_GRADES as string[]).includes(String(searchParams?.floor))
    ? (String(searchParams?.floor) as GradeKey)
    : ("9" as GradeKey);

  const all = rankTriage(cards.map((c) => triage(c, { fee, maxInsured })));
  const worth = all.filter((r) => (r.floorNet[floor] ?? null) !== null && (r.floorNet[floor] as number) > 0);
  const checkedCount = cards.filter((c) => c.checked).length;
  const pending = sweepCandidates(
    raw.map((r) => ({
      comp: typeof r.fields["Comp"] === "number" ? r.fields["Comp"] : null,
      checked: r.fields["Graded Checked"] || null,
      bestNet: typeof r.fields["Grade Best Net"] === "number" ? r.fields["Grade Best Net"] : null,
    })),
    Number.MAX_SAFE_INTEGER,
  ).length;
  const upsideTotal = worth.reduce((a, r) => a + (r.floorNet[floor] || 0), 0);
  const sets = rollupSetUpside(all, floor).slice(0, 25);

  return (
    <>
      <Nav isAdmin={me.isAdmin} isManager={me.isManager} name={me.streamer?.fields?.["Name"] || "Team"} />
      <main className="max-w-6xl mx-auto p-6 space-y-5">
        <div>
          <h1 className="t-page">Worth grading</h1>
          <p className="text-dim text-sm mt-1">
            Raw cards ranked by what grading would actually make, after giving up the raw card and
            paying {money(cost)} a card ({money(fee)} fee plus {money(SHIP_PER_CARD)} shipping).
            Every figure is conditional: this says what a card makes <em>if</em> it lands a grade,
            never how likely that is.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-dim">assume it grades at least</span>
          {ALL_GRADES.map((g) => (
            <a
              key={g}
              href={`/grading?floor=${g}`}
              className={`px-2 py-1 rounded border num ${g === floor ? "border-foil text-foil" : "border-edge text-dim hover:text-body"}`}
            >
              {g}
            </a>
          ))}
          <span className="text-dim">lower is the harsher test, so the list gets shorter</span>
        </div>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label={`Worth sending at PSA ${floor}+`} value={String(worth.length)} size="md" tone={worth.length > 0 ? "win" : undefined} />
          <StatTile label="Upside on those" value={money(upsideTotal)} size="md" tone="win" />
          <StatTile label="Cards looked up" value={`${checkedCount} / ${cards.length}`} size="md" />
          <StatTile label="Still to check" value={String(pending)} size="md" />
        </section>

        {checkedCount === 0 && (
          <div className="card p-5 text-sm">
            <p className="font-medium mb-1">Nothing looked up yet.</p>
            <p className="text-dim">
              The sweep runs every 15 minutes and works through the binder dearest-first, so the
              obvious money lands in the first run. All {cards.length} raw cards get looked at
              exactly once, cheap ones included, because a $5 card whose PSA 10 sells for $500 is
              the find worth having and a price filter would hide it.
            </p>
          </div>
        )}

        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th>Card</th><th>Raw</th><th>Break-even</th>
                <th>PSA 8</th><th>PSA 9</th><th>PSA 10</th>
                <th>Net at PSA {floor}+</th><th>Best net</th>
              </tr>
            </thead>
            <tbody>
              {all.filter((r) => r.bestNet !== null).slice(0, 200).map((r) => {
                const fn = r.floorNet[floor] ?? null;
                return (
                <tr key={r.id}>
                  <td className="!font-medium">
                    {r.name}
                    {r.overInsured && (
                      <span className="text-warn text-xs ml-2" title={`A ten would be worth more than the ${money(maxInsured)} ceiling on this tier, so it cannot go on this submission`}>
                        over insured cap
                      </span>
                    )}
                    {r.allStale && (
                      <span className="text-dim text-xs ml-2" title="Every graded sale on record is more than six months old - read these as history, not price">
                        old sales
                      </span>
                    )}
                  </td>
                  <td>{money(r.rawComp)}</td>
                  <td className="text-dim">
                    {money(r.breakEven)}
                    {r.neededMultiple !== null && <span className="text-xs ml-1">({r.neededMultiple}x)</span>}
                  </td>
                  {(["8", "9", "10"] as GradeKey[]).map((g) => {
                    const cell = r.byGrade[g];
                    return (
                      <td key={g} className={cell.net !== null && cell.net > 0 ? "text-win" : ""}>
                        {money(cell.price)}
                        {cell.net !== null && (
                          <span className="text-dim text-xs block">{money(cell.net)}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className={`!font-semibold ${fn !== null && fn > 0 ? "text-win" : "text-bad"}`}>
                    {money(fn)}
                  </td>
                  <td className="text-dim">
                    {money(r.bestNet)}{r.bestGrade ? <span className="text-xs ml-1">at {r.bestGrade}</span> : null}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {all.filter((r) => r.bestNet !== null).length === 0 && (
            <p className="text-dim text-sm p-4">No graded sales found on any card yet.</p>
          )}
        </div>

        <section className="space-y-2">
          <h2 className="label">What to buy</h2>
          <p className="text-dim text-xs">
            The same evidence read the other way round. The list above says what to do with cards
            you already have; this says what to go and acquire. Grouped by set AND rarity, because
            a set&apos;s commons and its art rares are not one population and averaging them
            describes nothing. The multiple is a median, so one chase card cannot drag a set
            somewhere no individual card lives. Rows under {MIN_SAMPLE} cards are marked thin and
            sort last - a 100% on three cards is not a better signal than an 80% on forty.
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Set</th><th>Rarity</th><th>Cards</th>
                  <th>Clear the fee</th><th>Median multiple</th><th>Upside</th>
                </tr>
              </thead>
              <tbody>
                {sets.map((r) => (
                  <tr key={r.key} className={r.thin ? "opacity-60" : ""}>
                    <td className="!font-medium">{r.setName || "-"}</td>
                    <td className="text-dim">{r.rarity || "-"}</td>
                    <td>
                      {r.n}
                      {r.thin && <span className="text-dim text-xs ml-1">thin</span>}
                    </td>
                    <td className={r.share >= 0.5 && !r.thin ? "text-win" : ""}>
                      {Math.round(r.share * 100)}%{" "}
                      <span className="text-dim text-xs">{r.clearing} of {r.n}</span>
                    </td>
                    <td className="num">{r.medianMultiple === null ? "-" : `${r.medianMultiple}x`}</td>
                    <td>{money(r.upside)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sets.length === 0 && (
              <p className="text-dim text-sm p-4">Nothing to group yet - the sweep has not found graded sales.</p>
            )}
          </div>
        </section>

        <p className="text-dim text-xs">
          Break-even is the raw comp plus {money(cost)}, and the multiple beside it is what the card
          has to do to stand still. It falls as the card gets dearer, which is why a flat fee makes
          grading a dear-card game: a $25 card needs 3.6x, a $200 card needs 1.3x. Turnaround on this
          tier is 90 to 100 business days, so a thin margin also costs you five months of having the
          card off the wheel.
        </p>
      </main>
    </>
  );
}
