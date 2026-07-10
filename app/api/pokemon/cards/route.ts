import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { listSetCards, searchCards } from "@/lib/pokemon";
import { searchRecentTcgcsvCards } from "@/lib/tcgcsv";
import { searchTcgcsvCards } from "@/lib/tcgcsvCards";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ?setId=xyz -> full checklist for a set
// ?q=charizard -> name search across all sets
export async function GET(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const setId = url.searchParams.get("setId");
  const q = url.searchParams.get("q");
  try {
    if (setId) return NextResponse.json({ cards: await listSetCards(setId) });
    if (q) {
      // TCGplayer catalog (via tcgcsv) covers the newest sets first; pokemontcg.io
      // fills in older cards. Dedupe by name+number, TCGplayer entries win.
      const tcg = await searchTcgcsvCards(q).catch(() => []);
      const poke = tcg.length >= 30 ? [] : await searchCards(q).catch(() => []);
      const seen = new Set(tcg.map((c) => `${c.name.toLowerCase()}|${c.number}`));
      const merged = [...tcg, ...poke.filter((c) => !seen.has(`${c.name.toLowerCase()}|${c.number}`))].slice(0, 30);
      return NextResponse.json({ cards: merged });
    }
    return NextResponse.json({ error: "setId or q required" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "pokemontcg.io is not responding, try again shortly" }, { status: 502 });
  }
}
