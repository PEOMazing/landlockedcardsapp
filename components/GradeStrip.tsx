"use client";
import { PSA_GRADES, type GradeSales } from "@/lib/gradedSales";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export type GradedData = {
  configured?: boolean;
  skipped?: string;
  error?: string;
  query?: string;
  rawComp?: number | null;
  byGrade?: GradeSales | null;
  upside?: Record<string, number | null>;
  considered?: number;
};

// gs-v1. The five grade rows, 10 down to 6: what one last sold for, when, and
// how many times the raw price that is.
//
// Lives in its own component because two screens need exactly this and they are
// nothing alike otherwise - the singles list opens it in a popover on a chip,
// the scanner prints it straight under the row while you are standing over
// somebody's binder. Rendering it twice would be two things to keep in step.

export default function GradeStrip({ data, compact = false }: { data: GradedData; compact?: boolean }) {
  if (data.configured === false) {
    return (
      <div className="text-xs">
        Graded sales are not switched on. Add a
        <span className="num"> COMPS_API_KEY </span>
        in the Vercel project settings and redeploy.
      </div>
    );
  }
  if (data.skipped === "graded") {
    return <div className="text-xs text-dim">Already graded, so its own comp is the answer.</div>;
  }
  if (data.skipped === "cheap") {
    return <div className="text-xs text-dim">Too cheap to be worth grading, so no lookup was spent on it.</div>;
  }
  if (data.error) return <div className="text-xs text-bad">{data.error}</div>;
  if (!data.byGrade) return null;

  return (
    <div className="space-y-1">
      {/* PSA_GRADES, never Object.keys: those keys are integer-like and
          JavaScript hands them back 6 first, which renders the columns
          backwards. */}
      {PSA_GRADES.map((g) => {
        const row = data.byGrade?.[g];
        const mult = data.upside?.[g] ?? null;
        // On the scanner there is no room for five empty rows next to every
        // card, and a grade with no sale is not information worth the space.
        if (compact && !row) return null;
        return (
          <div key={g} className="flex items-center gap-2 text-xs">
            <span className="w-10 shrink-0 text-dim">PSA {g}</span>
            {row ? (
              <>
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="num font-semibold hover:text-foil"
                  title={row.title}
                >
                  {$(row.price)}
                </a>
                <span className="text-dim">{row.date}</span>
                {row.format === "AUCTION" && <span className="text-dim opacity-70">auction</span>}
                {row.bestOffer && <span className="text-dim opacity-70">best offer</span>}
                {mult !== null && (
                  <span className={`ml-auto num ${mult >= 5 ? "text-ok" : "text-dim"}`}>{mult}x</span>
                )}
              </>
            ) : (
              <span className="text-dim opacity-60">no sale in the last year</span>
            )}
          </div>
        );
      })}
      {compact && PSA_GRADES.every((g) => !data.byGrade?.[g]) && (
        <div className="text-xs text-dim opacity-60">
          No PSA sales found{data.query ? ` for "${data.query}"` : ""}
        </div>
      )}
    </div>
  );
}
