import { NextResponse } from "next/server";
import { atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { formatCardNo } from "@/lib/cardNo";

export const dynamic = "force-dynamic";

// The index behind the command palette.
//
// Deliberately its own route rather than reusing /api/singles and
// /api/inventory. Those return every column of every record, which is four
// figures of JSON and, against Airtable's 100-record pages, a dozen sequential
// round trips each. Pressing Cmd+K should not cost more than opening the page
// you are trying to avoid opening.
//
// So: three fields per row, nothing computed, and one cached read per table.
// The whole payload for 800 singles and 1,200 products is a few hundred KB,
// the client holds it for the session, and every keystroke after that is a
// filter over an array in memory.
const TTL = 60 * 1000;
let cache: { at: number; key: string; body: any } | undefined;

type Row = { id: string; label: string; sub: string; href: string; kind: string };

export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Cached per permission level, not globally: a collector must not be handed
  // the company's product list because an admin warmed the cache first.
  const key = me.isAdmin ? "admin" : me.isManager ? "manager" : me.isCollector ? "collector" : "team";
  if (cache && cache.key === key && Date.now() - cache.at < TTL) {
    return NextResponse.json(cache.body);
  }

  const singlesP = atList(T.singles, {
    filterByFormula: "{Owner Rec Id} = BLANK()",
    "fields[]": ["Card Name", "Card No", "Set", "Status", "Location"],
  }).catch(() => []);

  const productsP = me.isManager
    ? atList(T.inventory, {
        filterByFormula: "{Active} = TRUE()",
        "fields[]": ["Product Name", "Category", "Qty On Hand"],
      }).catch(() => [])
    : Promise.resolve([] as any[]);

  const streamsP = atList(T.streams, {
    filterByFormula: "{Deleted At} = BLANK()",
    "fields[]": ["Title", "Stream Date", "Status"],
    "sort[0][field]": "Stream Date",
    "sort[0][direction]": "desc",
  }).catch(() => []);

  const [singles, products, streams] = await Promise.all([singlesP, productsP, streamsP]);

  const body = {
    singles: singles.map((r): Row => {
      const no = formatCardNo(r.fields["Card No"]);
      const status = r.fields["Status"]?.name || r.fields["Status"] || "";
      const loc = r.fields["Location"] || "";
      return {
        id: r.id,
        // The card number leads, because that is what gets called out loud
        // mid-break and read off a sleeve.
        label: no ? `${no}  ${r.fields["Card Name"] || ""}` : String(r.fields["Card Name"] || ""),
        sub: [r.fields["Set"], status, loc].filter(Boolean).join("  ·  "),
        href: `/singles?card=${encodeURIComponent(no || r.id)}`,
        kind: "Cards",
      };
    }),
    products: products.map((r): Row => ({
      id: r.id,
      label: String(r.fields["Product Name"] || ""),
      sub: [r.fields["Category"]?.name || r.fields["Category"], `${r.fields["Qty On Hand"] ?? 0} on hand`]
        .filter(Boolean)
        .join("  ·  "),
      href: `/admin/inventory?q=${encodeURIComponent(String(r.fields["Product Name"] || ""))}`,
      kind: "Products",
    })),
    // Only the recent ones. Nobody opens the palette hunting for a show from
    // eight months ago, and 40 stale titles crowd out the cards.
    streams: streams.slice(0, 40).map((r): Row => ({
      id: r.id,
      label: String(r.fields["Title"] || "(untitled show)"),
      sub: [r.fields["Stream Date"], r.fields["Status"]?.name || r.fields["Status"]].filter(Boolean).join("  ·  "),
      href: `/streams/${r.id}`,
      kind: "Shows",
    })),
  };

  cache = { at: Date.now(), key, body };
  return NextResponse.json(body);
}
