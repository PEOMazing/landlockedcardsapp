import { NextResponse } from "next/server";
import { acknowledgeAlert, openAlerts } from "@/lib/alerts";
import { getMe } from "@/lib/auth";
import { isRecId } from "@/lib/airtable";

export const dynamic = "force-dynamic";

// The login banner feed: unacknowledged price jumps and Whatnot sync notices
// from the last few days. Any team member can acknowledge - it is a shared
// to-do, and once the listing is adjusted the alert is done for everyone.
export async function GET() {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ alerts: [] });
  const alerts = await openAlerts(3).catch(() => []);
  return NextResponse.json({ alerts });
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!isRecId(String(b.id))) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await acknowledgeAlert(b.id);
  return NextResponse.json({ ok: true });
}
