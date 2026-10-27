import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { SealedHit, searchTcgSealed } from "@/lib/tcgMap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// sl-v1. Price a list of sealed product names against TCGplayer in one pass.
// Writes nothing: this is the tool for valuing a lot someone is offering, or a
// Collectr export, before any of it is inventory.
//
// The honest part of the answer is the confidence, not the price. An exact name
// match is a price you can quote; a partial match is a price you have to look
// at, because a Booster Bundle and a Booster Box share every word but one and
// differ by a hundred dollars. So each row says which it was and nothing is
// silently promoted.
type Row = {
  name: string;
  match: SealedHit | null;
  confidence: "exact" | "close" | "weak" | "none";
  alternatives: { productName: string; groupName: string; market: number | null }[];
};

const BULK_GROUP_BUDGET = 10;

const squash = (s: string) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "");

function confidenceOf(name: string, hit: SealedHit | null, runnerUp: SealedHit | null): Row["confidence"] {
  if (!hit) return "none";
  const want = squash(name);
  const got = squash(hit.productName);
  if (want === got) return "exact";
  if (got.includes(want) || want.includes(got)) {
    // Two products that both contain the query, priced differently, is the
    // Booster Box / Booster Bundle trap. Neither one gets to be "close".
    if (runnerUp && runnerUp.nameScore === hit.nameScore) return "weak";
    return "close";
  }
  return "weak";
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}) as any);
  const names = Array.isArray(body?.names) ? body.names.map((n: any) => String(n || "").trim()).filter(Boolean) : [];
  if (names.length === 0) return NextResponse.json({ error: "Send a names array." }, { status: 400 });
  if (names.length > 40) {
    return NextResponse.json({ error: `${names.length} names is more than one request can read. Send 40 or fewer.` }, { status: 400 });
  }

  const rows: Row[] = [];
  for (const name of names) {
    let hits: SealedHit[] = [];
    try {
      // A tighter group budget than an interactive search: forty names in
      // one 60s request cannot each afford two dozen file reads. Names from
      // the same set cost nothing after the first, because the group cache is
      // shared across the whole request.
      hits = (await searchTcgSealed(name, BULK_GROUP_BUDGET)).hits;
    } catch {
      hits = [];
    }
    const hit = hits[0] || null;
    rows.push({
      name,
      match: hit,
      confidence: confidenceOf(name, hit, hits[1] || null),
      alternatives: hits.slice(1, 4).map((h) => ({ productName: h.productName, groupName: h.groupName, market: h.market })),
    });
  }

  const priced = rows.filter((r) => r.match && r.match.market !== null);
  return NextResponse.json({
    rows,
    counts: {
      asked: rows.length,
      matched: rows.filter((r) => r.match).length,
      exact: rows.filter((r) => r.confidence === "exact").length,
      priced: priced.length,
    },
    total: Math.round(priced.reduce((s, r) => s + (r.match!.market || 0), 0) * 100) / 100,
  });
}
