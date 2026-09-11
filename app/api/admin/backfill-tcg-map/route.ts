import { NextResponse } from "next/server";
import { T, atList, atUpdate } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { groupFromSlug, parseTcgUrl } from "@/lib/tcgMap";

export const maxDuration = 60;

// One-time (and safely repeatable) pass over every product that already carries
// a TCGplayer link, working out its set from the link and storing it. After this
// runs, those products are priced by exact id like a freshly mapped one instead
// of falling back to name matching.
export async function POST() {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rows = await atList(T.inventory);
  let mapped = 0;
  let already = 0;
  const unresolved: { name: string; url: string }[] = [];

  for (const r of rows) {
    const url = String(r.fields["TCGplayer URL"] || "");
    if (!url.includes("tcgplayer.com")) continue;
    if (Number(r.fields["TCG Group Id"]) > 0 && Number(r.fields["TCG Category Id"]) > 0) {
      already++;
      continue;
    }
    const parsed = parseTcgUrl(url);
    if (!parsed) {
      unresolved.push({ name: r.fields["Product Name"] || "", url });
      continue;
    }
    const g = await groupFromSlug(parsed.categoryId, parsed.rest).catch(() => null);
    if (!g) {
      unresolved.push({ name: r.fields["Product Name"] || "", url });
      continue;
    }
    await atUpdate(T.inventory, r.id, {
      "TCG Group Id": g.groupId,
      "TCG Category Id": parsed.categoryId,
      // normalise away tracking params while we are here
      "TCGplayer URL": `https://www.tcgplayer.com/product/${parsed.productId}/${parsed.slug}`,
    });
    mapped++;
  }

  return NextResponse.json({ mapped, already, unresolved });
}
