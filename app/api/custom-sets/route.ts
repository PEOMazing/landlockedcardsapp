import { NextResponse } from "next/server";
import { atCreate, atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// Personal master sets: a saved name filter ("raichu") that renders as a
// full checklist with mastery, owned badges, and quick-add.
export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const mine = me.streamer?.id || "";
  const rows = await atList(T.customSets, {
    filterByFormula: `{Owner Rec Id} = '${mine}'`,
    "sort[0][field]": "Created",
    "sort[0][direction]": "desc",
  }).catch(() => []);
  return NextResponse.json({
    customSets: rows.map((r) => ({
      id: r.id,
      name: r.fields["Name"] || "",
      query: r.fields["Query"] || "",
    })),
  });
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  const query = String(b.query || "").trim();
  if (!query) return NextResponse.json({ error: "pokemon name required" }, { status: 400 });
  const name = String(b.name || "").trim() || `${query[0].toUpperCase()}${query.slice(1)} master set`;
  const rec = await atCreate(T.customSets, {
    "Name": name,
    "Query": query.toLowerCase(),
    "Owner Rec Id": me.streamer?.id || "",
    "Created": new Date().toISOString().slice(0, 10),
  });
  return NextResponse.json({ id: rec.id, name, query: query.toLowerCase() });
}
