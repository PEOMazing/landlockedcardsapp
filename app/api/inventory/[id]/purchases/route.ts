import { NextResponse } from "next/server";
import { atList, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// Purchase history for one product: every lot ever received, newest first.
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const rows = await atList(T.purchases, {
    filterByFormula: `{Product Rec Id} = '${params.id}'`,
    "sort[0][field]": "Date",
    "sort[0][direction]": "desc",
  }).catch(() => []);
  return NextResponse.json({
    lots: rows.map((r) => ({
      id: r.id,
      date: r.fields["Date"] || "",
      qty: r.fields["Qty"] ?? 0,
      unitCost: r.fields["Unit Cost"] ?? 0,
      source: r.fields["Source"] || "",
    })),
  });
}
