import { NextResponse } from "next/server";
import { atList, atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

export const maxDuration = 60;

// One-time (idempotent) backfill: items that existed before entry tracking
// get benchmarked at today's price. Safe to re-run - it only fills blanks.
export async function POST() {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const today = new Date().toISOString().slice(0, 10);

  let sealedStamped = 0, singlesStamped = 0;
  const inventory = await atList(T.inventory, {});
  for (const r of inventory) {
    const fields: Record<string, any> = {};
    if (!(r.fields["Entry Market"] > 0) && r.fields["Market Price"] > 0) fields["Entry Market"] = r.fields["Market Price"];
    if (!r.fields["Date Added"]) fields["Date Added"] = today;
    if (Object.keys(fields).length) { await atUpdate(T.inventory, r.id, fields); sealedStamped++; }
  }
  const singles = await atList(T.singles, {});
  for (const r of singles) {
    if (!(r.fields["Entry Comp"] > 0) && r.fields["Comp"] > 0) {
      await atUpdate(T.singles, r.id, { "Entry Comp": r.fields["Comp"] });
      singlesStamped++;
    }
  }
  return NextResponse.json({ sealedStamped, singlesStamped });
}
