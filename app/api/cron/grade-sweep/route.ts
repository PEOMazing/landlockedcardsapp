import { NextResponse } from "next/server";
import { atList, atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { allByGrade, gradedParams, latestByGrade, medianPrice } from "@/lib/gradedSales";
import { isSlab } from "@/lib/slab";
import { ALL_GRADES, SHIP_PER_CARD, TRIAGE_GRADES, gradingCost, groupByCard, netGain, suspectQuotes, sweepBand, sweepCandidates, sweepRunsNeeded, type GradeKey, type SaleQuote } from "@/lib/gradeTriage";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// gt-v1. The rolling graded sweep: what each raw card last sold for as a PSA
// 10, 9 and 8, written onto the card so it can be sorted on.
//
// The per-card version of this has existed for a while behind the Graded
// sales panel, but it was live-only and nothing was kept, so you could answer
// "is this one worth grading" and never "which of my 1,469 are". That is the
// question worth asking, and it only works if the answers are stored.
//
// BATCH and PACE are set by two different ceilings, and it is worth being
// explicit about which is which, because the obvious one is not the binding
// one:
//
//   quota  25,000 requests a month. A full discovery pass over every card is
//          1,469 of them - six percent of one month. Quota is NOT scarce here
//          and the sweep is not designed as though it were.
//   rate   120 requests a minute. THIS is the ceiling. Two a second, so a
//          300-second run can do 600 at the absolute limit, and 150 leaves
//          plenty of headroom for the slab-comp route and anyone clicking
//          around the app while the sweep is running.
//
// gt-v6, measured rather than guessed. The first live run did 5 cards in 15.3
// seconds, so the feed takes about 2.5s a call and the real pace is 20
// requests a minute - six times under the 120 limit. Two consequences:
//
//   - PACE_MS was pure waste. The upstream latency already paces us far below
//     the rate limit, so sleeping on top of it only burned the function's
//     budget. Gone.
//   - BATCH of 150 was impossible. At 2.5s each that is 375 seconds against a
//     300-second ceiling, so the run would be killed about two thirds of the
//     way through. Not data loss - each card is written as it goes and
//     Graded Checked means the rest are simply first in the queue next time -
//     but it burns a run and shows up as a function timeout.
//
// So the limit is a TIME budget, not a card count. The loop stops when the
// next call might not finish, which is correct whatever the feed's latency
// does later. BATCH stays as a ceiling for a manual run.
const BATCH = 200;
const TIME_BUDGET_MS = 240_000;
const EXPECTED_CALL_MS = 4_000;

const KEY = process.env.COMPS_API_KEY || "";
const BASE = process.env.COMPS_API_BASE || "https://api.compsapi.com";

async function authorised(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  if (String(req.headers.get("user-agent") || "").includes("vercel-cron")) return true;
  // Hand-run from the app, so a backfill can be kicked off without waiting a
  // quarter of an hour for the next tick.
  const me = await getMe().catch(() => null);
  return !!me?.isAdmin;
}

export async function GET(req: Request) {
  if (!(await authorised(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!KEY) {
    // Not an error, the same way the per-card panel is not an error when the
    // key is missing. A cron that logs "unauthorized" every 15 minutes for a
    // setting nobody has filled in is worse than one that says what is wrong.
    return NextResponse.json({ configured: false, reason: "COMPS_API_KEY is not set" });
  }

  const url = new URL(req.url);
  const batch = Math.max(1, Math.min(BATCH, parseInt(url.searchParams.get("batch") || "") || BATCH));
  // gt-v7. Ignore the waiting periods and re-look-up everything, oldest
  // first. For after a change to what gets STORED, where the cards are not
  // due by any sensible rule but the data on them is the old shape.
  const force = url.searchParams.get("force") === "1";

  const settings = await getSettings().catch(() => null);
  const fee = Number((settings as any)?.grading_fee) || 59.99;
  const cost = gradingCost(fee, SHIP_PER_CARD);

  const rows = await atList(T.singles, {
    filterByFormula: "AND({Card Name} != '', OR({Status} = 'In Stock', {Status} = 'In Stream'))",
  }).catch(() => []);

  // Raw cards only. A slab already has a grade and its own comp; asking what
  // it would sell for graded is asking a question it has answered.
  const raw = rows.filter((r: any) => !isSlab(String(r.fields["Condition"] || "")));
  const pool = raw.map((r: any) => ({
    id: r.id,
    fields: r.fields,
    comp: typeof r.fields["Comp"] === "number" ? r.fields["Comp"] : null,
    checked: r.fields["Graded Checked"] || null,
    bestNet: typeof r.fields["Grade Best Net"] === "number" ? r.fields["Grade Best Net"] : null,
    // flattened for cardGroupKey, which groups on card identity alone
    name: r.fields["Card Name"] || "",
    setName: r.fields["Set Name"] || "",
    number: r.fields["Card Number"] || "",
    printing: r.fields["Printing"] || "",
    language: r.fields["Language"] || "English",
  }));

  // gt-v4. Batch counts CARDS, not copies. Thirty copies of one Charizard are
  // one lookup, so a run of 150 can clear far more than 150 records.
  const dueRecords = force ? pool : sweepCandidates(pool, Number.MAX_SAFE_INTEGER);
  const grouped = groupByCard(dueRecords);
  const groups = [...grouped.values()].slice(0, batch);
  const pendingGroups = grouped.size;

  let checked = 0;
  let withSales = 0;
  let quotaHit = false;
  const errors: string[] = [];

  let copies = 0;
  const startedAt = Date.now();
  let ranOutOfTime = false;
  for (const group of groups) {
    // Stop while there is still room for one more call rather than being
    // killed mid-write. Everything already written stays written.
    if (Date.now() - startedAt > TIME_BUDGET_MS - EXPECTED_CALL_MS) {
      ranOutOfTime = true;
      break;
    }
    // Any member describes the card; they differ only in condition and comp,
    // neither of which changes what a PSA 10 of it sold for.
    const f = group[0].fields;
    const cardLike = {
      name: f["Card Name"] || "",
      setName: f["Set Name"] || "",
      number: f["Card Number"] || "",
      language: f["Language"] || "English",
      printing: f["Printing"] || "",
      variant: f["Variant"] || "",
      condition: f["Condition"] || "Raw",
    };
    const params = new URLSearchParams(gradedParams(cardLike));
    // gt-v3. Every grade, not the 6-to-10 the per-card panel asks for. A PSA 1
    // on a first-edition holo is still three figures, and the floor filter
    // cannot answer "worth it if it grades badly" without the bad grades.
    params.set("grade", ALL_GRADES.join(","));
    let data: any = null;
    try {
      const res = await fetch(`${BASE}/v1/sold?${params}`, {
        headers: { "X-API-Key": KEY, accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 429) {
        // Out of road for now. Stop cleanly rather than burning the rest of
        // the batch on calls that will all fail, and leave Graded Checked
        // alone so these cards are first in the queue next run.
        quotaHit = true;
        break;
      }
      if (!res.ok) {
        errors.push(`${f["Card Name"]}: comps API ${res.status}`);
        continue;
      }
      data = await res.json();
    } catch {
      errors.push(`${f["Card Name"]}: comps API unreachable`);
      continue;
    }

    const byGrade = latestByGrade(data?.items || [], cardLike);
    // gt-v7. Stored alongside the latest sale so the next read can tell one
    // observation from nine. Nothing uses the median to decide yet - the
    // ranking still runs off the latest sale, filtered - but it cannot start
    // using it until it is being written, and writing it costs no extra call.
    const everyGrade = allByGrade(data?.items || [], cardLike);

    // The prices belong to the CARD and are identical for every copy.
    const prices: Record<string, number | null> = {};
    const detail: Record<string, any> = { q: params.get("q"), cost };
    const quotes: Partial<Record<GradeKey, SaleQuote>> = {};
    let any = false;
    for (const g of ALL_GRADES as GradeKey[]) {
      const row = (byGrade as any)[g] || null;
      const price = row && Number(row.price) > 0 ? Number(row.price) : null;
      prices[g] = price;
      if (price !== null) {
        any = true;
        const rows = everyGrade[g] || [];
        detail[g] = {
          price, date: row.date || null, title: row.title || null, url: row.url || null,
          // how many sales this grade rests on, and their middle
          n: rows.length,
          median: medianPrice(rows),
        };
        quotes[g] = { price, date: row.date || null, title: row.title || null };
      }
    }

    // gt-v7. The same rules the page reads with, applied before the column is
    // written. Without this the stored Grade Best Net and the figure on screen
    // disagree about every card whose best price was a lot or an asking price,
    // and the one that drives the Airtable views and the sweep's own banding
    // is the stored one - so a $100,000 Charizard would have stayed at the top
    // of the refresh queue forever on the strength of a number nothing else
    // believed.
    const suspect = suspectQuotes(quotes);
    for (const g of ALL_GRADES as GradeKey[]) {
      if (suspect[g]) {
        prices[g] = null;
        if (detail[g]) detail[g].ignored = suspect[g];
      }
    }
    const detailJson = any ? JSON.stringify(detail) : "";
    const stamp = new Date().toISOString();
    checked++;
    if (any) withSales++;

    // The NET belongs to the copy. An LP copy is cheaper to give up than the
    // NM one beside it, so the same graded price nets it more.
    for (const rec of group) {
      const rawComp = typeof rec.fields["Comp"] === "number" ? rec.fields["Comp"] : null;
      const write: Record<string, any> = { "Graded Checked": stamp, "Graded Detail": detailJson };
      let best: number | null = null;
      // The three columns carry the price being USED, so a sort inside
      // Airtable cannot surface a number the app has rejected.
      for (const g of TRIAGE_GRADES as GradeKey[]) write[`PSA ${g} Sale`] = prices[g] ?? null;
      for (const g of ALL_GRADES as GradeKey[]) {
        const net = netGain(rawComp, prices[g], cost);
        // Greater-or-equal walking high to low so a tie lands on the lower
        // grade, matching lib/gradeTriage. The two must not disagree: this
        // writes the number the view then sorts on.
        if (net !== null && (best === null || net >= best)) best = net;
      }
      write["Grade Best Net"] = best;
      try {
        await atUpdate(T.singles, rec.id, write);
        copies++;
      } catch {
        errors.push(`${f["Card Name"]}: could not write`);
      }
    }
  }

  const remaining = Math.max(0, pendingGroups - checked);
  // Which bands the backlog is in, because a run that is all band 1 means the
  // first pass is still going and one that is all band 2 means it is finished
  // and this is the weekly refresh.
  const bands = { new: 0, live: 0, cold: 0 };
  for (const r of pool) bands[sweepBand(r, 25)]++;
  return NextResponse.json({
    configured: true,
    forced: force,
    bands,
    // cards looked up, and records written - the gap between them is the
    // saving from grouping copies.
    cardsChecked: checked,
    copiesWritten: copies,
    withSales,
    quotaHit,
    ranOutOfTime,
    elapsedSec: Math.round((Date.now() - startedAt) / 100) / 10,
    rawRecords: pool.length,
    distinctCardsDue: pendingGroups,
    remaining,
    runsLeft: sweepRunsNeeded(remaining, batch),
    fee,
    cost,
    errors: errors.slice(0, 10),
  });
}
