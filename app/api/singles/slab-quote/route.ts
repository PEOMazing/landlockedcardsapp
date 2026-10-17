import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { quoteSlab } from "@/lib/slabIntake";

export const dynamic = "force-dynamic";

// si-v1. What a pasted block of sold listings is worth, before anything is
// written.
//
// Read-only on purpose. The add form calls this as you paste so the number and
// its working are on screen BEFORE you commit a card, which is the difference
// between a comp you agreed with and one you discovered later. Nothing here
// touches Airtable; POST /api/singles re-runs the same quoteSlab call on the
// way in, so the previewed number and the stored number cannot disagree.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam && !me?.isCollector) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const b = await req.json().catch(() => ({} as any));
  const paste = String(b?.paste || "");
  // Pasting a whole results page is normal; pasting a novel is not, and this
  // is parsed line by line on a request thread.
  if (paste.length > 200_000) {
    return NextResponse.json({ error: "that paste is too large - select just the sold results" }, { status: 413 });
  }

  const q = quoteSlab(String(b?.grader || ""), String(b?.grade || ""), paste);

  return NextResponse.json({
    ok: q.ok,
    price: q.price,
    source: q.source,
    notes: q.notes,
    // The sales, tagged with whether each one counted, so the form can show
    // the working rather than asserting a number. Same discipline as the scan
    // page: a comp that sets a real sale aside should say which one.
    sales: q.parsed.map((s) => {
      const used = !!q.result?.used.includes(s);
      const dropped = !!q.result?.dropped.includes(s);
      const askOnly = !!q.result?.askOnly.includes(s);
      return {
        date: s.date,
        price: s.price,
        askingPrice: s.askingPrice ?? null,
        bestOffer: s.bestOffer,
        format: s.format,
        title: s.title,
        used,
        why: used ? "counted" : askOnly ? "price not published" : dropped ? "set aside" : "outside the window",
      };
    }),
    step: q.result?.step ?? null,
    stale: q.result?.stale ?? false,
    count: q.result?.used.length ?? 0,
  });
}
