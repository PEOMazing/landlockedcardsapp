import { NextResponse } from "next/server";
import { atList, atUpdate, atCreate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export async function GET() {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ settings: await getSettings() });
}

export async function PATCH(req: Request) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json(); // { key, value }
  const rows = await atList(T.settings, { filterByFormula: `{Key} = '${b.key}'` });
  if (rows.length > 0) await atUpdate(T.settings, rows[0].id, { Value: b.value });
  else await atCreate(T.settings, { Key: b.key, Value: b.value });
  return NextResponse.json({ ok: true });
}
