import { NextResponse } from "next/server";
import { atCreate, atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// Managers and admins can list active streamers to assign streams.
// Admins can request full profiles with ?full=1 for the settings page.
export async function GET(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!me.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const full = new URL(req.url).searchParams.get("full") === "1" && me.isAdmin;
  const rows = await atList(T.streamers, full ? {} : { filterByFormula: "{Active} = TRUE()" });
  if (!full) {
    return NextResponse.json({
      streamers: rows.map((r) => ({ id: r.id, name: r.fields["Name"] || "Streamer" })),
    });
  }
  return NextResponse.json({
    streamers: rows.map((r) => ({
      id: r.id,
      name: r.fields["Name"] || "",
      email: r.fields["Email"] || "",
      role: r.fields["Role"] || "streamer",
      hourlyRate: r.fields["Hourly Rate"] ?? null,
      overridePct: r.fields["Override %"] ?? null,
      active: !!r.fields["Active"],
      linked: !!r.fields["Clerk User ID"],
    })),
  });
}

// Admins create streamer profiles; the person is linked automatically the
// first time they sign in with the matching email.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json();
  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  if (!name || !email) return NextResponse.json({ error: "name and email required" }, { status: 400 });
  const fields: Record<string, any> = {
    "Name": name,
    "Email": email,
    "Role": ["streamer", "manager", "admin"].includes(b.role) ? b.role : "streamer",
    "Active": true,
  };
  if (b.hourlyRate !== undefined && b.hourlyRate !== null && b.hourlyRate !== "") fields["Hourly Rate"] = parseFloat(b.hourlyRate) || 0;
  if (b.overridePct !== undefined && b.overridePct !== null && b.overridePct !== "") fields["Override %"] = parseFloat(b.overridePct) || 0;
  const rec = await atCreate(T.streamers, fields);
  return NextResponse.json({ id: rec.id });
}
