import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { resolveTcgUrl, searchTcgSealed } from "@/lib/tcgMap";

export const maxDuration = 60;

// Preview only: works out what a pasted TCGplayer link points at, or what a
// typed product name could be, and hands back the product name, set, image and
// today's market price. Writes nothing, so the mapping panel can show the
// match and let the user confirm it is the right product before it touches
// inventory.
//
// sl-v1. { q } searches sealed product by name. Same route as the link lookup
// because the panel treats both the same way: a candidate on screen, confirmed
// by eye, saved by the one write path. A name search returns several and a
// link returns one, so the shapes stay separate - matches vs match.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}) as any);
  const q = String(body?.q || "").trim();
  const url = String(body?.url || "").trim();

  if (q) {
    try {
      const { hits, groupsRead, truncated } = await searchTcgSealed(q);
      if (hits.length === 0) {
        return NextResponse.json({
          matches: [],
          groupsRead,
          truncated: false,
          note:
            groupsRead === 0
              ? "Could not reach the TCGplayer price mirror. Try again in a minute."
              : "No sealed product matched that. Try fewer words, or the set name plus the product type.",
        });
      }
      return NextResponse.json({ matches: hits, groupsRead, truncated });
    } catch {
      return NextResponse.json({ error: "Could not reach the TCGplayer price mirror. Try again in a minute." }, { status: 502 });
    }
  }

  if (!url) return NextResponse.json({ error: "Paste a TCGplayer product link, or type a product name." }, { status: 400 });

  const result = await resolveTcgUrl(url);
  if (!result.ok || !result.match) return NextResponse.json({ error: result.reason || "Could not resolve that link." }, { status: 422 });
  return NextResponse.json({ match: result.match });
}
