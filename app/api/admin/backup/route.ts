import { NextResponse } from "next/server";
import { atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

export const maxDuration = 60;

// One-click full business backup: every table, every record, as JSON.
// The whole business lives in one Airtable base; this is the parachute.
export async function GET() {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const tables = Object.entries(T) as [string, string][];
  const backup: Record<string, any> = {
    exportedAt: new Date().toISOString(),
    tables: {},
  };
  for (const [key, tableName] of tables) {
    try {
      const rows = await atList(tableName);
      backup.tables[key] = { tableName, count: rows.length, records: rows };
    } catch (e) {
      backup.tables[key] = { tableName, error: String(e) };
    }
  }
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="landlocked-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
