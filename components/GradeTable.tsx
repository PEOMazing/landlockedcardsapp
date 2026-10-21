"use client";

import { Fragment, useState } from "react";
import { ALL_GRADES, SUSPECT_WHY, type GradeKey, type SuspectReason, type TriageRow } from "@/lib/gradeTriage";

// gt-v8. The ranked list, with the evidence one click away.
//
// Gabe: "I want to be able to click something to see the comps if possible."
// Which is the right instinct and the cheapest thing on the page, because the
// sweep already stores the listing title, the date and the eBay URL for every
// price it writes. Nothing here fetches. What opens up is not a fresh lookup,
// it is the actual sale the number on the row was computed from - so clicking
// a row is checking the page's own work rather than asking a second opinion.
//
// A client component only for the one piece of state that genuinely needs it:
// which row is open. The grade and condition chips stay server-rendered links,
// so a filtered view is a URL somebody can bookmark or send.

export type CompRow = {
  grade: GradeKey;
  price: number;
  date: string | null;
  title: string | null;
  url: string | null;
  /** How many sales that grade rests on, when the sweep recorded it. Null on a
   *  card last swept before the count was being written. */
  n: number | null;
  median: number | null;
  /** Set when the sanity rules threw this price out. */
  rejected: SuspectReason | null;
};

export type GradeTableRow = {
  row: TriageRow;
  comps: CompRow[];
  /** Net at the worst ticked grade, and which grade that is. */
  net: number | null;
  bindingGrade: GradeKey | null;
};

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "-"
    : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function GradeTable({
  rows,
  grades,
  maxInsured,
}: {
  rows: GradeTableRow[];
  grades: GradeKey[];
  maxInsured: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const ticked = new Set(grades);

  if (rows.length === 0) {
    return <p className="text-dim text-sm p-4">No graded sales found on any card at the grades you have ticked.</p>;
  }

  return (
    <table className="w-full">
      <thead>
        <tr>
          <th>Card</th><th>Cond</th><th>Raw</th><th>Break-even</th>
          <th>What it sold for at the grades you ticked</th>
          <th>Net at the worst</th><th>Best net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ row: r, comps, net, bindingGrade }) => {
          const isOpen = open === r.id;
          return (
            <Fragment key={r.id}>
              <tr
                onClick={() => setOpen(isOpen ? null : r.id)}
                className="cursor-pointer hover:bg-edge/30"
                title="Click to see the sales these numbers came from"
              >
                <td className="!font-medium">
                  <span className="text-dim mr-1 inline-block w-3">{isOpen ? "-" : "+"}</span>
                  {r.name}
                  {r.overInsured && (
                    <span className="text-warn text-xs ml-2" title={`A grade this card could come back as is worth more than the ${money(maxInsured)} ceiling on this tier, so it cannot go on this submission`}>
                      over insured cap
                    </span>
                  )}
                  {r.gradesWithPrice === 1 && r.bestNet !== null && r.bestNet > 0 && (
                    <span className="text-dim text-xs ml-2" title="The only graded sale on record for this card is at one grade, so there is no curve under it to sanity check against. Not wrong, just the thinnest kind of evidence this page has.">
                      one grade only
                    </span>
                  )}
                  {r.bigJump && (
                    <span className="text-dim text-xs ml-2" title={`The PSA ${r.bigJump.grade} sale is ${r.bigJump.times}x the grade below it, which is the top tenth of jumps in your binder. Real on a low-pop chase card and also what a misread listing looks like.`}>
                      {r.bigJump.times}x jump at {r.bigJump.grade}
                    </span>
                  )}
                  {r.allStale && (
                    <span className="text-dim text-xs ml-2" title="Every graded sale on record is more than six months old - read these as history, not price">
                      old sales
                    </span>
                  )}
                </td>
                <td className="text-dim num">{r.condition}</td>
                <td>{money(r.rawComp)}</td>
                <td className="text-dim">
                  {money(r.breakEven)}
                  {r.neededMultiple !== null && <span className="text-xs ml-1">({r.neededMultiple}x)</span>}
                </td>
                {/* One cell rather than a column per grade, because the ticked
                    set can be any size and ten columns of mostly dashes is
                    harder to read than a line of the ones that exist. */}
                <td className="text-xs">
                  {comps.filter((c) => ticked.has(c.grade) && !c.rejected).length === 0 ? (
                    <span className="text-dim">nothing at those grades</span>
                  ) : (
                    comps
                      .filter((c) => ticked.has(c.grade) && !c.rejected)
                      .map((c) => (
                        <span key={c.grade} className={`inline-block mr-3 whitespace-nowrap ${c.grade === bindingGrade ? "text-body font-semibold" : "text-dim"}`}>
                          {c.grade} <span className="num">{money(c.price)}</span>
                          {c.n !== null && c.n > 1 && <span className="opacity-60"> ({c.n})</span>}
                        </span>
                      ))
                  )}
                </td>
                <td className={`!font-semibold ${net !== null && net > 0 ? "text-win" : "text-bad"}`}>
                  {money(net)}
                  {bindingGrade && <span className="text-dim text-xs block">at {bindingGrade}</span>}
                </td>
                <td className="text-dim">
                  {money(r.bestNet)}{r.bestGrade ? <span className="text-xs ml-1">at {r.bestGrade}</span> : null}
                </td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={7} className="!bg-edge/20">
                    <CompPanel row={r} comps={comps} ticked={ticked} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function CompPanel({
  row,
  comps,
  ticked,
}: {
  row: TriageRow;
  comps: CompRow[];
  ticked: Set<GradeKey>;
}) {
  if (comps.length === 0) {
    return (
      <div className="p-3 text-xs text-dim">
        Nothing stored for this card. Either the sweep has not reached it or the feed returned no
        PSA sale whose title matched the card.
      </div>
    );
  }
  return (
    <div className="p-3 space-y-2">
      <p className="text-dim text-xs">
        The sales these numbers came from, as the sweep stored them. One sale per grade: the most
        recent one that matched this card. Where a count is shown it is how many matched in total
        and the median of those, which is the figure to trust when the two disagree.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>Grade</th><th>Sold for</th><th>Net on this copy</th><th>When</th>
              <th>Sales</th><th>Median</th><th>The listing</th>
            </tr>
          </thead>
          <tbody>
            {comps.map((c) => {
              const cell = row.byGrade[c.grade];
              const off = !ticked.has(c.grade);
              return (
                <tr key={c.grade} className={c.rejected || off ? "opacity-60" : ""}>
                  <td className="num">
                    PSA {c.grade}
                    {off && !c.rejected && (
                      <span className="text-dim text-xs ml-1" title="Not one of the grades you ticked, so it is not in the net on the row">
                        not ticked
                      </span>
                    )}
                  </td>
                  <td className={c.rejected ? "line-through" : ""}>{money(c.price)}</td>
                  <td className={cell.net !== null && cell.net > 0 && !c.rejected ? "text-win" : "text-dim"}>
                    {c.rejected ? "-" : money(cell.net)}
                  </td>
                  <td className="text-dim text-xs">
                    {c.date || "-"}
                    {cell.ageDays !== null && <span className="ml-1 opacity-70">({cell.ageDays}d)</span>}
                  </td>
                  <td className="text-dim num">{c.n === null ? "-" : c.n}</td>
                  <td className="text-dim num">{c.median === null ? "-" : money(c.median)}</td>
                  <td className="text-xs">
                    {c.rejected && (
                      <span className="text-warn block">ignored: {SUSPECT_WHY[c.rejected]}</span>
                    )}
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-dim hover:text-body underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.title || "open the sale"}
                      </a>
                    ) : (
                      <span className="text-dim">{c.title || "-"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ALL_GRADES.filter((g) => !comps.some((c) => c.grade === g)).length > 0 && (
        <p className="text-dim text-xs">
          No sale on record at PSA{" "}
          {ALL_GRADES.filter((g) => !comps.some((c) => c.grade === g)).join(", ")}. Ticking one of
          those does nothing for this card.
        </p>
      )}
    </div>
  );
}
