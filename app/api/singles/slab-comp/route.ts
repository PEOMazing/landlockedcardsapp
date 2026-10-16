import { NextResponse } from "next/server";
import { atGet, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { gradedQuery } from "@/lib/gradedSales";
import { isSlab } from "@/lib/slab";
import { parseSlabGrade, slabComp, slabCompSource, slabParams, slabSales } from "@/lib/slabComp";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// sl-v1. Comp a slab from eBay sold prices.
//
// The nightly rotation cannot do this. lib/priceRefresh filters on
// RAW_CONDITIONS, so every graded card is locked out of it by design - the
// TCGplayer raw feed has no grade dimension and pricing a PSA 10 off it would
// be worse than not pricing it. That left 41 slabs carrying 40% of the book's
// comp value on numbers typed in by hand once, with nothing recording which
// sales they came from or when they stopped being true.
//
// So: same venue a person would have used, same decision written down.
//
// GET  previews without touching the record.
// POST writes the comp. Separate verbs on purpose: a slab comp off two thin
// sales is a number somebody should look at before it becomes the price on a
// $2,700 card, and the preview is what lets them.
const KEY = process.env.COMPS_API_KEY || "";
const BASE = process.env.COMPS_API_BASE || "https://api.compsapi.com";

/** An hour, same as the graded-sales panel. These are sold prices; they do not
 *  move minute to minute and the quota is the scarce thing. */
const TTL_SECONDS = 3600;

type Loaded = {
  rec: any;
  card: { name: string; setName: string; number: string; language: string; printing: string; variant: string; condition: string };
};

async function load(id: string): Promise<Loaded | { error: string; status: number }> {
  if (!isRecId(id)) return { error: "bad card id", status: 400 };
  let rec: any;
  try { rec = await atGet(T.singles, id); } catch { return { error: "unknown card", status: 404 }; }
  return {
    rec,
    card: {
      name: String(rec.fields["Card Name"] || ""),
      setName: String(rec.fields["Set Name"] || ""),
      number: String(rec.fields["Card Number"] || ""),
      language: String(rec.fields["Language"] || "English"),
      printing: String(rec.fields["Printing"] || ""),
      variant: String(rec.fields["Variant"] || ""),
      condition: String(rec.fields["Condition"] || "Raw"),
    },
  };
}

type Priced = {
  result: ReturnType<typeof slabComp>;
  grade: NonNullable<ReturnType<typeof parseSlabGrade>>;
  sales: ReturnType<typeof slabSales>;
  considered: number;
  query: string;
};

async function price(card: Loaded["card"]): Promise<Priced | { error: string; soft?: true }> {
  const grade = parseSlabGrade(card.condition);
  if (!grade) {
    // "Other" and "Other Graded" name no grade, so there is nothing to look
    // up. Said out loud rather than returned as "no sales found", because the
    // fix is to set a real grade on the card and nobody would guess that from
    // an empty result.
    return { error: `${card.condition} does not name a grade, so there is nothing to comp against. Set the grader and grade on this card.`, soft: true };
  }
  if (!KEY) return { error: "COMPS_API_KEY is not set, so eBay solds cannot be read", soft: true };

  const params = new URLSearchParams(slabParams(card, grade));
  let d: any;
  try {
    const res = await fetch(`${BASE}/v1/sold?${params}`, {
      headers: { "X-API-Key": KEY, accept: "application/json" },
      next: { revalidate: TTL_SECONDS },
    });
    if (!res.ok) {
      // Same reasoning as the graded-sales route: a dead key, a spent quota
      // and a rate limit all look like "no sales" and the first two are
      // settings somebody can fix in a minute if they are told which.
      const why = res.status === 401 || res.status === 403 ? "the comps API key was rejected"
        : res.status === 429 ? "comps API quota or rate limit reached"
        : `comps API ${res.status}`;
      return { error: why };
    }
    d = await res.json();
  } catch {
    return { error: "comps API unreachable" };
  }

  const sales = slabSales(d?.items || [], card, grade);
  return {
    grade,
    sales,
    result: slabComp(sales),
    considered: Array.isArray(d?.items) ? d.items.length : 0,
    query: params.get("q") || gradedQuery(card),
  };
}

function shape(p: Priced) {
  const r = p.result;
  return {
    grader: p.grade.grader,
    grade: p.grade.grade,
    query: p.query,
    considered: p.considered,
    // Every matching sale, not just the ones that counted, so a screen can
    // show the working. A comp that ignored a real sale should say which one.
    sales: p.sales,
    comp: r ? r.price : null,
    source: r ? slabCompSource(p.grade, r) : null,
    used: r ? r.used : [],
    dropped: r ? r.dropped : [],
    stale: r ? r.stale : false,
    asOf: r ? r.asOf : null,
    // The caller decides what to do about thin evidence; this just reports it.
    sampleSize: r ? r.used.length : 0,
  };
}

export async function GET(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id") || "";
  const loaded = await load(id);
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  if (!isSlab(loaded.card.condition)) {
    return NextResponse.json({ error: "this is a raw card, it prices through the normal rotation" }, { status: 400 });
  }

  const p = await price(loaded.card);
  if ("error" in p) {
    return NextResponse.json({ configured: !!KEY, comp: null, error: p.error }, { status: p.soft ? 200 : 502 });
  }
  return NextResponse.json({ configured: true, before: loaded.rec.fields["Comp"] ?? null, ...shape(p) });
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const id = String(body?.id || "");
  const loaded = await load(id);
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { rec, card } = loaded;
  if (!isSlab(card.condition)) {
    return NextResponse.json({ error: "this is a raw card, it prices through the normal rotation" }, { status: 400 });
  }
  // Same guard the raw path has, and for the same reason: these are the cards
  // somebody priced off eBay by hand because the feeds get them wrong, and a
  // reprice walking that back within the hour is exactly what the lock is for.
  if (rec.fields["Comp Locked"]) {
    return NextResponse.json({ error: "comp is locked - untick Comp Locked to let the reprice have it back" }, { status: 409 });
  }

  const p = await price(card);
  if ("error" in p) return NextResponse.json({ error: p.error }, { status: p.soft ? 400 : 502 });
  if (!p.result) {
    // No sales is a real answer and it means leave the hand-entered comp
    // alone. Writing a blank over a number somebody researched would be the
    // worst outcome available here.
    return NextResponse.json({
      ok: false,
      reason: `no ${p.grade.grader} ${p.grade.grade} sales matched, so the existing comp is untouched`,
      ...shape(p),
    });
  }

  const before = rec.fields["Comp"] ?? null;
  const now = new Date();
  const fields: Record<string, any> = {
    "Comp": p.result.price,
    "Comp Source": slabCompSource(p.grade, p.result),
    "Comp Date": now.toISOString().slice(0, 10),
    // Day granularity cannot order a rotation, so the timestamp is what the
    // staleness read uses. Same field, same reason as the raw path.
    "Comp Checked": now.toISOString(),
    // Feeds the existing isThinComp warning. A two sale slab comp then shows
    // as thin without anything new having to know what a slab is.
    "Comp Sales": p.result.used.length,
    "Market Basis": `${p.grade.grader} ${p.grade.grade}, eBay sold${p.result.used.length === 1 ? "" : "s"}`,
  };
  if (!(rec.fields["Entry Comp"] > 0)) fields["Entry Comp"] = p.result.price;

  try {
    await atUpdate(T.singles, id, fields);
  } catch (e: any) {
    return NextResponse.json({ error: `could not save: ${e?.message || e}` }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    before,
    movedPct: before > 0 ? Math.round((Math.abs(p.result.price - before) / before) * 1000) / 10 : null,
    ...shape(p),
  });
}
