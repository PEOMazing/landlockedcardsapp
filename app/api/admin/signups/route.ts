import { NextResponse } from "next/server";
import { atList, atUpdate, atDelete, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// Vendor approval queue for the admin dashboard.
export async function GET() {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await atList(T.streamers, {
    filterByFormula: `AND({Role} = 'vendor', {Signup Status} = 'pending')`,
  }).catch(() => []);
  return NextResponse.json({
    pending: rows.map((r) => ({
      id: r.id,
      name: r.fields["Name"] || "",
      email: r.fields["Email"] || "",
      phone: r.fields["Phone"] || "",
      company: r.fields["Company"] || "",
      experience: r.fields["Vending Experience"] || "",
      socials: r.fields["Socials"] || "",
      signedUp: r.fields["Signed Up"] || "",
    })),
  });
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (b.action === "approve") {
    await atUpdate(T.streamers, b.id, { "Signup Status": "approved" });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "decline") {
    await atDelete(T.streamers, b.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
