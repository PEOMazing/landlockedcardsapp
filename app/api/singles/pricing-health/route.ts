import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { pricingHealth } from "@/lib/pricingHealth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// On-demand version of the nightly check, so "are the prices actually coming
// from condition data right now" is a question that can be answered by looking
// rather than by opening a card and reading its Comp Source.
export async function GET(req: Request) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    // ?force=1 backs the Re-check button, which should mean re-check.
    const force = new URL(req.url).searchParams.get("force") === "1";
    return NextResponse.json(await pricingHealth(force));
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}
