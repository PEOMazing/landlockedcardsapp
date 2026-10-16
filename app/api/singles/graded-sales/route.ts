import { NextResponse } from "next/server";
import { atGet, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { cardFromParams, gradedParams, gradedQuery, latestByGrade, upside } from "@/lib/gradedSales";
import { isSlab } from "@/lib/slab";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// gs-v1. What this raw card last sold for once it was graded.
//
// One request per card, covering PSA 6 through 10 in a single call, because the
// feed parses the grade off the title and hands it back on each sale. Five
// separate requests would be five times the quota for the same answer.
//
// Nothing here writes. The graded sale is evidence for a decision somebody
// else makes - whether to send the card off - and the comp on the record stays
// exactly what it was. That is deliberate: graded sales are thin, often one
// sale in a grade, and letting a single auction result move a price
// automatically is how you end up with a $400 sticker on a $40 card.
const KEY = process.env.COMPS_API_KEY || "";
const BASE = process.env.COMPS_API_BASE || "https://api.compsapi.com";

/** Cached for an hour per card. These are sold prices, not live listings: they
 *  do not move minute to minute, and the quota is the scarce thing. */
const TTL_SECONDS = 3600;

export async function GET(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Two callers, two ways in. The singles list points at a record; the scanner
  // has no record to point at - a scan row is a photo and whatever the model
  // read off it - so it sends the fields instead. Same lookup either way.
  const q = new URL(req.url).searchParams;
  const id = q.get("id") || "";
  let card;
  let rawComp: number | null = null;

  if (id) {
    if (!isRecId(id)) return NextResponse.json({ error: "bad card id" }, { status: 400 });
    let rec: any;
    try { rec = await atGet(T.singles, id); } catch { return NextResponse.json({ error: "unknown card" }, { status: 404 }); }
    card = {
      name: rec.fields["Card Name"] || "",
      setName: rec.fields["Set Name"] || "",
      number: rec.fields["Card Number"] || "",
      language: rec.fields["Language"] || "English",
      printing: rec.fields["Printing"] || "",
      variant: rec.fields["Variant"] || "",
      condition: rec.fields["Condition"] || "Raw",
    };
    rawComp = typeof rec.fields["Comp"] === "number" ? rec.fields["Comp"] : null;
  } else {
    card = cardFromParams((k) => q.get(k));
    if (!card.name) return NextResponse.json({ error: "send a card id or at least a name" }, { status: 400 });
    const c = Number(q.get("comp"));
    rawComp = Number.isFinite(c) && c > 0 ? c : null;
  }

  // A slab already has a grade and its own comp. Answered rather than refused,
  // so the client does not have to know the rule twice.
  if (isSlab(card.condition)) {
    return NextResponse.json({ configured: !!KEY, skipped: "graded", byGrade: null, query: "" });
  }

  if (!KEY) {
    // Not an error. The page is honest about being switched off, the same way
    // the scanner is, rather than looking like every card has no graded sales.
    return NextResponse.json({ configured: false, byGrade: null, query: gradedQuery(card) });
  }

  const params = new URLSearchParams(gradedParams(card));
  try {
    const res = await fetch(`${BASE}/v1/sold?${params}`, {
      headers: { "X-API-Key": KEY, accept: "application/json" },
      next: { revalidate: TTL_SECONDS },
    });
    if (!res.ok) {
      // Say what upstream said. A dead key, a spent quota and a rate limit all
      // look identical as "no sales found", and the first two are settings
      // problems somebody can fix in a minute if they are told.
      const why = res.status === 401 || res.status === 403 ? "the comps API key was rejected"
        : res.status === 429 ? "comps API quota or rate limit reached"
        : `comps API ${res.status}`;
      return NextResponse.json({ configured: true, byGrade: null, error: why, query: params.get("q") });
    }
    const d = await res.json();
    const byGrade = latestByGrade(d?.items || [], card);
    return NextResponse.json({
      configured: true,
      query: params.get("q"),
      // Sent so the panel can show "21x raw" next to the money, which is the
      // thing actually being decided.
      rawComp,
      byGrade,
      upside: Object.fromEntries(
        Object.entries(byGrade).map(([g, row]) => [g, upside(rawComp, row?.price)]),
      ),
      // How many sales the feed returned before matching, so a card that comes
      // back empty can be told apart from a card whose title never matched.
      considered: Array.isArray(d?.items) ? d.items.length : 0,
    });
  } catch {
    return NextResponse.json({ configured: true, byGrade: null, error: "comps API unreachable", query: params.get("q") });
  }
}
