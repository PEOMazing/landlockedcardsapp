import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import GradeTable, { type CompRow, type GradeTableRow } from "@/components/GradeTable";
import StatTile from "@/components/ui/StatTile";
import { atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { isSlab } from "@/lib/slab";
import {
  ALL_GRADES, MIN_SAMPLE, SHIP_PER_CARD, SUSPECT_WHY, gradeCoverage, gradeSetFromFloor,
  gradingCost, parseGradeSet, rankBySet, rollupSetUpside, sweepCandidates, triage,
  worstOfSet, type GradeKey, type SuspectReason, type TriageCard,
} from "@/lib/gradeTriage";

export const dynamic = "force-dynamic";

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "-"
    : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The raw ladder, best to worst. Only the ones actually in the binder get a
 *  chip, so this is the order rather than the list. */
const CONDITION_ORDER = ["NM", "LP", "MP", "HP", "DM", "Raw"];

// gt-v1. Which raw cards are worth sending off to be graded.
//
// Every number here is CONDITIONAL and that is deliberate. The page will tell
// you what a card makes if it lands a 10, and what it makes if it lands an 8.
// It will not tell you which it will land, because nobody knows that, and a
// single expected-value column blending the two with an invented probability
// would look far more authoritative than it had any right to.
//
// gt-v8. Two filters, and they do different jobs, which is the thing to keep
// straight when reading the page:
//
//   condition (?cond)  picks WHICH CARDS. "Show me my NM copies."
//   grades    (?g)     picks WHICH OUTCOMES. "Assume it 9s or 10s."
//
// The condition filter is the more important of the two and it took the first
// full sweep to see why. Graded price belongs to the CARD, so every copy of a
// card carries the same PSA 10 figure; the net belongs to the COPY, because it
// subtracts that copy's own raw comp. An LP copy is cheaper to give up, so it
// shows a BIGGER net than the NM one beside it - while being far less likely
// to come back a 9 or a 10 at all. Every word of that maths is right and
// reading it without the condition in front of you is how you send the wrong
// copy. Hence the column, and hence being able to say "NM only".
export default async function GradingPage({
  searchParams,
}: {
  searchParams?: { floor?: string; g?: string; cond?: string };
}) {
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

  // gt-v8. The stored sales per card, which is what a row expands to show.
  // Built here rather than inside triage: the decision does not need the
  // listing URL, the person checking the decision does.
  const comps = new Map<string, CompRow[]>();

  const cards: TriageCard[] = raw.map((r) => {
    let detail: any = {};
    try { detail = JSON.parse(String(r.fields["Graded Detail"] || "{}")); } catch { detail = {}; }
    const grades: TriageCard["grades"] = {};
    const found: CompRow[] = [];
    for (const g of ALL_GRADES) {
      // Every grade comes out of the JSON; only 10, 9 and 8 have columns.
      const price = Number(detail?.[g]?.price);
      const ok = Number.isFinite(price) && price > 0;
      grades[g as GradeKey] = {
        price: ok ? price : null,
        date: detail?.[g]?.date || null,
        // gt-v7. The title travels with the price because the title is how a
        // lot of thirty slabs priced as one card gets caught.
        title: detail?.[g]?.title || null,
      };
      if (ok) {
        const n = Number(detail[g]?.n);
        const med = Number(detail[g]?.median);
        found.push({
          grade: g as GradeKey,
          price,
          date: detail[g]?.date || null,
          title: detail[g]?.title || null,
          url: detail[g]?.url || null,
          n: Number.isFinite(n) && n > 0 ? n : null,
          median: Number.isFinite(med) && med > 0 ? med : null,
          rejected: null,
        });
      }
    }
    comps.set(r.id, found);
    return {
      id: r.id,
      name: [r.fields["Card Name"], r.fields["Set Name"]].filter(Boolean).join(" - "),
      setName: r.fields["Set Name"] || "",
      rarity: r.fields["Rarity"] || "",
      condition: r.fields["Condition"] || "Raw",
      rawComp: typeof r.fields["Comp"] === "number" ? r.fields["Comp"] : null,
      grades,
      checked: r.fields["Graded Checked"] || null,
    };
  });

  // gt-v8. The grades being bet on. ?g is the set; ?floor is kept because
  // links from before this existed should not break, and a floor is exactly
  // the set of that grade and everything above it.
  const picked =
    parseGradeSet(searchParams?.g) ??
    ((ALL_GRADES as string[]).includes(String(searchParams?.floor))
      ? gradeSetFromFloor(String(searchParams?.floor) as GradeKey)
      : gradeSetFromFloor("9"));

  const everyRow = cards.map((c) => triage(c, { fee, maxInsured }));

  // Which conditions are actually in the binder, with counts, so a chip is
  // never offered for something that would empty the table.
  const condCounts = new Map<string, number>();
  for (const r of everyRow) condCounts.set(r.condition, (condCounts.get(r.condition) || 0) + 1);
  const conditions = CONDITION_ORDER.filter((c) => condCounts.has(c))
    .concat([...condCounts.keys()].filter((c) => !CONDITION_ORDER.includes(c)).sort());

  const wantCond = new Set(
    String(searchParams?.cond ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => condCounts.has(s)),
  );
  const all = wantCond.size ? everyRow.filter((r) => wantCond.has(r.condition)) : everyRow;

  // The rejection rules run per card, so a price can be thrown out on a card
  // the condition filter then hides. The marks come off the row, not a second
  // pass, so they always agree with the net beside them.
  for (const r of all) {
    const list = comps.get(r.id);
    if (!list) continue;
    for (const c of list) c.rejected = (r.byGrade[c.grade]?.suspect ?? null) as SuspectReason | null;
  }

  const worth = all.filter((r) => {
    const w = worstOfSet(r, picked);
    return w !== null && w.net > 0;
  });
  const upsideTotal = worth.reduce((a, r) => a + (worstOfSet(r, picked)?.net || 0), 0);
  // A Map rather than a find inside a filter: twelve hundred records against
  // twelve hundred is a million and a half comparisons for a count.
  const checkedById = new Map(cards.map((c) => [c.id, !!c.checked]));
  const checkedCount = all.filter((r) => checkedById.get(r.id)).length;
  // Counted over the same cards the rest of the page is showing, so "looked up
  // 50 of 50" and "still to check 1,058" can never sit side by side.
  const pending = sweepCandidates(
    raw
      .filter((r) => !wantCond.size || wantCond.has(String(r.fields["Condition"] || "Raw")))
      .map((r) => ({
        comp: typeof r.fields["Comp"] === "number" ? r.fields["Comp"] : null,
        checked: r.fields["Graded Checked"] || null,
        bestNet: typeof r.fields["Grade Best Net"] === "number" ? r.fields["Grade Best Net"] : null,
      })),
    Number.MAX_SAFE_INTEGER,
  ).length;
  const sets = rollupSetUpside(all, picked).slice(0, 25);
  const coverage = gradeCoverage(all);
  // Worst first: the hundred-thousand-dollar claim is the one to settle.
  const checkList = all
    .filter((r) => r.suspectCount > 0)
    .sort((a, b) => (b.topRejected || 0) - (a.topRejected || 0));

  // Chip links. Each one is the current URL with that one value flipped, so
  // the filtered view stays a thing you can bookmark or send to somebody.
  const href = (over: { g?: GradeKey[]; cond?: string[] }) => {
    const g = over.g ?? picked;
    const cond = over.cond ?? [...wantCond];
    const p = new URLSearchParams();
    // Always written out, even when every grade is ticked. Leaving it off to
    // keep the URL tidy meant "all ten ticked" produced a URL with no g on it,
    // which the parser then read as no answer and filled in with the default
    // PSA 9 floor - so ticking the last chip silently undid the other nine.
    if (g.length) p.set("g", g.join(","));
    if (cond.length) p.set("cond", cond.join(","));
    const q = p.toString();
    return q ? `/grading?${q}` : "/grading";
  };
  // Unticking the LAST grade is not offered. A card has to be judged against
  // something, and an empty set would have meant the same silent fall back to
  // the default that the comment above describes.
  const toggleGrade = (g: GradeKey) =>
    picked.length === 1 && picked[0] === g
      ? null
      : href({ g: picked.includes(g) ? picked.filter((x) => x !== g) : ALL_GRADES.filter((x) => x === g || picked.includes(x)) });
  const toggleCond = (c: string) =>
    href({ cond: wantCond.has(c) ? [...wantCond].filter((x) => x !== c) : [...wantCond, c] });

  // Ranked by the number the table prints, not by the best across all ten
  // grades: sorting on one figure and showing another asserts an order the
  // figures contradict.
  const tableRows: GradeTableRow[] = rankBySet(all, picked)
    .filter((r) => worstOfSet(r, picked) !== null)
    .slice(0, 200)
    .map((r) => {
      const w = worstOfSet(r, picked);
      return {
        row: r,
        comps: comps.get(r.id) || [],
        net: w?.net ?? null,
        bindingGrade: w?.grade ?? null,
      };
    });

  const label = picked.length === ALL_GRADES.length ? "any grade" : `PSA ${picked.join(", ")}`;

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
            never how likely that is. Each one is also a single sale, the most recent at that
            grade, so read a big number as a lead to check rather than a fact. Click any row to see
            the sale it came from. Prices that failed a sanity check are listed further down
            instead of counted.
          </p>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-start gap-3 flex-wrap text-xs">
            <span className="text-dim pt-1 w-28 shrink-0">assume it grades</span>
            <span className="flex items-center gap-1.5 flex-wrap">
              {ALL_GRADES.map((g) => {
                const on = picked.includes(g);
                const n = coverage[g];
                const to = toggleGrade(g);
                const cls = `px-2 py-1 rounded border num transition-colors ${
                  on
                    ? n === 0
                      ? "border-warn/60 text-warn"
                      : "border-foil bg-foil/15 text-foil font-semibold"
                    : "border-edge text-dim hover:text-body"
                } ${n === 0 ? "opacity-50" : ""}`;
                const title =
                  to === null
                    ? "The only grade ticked. A card has to be judged against something, so tick another before dropping this one."
                    : n === 0
                      ? `No card in this view has a usable PSA ${g} sale on record, so ticking it changes nothing`
                      : `${n} card${n === 1 ? "" : "s"} have a PSA ${g} sale on record`;
                const body = (
                  <>
                    {g}
                    <span className="opacity-60 ml-1">{n}</span>
                  </>
                );
                return to === null ? (
                  <span key={g} title={title} className={`${cls} cursor-default`}>{body}</span>
                ) : (
                  <a key={g} href={to} aria-pressed={on} title={title} className={cls}>{body}</a>
                );
              })}
            </span>
          </div>
          <div className="flex items-start gap-3 flex-wrap text-xs">
            <span className="text-dim pt-1 w-28 shrink-0">condition</span>
            <span className="flex items-center gap-1.5 flex-wrap">
              <a
                href={href({ cond: [] })}
                className={`px-2 py-1 rounded border transition-colors ${
                  wantCond.size === 0 ? "border-foil bg-foil/15 text-foil font-semibold" : "border-edge text-dim hover:text-body"
                }`}
              >
                all
              </a>
              {conditions.map((c) => (
                <a
                  key={c}
                  href={toggleCond(c)}
                  aria-pressed={wantCond.has(c)}
                  className={`px-2 py-1 rounded border transition-colors ${
                    wantCond.has(c) ? "border-foil bg-foil/15 text-foil font-semibold" : "border-edge text-dim hover:text-body"
                  }`}
                >
                  {c}
                  <span className="opacity-60 ml-1 num">{condCounts.get(c)}</span>
                </a>
              ))}
            </span>
          </div>
          <p className="text-dim text-xs">
            The two do different jobs. Condition picks which <em>cards</em>; the grades pick which
            <em> outcomes</em>, and a card is judged on the worst grade you tick - ticking three and
            being shown the best of them would be picking the outcomes and then ignoring the pick.
            Ticking more grades is the harsher test, so the list gets shorter as you add them.
            Worth knowing before you read a net: an LP copy shows a <em>bigger</em> net than the NM
            one beside it, because it is cheaper to give up, while being much less likely to come
            back a 9 or a 10. That is why the column is here.
          </p>
        </div>

        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatTile label={`Worth sending at ${label}`} value={String(worth.length)} size="md" tone={worth.length > 0 ? "win" : undefined} />
          <StatTile label="Upside on those" value={money(upsideTotal)} size="md" tone="win" />
          <StatTile label="Cards looked up" value={`${checkedCount} / ${all.length}`} size="md" />
          <StatTile label="Still to check" value={String(pending)} size="md" />
          <StatTile label="Prices not believed" value={String(checkList.length)} size="md" tone={checkList.length > 0 ? "warn" : undefined} />
        </section>

        {checkedCount === 0 && (
          <div className="card p-5 text-sm">
            <p className="font-medium mb-1">Nothing looked up yet.</p>
            <p className="text-dim">
              The sweep runs every 15 minutes and works through the binder dearest-first, so the
              obvious money lands in the first run. All {all.length} raw cards get looked at
              exactly once, cheap ones included, because a $5 card whose PSA 10 sells for $500 is
              the find worth having and a price filter would hide it.
            </p>
          </div>
        )}

        <div className="card overflow-x-auto">
          <GradeTable rows={tableRows} grades={picked} maxInsured={maxInsured} />
        </div>

        {checkList.length > 0 && (
          <section className="space-y-2">
            <h2 className="label">Prices I did not believe</h2>
            <p className="text-dim text-xs">
              Every figure on this page is ONE sale - the most recent at that grade - so a single
              bad listing is a whole column. These {checkList.length} cards had a price thrown out
              and are not counted in anything above. Three things get a price dropped: the listing
              reads as more than one card, the price sits above a higher grade, or it is a round
              number several times the grade below it. Click the sale to settle it. Dropping only
              ever removes upside, so nothing here is being hidden from you - it is being held
              back until somebody looks.
            </p>
            <div className="card overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Card</th><th>Cond</th><th>Grade</th><th>Price ignored</th><th>Why</th><th>The listing</th>
                  </tr>
                </thead>
                <tbody>
                  {checkList.slice(0, 60).flatMap((r) =>
                    ALL_GRADES.filter((g) => r.byGrade[g].suspect).map((g) => {
                      const cell = r.byGrade[g];
                      const url = (comps.get(r.id) || []).find((c) => c.grade === g)?.url;
                      return (
                        <tr key={`${r.id}-${g}`}>
                          <td className="!font-medium">{r.name}</td>
                          <td className="text-dim num">{r.condition}</td>
                          <td className="num">PSA {g}</td>
                          <td className="num">{money(cell.rejected)}</td>
                          <td className="text-dim text-xs">{cell.suspect ? SUSPECT_WHY[cell.suspect] : ""}</td>
                          <td className="text-dim text-xs max-w-md truncate" title={cell.title || ""}>
                            {url ? (
                              <a href={url} target="_blank" rel="noreferrer" className="hover:text-body underline">
                                {cell.title || "open the sale"}
                              </a>
                            ) : (cell.title || "-")}
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="label">What to buy</h2>
          <p className="text-dim text-xs">
            The same evidence read the other way round. The list above says what to do with cards
            you already have; this says what to go and acquire. Grouped by set AND rarity, because
            a set&apos;s commons and its art rares are not one population and averaging them
            describes nothing. The multiple is a median of the worst ticked grade, so one chase
            card cannot drag a set somewhere no individual card lives. Rows under {MIN_SAMPLE}{" "}
            cards are marked thin and sort last - a 100% on three cards is not a better signal than
            an 80% on forty - and so is a row where most of the cards stand on a single sale
            apiece, however many of them there are.
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
                      {r.thin && (
                        <span
                          className="text-dim text-xs ml-1"
                          title={
                            r.n < MIN_SAMPLE
                              ? `Only ${r.n} cards, so the share is not a rate`
                              : `${r.oneGrade} of ${r.n} of these rest on a single graded sale with no other grade to check it against`
                          }
                        >
                          thin
                        </span>
                      )}
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
