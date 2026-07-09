import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { listSets } from "@/lib/pokemon";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ sets: await listSets() });
  } catch (e: any) {
    return NextResponse.json({ error: "pokemontcg.io is not responding, try again shortly" }, { status: 502 });
  }
}
