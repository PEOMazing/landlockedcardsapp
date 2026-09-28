import { NextResponse } from "next/server";
import { T, atCreate, atGet, atList, atUpdate, isRecId } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { claimFields, rollDecision, sourceLineFix } from "@/lib/rollover";

export const dynamic = "force-dynamic";

// Roll the unhit singles off a finished show onto this one.
//
// GET with no ?from lists the shows worth pulling from. GET with ?from
// previews that show's cards and says which can move and why the rest cannot.
// POST moves the ones the streamer ticked.
//
// The decision itself lives in lib/rollover so the preview and the write
// cannot drift apart: the list someone ticks through is the same function that
// runs against each line a moment later.

async function guard(id: string) {
  const me = await getMe();
  if (!me?.isTeam) return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  if (!isRecId(id)) return { err: NextResponse.json({ error: "bad id" }, { status: 400 }) };
  const stream = await atGet(T.streams, id).catch(() => null);
  if (!stream || !ownsStream(me, stream)) {
    return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { me, stream };
}

const linesFor = (streamId: string) =>
  atList(T.lines, { filterByFormula: `{Stream Rec Id} = '${streamId}'` }).catch(() => [] as any[]);

// Cards for a batch of lines, in one query rather than one per card.
async function cardsFor(lines: any[]) {
  const ids = Array.from(new Set(lines.map((l) => String(l.fields["Single Rec Id"] || "")).filter(isRecId)));
  if (!ids.length) return new Map<string, any>();
  const rows = await atList(T.singles, {
    filterByFormula: `OR(${ids.map((i) => `RECORD_ID() = '${i}'`).join(", ")})`,
  }).catch(() => [] as any[]);
  return new Map<string, any>(rows.map((r) => [r.id, r] as [string, any]));
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("err" in g) return g.err;
  const from = new URL(req.url).searchParams.get("from") || "";

  if (!from) {
    // Shows that still have unhit singles on them, newest first. A show with
    // nothing left to roll is only noise in the picker.
    const streams = await atList(T.streams, {
      "sort[0][field]": "Stream Date",
      "sort[0][direction]": "desc",
      maxRecords: "12",
    }).catch(() => [] as any[]);
    const out: any[] = [];
    for (const s of streams) {
      if (s.id === params.id || s.fields["Deleted At"]) continue;
      const lines = await linesFor(s.id);
      const n = lines.filter(
        (l) =>
          isRecId(String(l.fields["Single Rec Id"] || "")) &&
          !l.fields["Is Giveaway"] &&
          !l.fields["Is Store Purchase"] &&
          (Number(l.fields["Qty"]) || 0) - (Number(l.fields["Qty Hit"]) || 0) > 0,
      ).length;
      if (n > 0) out.push({ id: s.id, title: s.fields["Title"] || "", date: s.fields["Stream Date"] || "", left: n });
      if (out.length >= 6) break;
    }
    return NextResponse.json({ sources: out });
  }

  if (!isRecId(from)) return NextResponse.json({ error: "bad from" }, { status: 400 });
  const src = await atGet(T.streams, from).catch(() => null);
  if (!src || !ownsStream(g.me, src)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const returned = !!src.fields["Items Returned"];
  const lines = await linesFor(from);
  const cards = await cardsFor(lines);
  const cardsOut = lines
    .map((l) => {
      const sid = String(l.fields["Single Rec Id"] || "");
      const d = rollDecision(l, cards.get(sid) || null, from, returned);
      return {
        lineId: l.id,
        name: String(l.fields["Line"] || "").replace(/^\d+x\s+/, ""),
        market: Number(l.fields["Market Price Snapshot"]) || 0,
        qty: Math.max(0, (Number(l.fields["Qty"]) || 0) - (Number(l.fields["Qty Hit"]) || 0)),
        can: d.action !== "skip",
        why: d.reason || "",
        sealed: d.reason === "sealed product",
      };
    })
    // Sealed lines are not what this is for and would bury the cards.
    .filter((c) => !c.sealed)
    .sort((a, b) => Number(b.can) - Number(a.can) || b.market - a.market);

  return NextResponse.json({
    from: { id: src.id, title: src.fields["Title"] || "", returned },
    cards: cardsOut,
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("err" in g) return g.err;
  if (g.stream.fields["Items Returned"]) {
    return NextResponse.json({ error: "this show is closed - roll into a show that is still open" }, { status: 400 });
  }
  const b = await req.json().catch(() => ({} as any));
  const from = String(b?.from || "");
  const want: string[] = Array.isArray(b?.lineIds) ? b.lineIds.map(String) : [];
  if (!isRecId(from)) return NextResponse.json({ error: "from required" }, { status: 400 });
  if (from === params.id) return NextResponse.json({ error: "that is the same show" }, { status: 400 });
  if (!want.length) return NextResponse.json({ error: "nothing selected" }, { status: 400 });

  const src = await atGet(T.streams, from).catch(() => null);
  if (!src || !ownsStream(g.me, src)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const returned = !!src.fields["Items Returned"];
  const all = await linesFor(from);
  const lines = all.filter((l) => want.includes(l.id));
  const cards = await cardsFor(lines);

  let moved = 0;
  const skipped: { name: string; why: string }[] = [];
  for (const l of lines) {
    const sid = String(l.fields["Single Rec Id"] || "");
    const card = cards.get(sid) || null;
    const d = rollDecision(l, card, from, returned);
    const name = String(l.fields["Line"] || "");
    if (d.action === "skip") { skipped.push({ name, why: d.reason || "" }); continue; }

    try {
      // Take the card first, then write the line. Same order as the singles
      // picker and for the same reason: a card claimed with no line is a card
      // that can be put back, while a line with no claim is a card two shows
      // both believe they are holding.
      let copy = !!l.fields["Single Copy"];
      if (d.action === "repoint") {
        await atUpdate(T.singles, sid, { "Stream Rec Id": params.id });
        copy = false;
      } else if (d.action === "claim") {
        const c = claimFields(card, params.id);
        await atUpdate(T.singles, sid, c.fields);
        copy = c.copy;
      } // move-copy touches no card: the copy is the line

      await atCreate(T.lines, {
        "Line": String(l.fields["Line"] || "").replace(/^\d+x\s+/, "1x "),
        "Qty": 1,
        "Qty Hit": 0,
        "Buy Price Snapshot": l.fields["Buy Price Snapshot"] ?? 0,
        "Market Price Snapshot": l.fields["Market Price Snapshot"] ?? 0,
        "Is Giveaway": false,
        "Stream": [params.id],
        "Stream Rec Id": params.id,
        "Single Rec Id": sid,
        "Single Copy": copy,
      });

      const fix = sourceLineFix(l, d);
      if (fix && l.id) await atUpdate(T.lines, l.id, fix);
      moved++;
    } catch (e: any) {
      skipped.push({ name, why: String(e?.message || e).slice(0, 80) });
    }
  }
  return NextResponse.json({ moved, skipped });
}
