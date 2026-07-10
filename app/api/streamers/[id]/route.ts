import { NextResponse } from "next/server";
import { atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// Admins edit streamer profiles from the settings page.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const b = await req.json();
  const fields: Record<string, any> = {};
  if (b.name !== undefined) fields["Name"] = String(b.name).trim();
  if (b.email !== undefined) fields["Email"] = String(b.email).trim().toLowerCase();
  if (b.role !== undefined && ["streamer", "manager", "admin"].includes(b.role)) fields["Role"] = b.role;
  if (b.hourlyRate !== undefined) fields["Hourly Rate"] = b.hourlyRate === null || b.hourlyRate === "" ? null : parseFloat(b.hourlyRate) || 0;
  if (b.overridePct !== undefined) fields["Override %"] = b.overridePct === null || b.overridePct === "" ? null : parseFloat(b.overridePct) || 0;
  if (b.active !== undefined) fields["Active"] = !!b.active;
  // changing the email relinks on next sign-in
  if (b.relink) fields["Clerk User ID"] = "";
  await atUpdate(T.streamers, params.id, fields);
  return NextResponse.json({ ok: true });
}
