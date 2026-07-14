import { NextResponse } from "next/server";
import { atList, T } from "@/lib/airtable";

// Public business finder for the CardQuarters front door. Searches registered
// vendor businesses by name. Exposes ONLY: business name and workspace status.
// No emails, no phones, no people.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ businesses: [] }, { headers: CORS });

  // tenant zero, live today
  const businesses: { name: string; status: string; signInUrl: string | null }[] = [];
  if ("landlocked cards".includes(q) || "landlockedcards".includes(q)) {
    businesses.push({ name: "LandLocked Cards", status: "live", signInUrl: "https://www.landlockedcards.app/sign-in" });
  }

  // registered vendors from sign-ups
  const rows = await atList(T.streamers, {
    filterByFormula: `AND({Role} = 'vendor', {Company} != '')`,
  }).catch(() => []);
  const seen = new Set(businesses.map((b) => b.name.toLowerCase()));
  for (const r of rows) {
    const company = String(r.fields["Company"] || "").trim();
    if (!company || seen.has(company.toLowerCase())) continue;
    if (!company.toLowerCase().includes(q)) continue;
    const status = r.fields["Signup Status"]?.name || r.fields["Signup Status"] || "pending";
    seen.add(company.toLowerCase());
    businesses.push({
      name: company,
      status: status === "approved" ? "setting-up" : "pending",
      signInUrl: null,
    });
  }
  return NextResponse.json({ businesses: businesses.slice(0, 8) }, { headers: CORS });
}
