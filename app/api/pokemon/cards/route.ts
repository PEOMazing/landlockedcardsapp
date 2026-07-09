import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { listSetCards, searchCards } from "@/lib/pokemon";

export const dynamic = "force-dynamic";

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
    if (q) return NextResponse.json({ cards: await searchCards(q) });
    return NextResponse.json({ error: "setId or q required" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "pokemontcg.io is not responding, try again shortly" }, { status: 502 });
  }
}
