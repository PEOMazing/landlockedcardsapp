import { NextResponse } from "next/server";
import { atCreate, atDelete, atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// Toggle a payee-week's paid state. Admin only - paying people is the owner's call.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "admin only" }, { status: 403 });
  const b = await req.json(); // { week, personId, personName, amount, paid }
  const week = String(b.week || "");
  const personId = String(b.personId || "");
  if (!week || !personId) return NextResponse.json({ error: "week and personId required" }, { status: 400 });
  const key = `${week}|${personId}`;
  const existing = await atList(T.payrollPaid, { filterByFormula: `{Key} = '${key}'` });
  if (b.paid) {
    if (existing.length === 0) {
      await atCreate(T.payrollPaid, {
        "Key": key,
        "Week Start": week,
        "Person": String(b.personName || ""),
        "Person Rec Id": personId,
        "Amount": Number(b.amount) || 0,
        "Paid At": new Date().toISOString(),
      });
    }
  } else {
    for (const r of existing) await atDelete(T.payrollPaid, r.id);
  }
  return NextResponse.json({ ok: true });
}
