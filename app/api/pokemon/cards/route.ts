import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { listSetCards, searchCards, searchCardsByName } from "@/lib/pokemon";
import { printingKey, searchTcgcsvCards, vintagePrintings } from "@/lib/tcgcsvCards";

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
    const nameQuery = url.searchParams.get("nameQuery");
    if (nameQuery) return NextResponse.json({ cards: await searchCardsByName(nameQuery) });
    if (setId) {
      let cards = await listSetCards(setId);
      // vintage sets get per-printing prices layered from TCGplayer, since the
      // single pokemontcg.io price cannot say which printing it belongs to
      const vp = await vintagePrintings(setId).catch(() => null);
      if (vp) {
        cards = cards.map((c) => {
          const printings = vp.get(printingKey(c.number));
          return printings && printings.length > 0 ? { ...c, printings } : c;
        });
      }
      return NextResponse.json({ cards });
    }
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
