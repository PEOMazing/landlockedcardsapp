import { NextResponse } from "next/server";
import { atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// Managers and admins can list active streamers to assign streams
export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!me.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await atList(T.streamers, { filterByFormula: "{Active} = TRUE()" });
  return NextResponse.json({
    streamers: rows.map((r) => ({ id: r.id, name: r.fields["Name"] || "Streamer" })),
  });
}
