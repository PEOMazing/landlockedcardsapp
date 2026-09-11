import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { resolveTcgUrl } from "@/lib/tcgMap";

export const maxDuration = 60;

// Preview only: works out what a pasted TCGplayer link points at and hands back
// the product name, set, image and today's market price. Writes nothing, so the
// mapping panel can show the match and let the user confirm it is the right
// product before it touches inventory.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { url } = await req.json().catch(() => ({ url: "" }));
  if (!url) return NextResponse.json({ error: "Paste a TCGplayer product link first." }, { status: 400 });

  const result = await resolveTcgUrl(url);
  if (!result.ok || !result.match) return NextResponse.json({ error: result.reason || "Could not resolve that link." }, { status: 422 });
  return NextResponse.json({ match: result.match });
}
