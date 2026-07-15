import { NextResponse } from "next/server";
import { atList, T } from "@/lib/airtable";
import { classifyCollectrCsv } from "@/lib/collectr";

export const maxDuration = 60;

// Inbound email webhook: a user emails their Collectr export to the import
// address, the email provider (Postmark/SendGrid style) POSTs it here, and
// the portfolio lands in their account. Matching: sender email first, then
// an import code (CQ-XXXX) anywhere in the subject.
//
// Requires INBOUND_IMPORT_SECRET in env; the provider webhook URL must carry
// it as ?secret=. Always answers 200 so providers do not retry-storm.

function ok(note: string, extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, note, ...extra });
}

export async function POST(req: Request) {
  const secret = process.env.INBOUND_IMPORT_SECRET;
  const given = new URL(req.url).searchParams.get("secret");
  if (!secret || given !== secret) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let payload: any;
  try { payload = await req.json(); } catch { return ok("unparseable payload"); }

  // normalize the common provider shapes
  const from = String(
    payload.FromFull?.Email || payload.from?.email || payload.from || payload.sender || ""
  ).toLowerCase().trim().replace(/^.*</, "").replace(/>.*$/, "");
  const subject = String(payload.Subject || payload.subject || "");
  const attachments: any[] = payload.Attachments || payload.attachments || [];
  const csvAtt = attachments.find((a) =>
    /\.csv$/i.test(String(a.Name || a.name || a.filename || "")) ||
    /csv/i.test(String(a.ContentType || a.type || ""))
  );
  if (!csvAtt) return ok("no csv attachment", { from });

  // the import code in the subject is the only matcher. Sender addresses can
  // be spoofed, so they are logged but never trusted for account matching.
  const codeMatch = subject.toUpperCase().match(/CQ-[A-Z0-9]{4}/);
  if (!codeMatch) return ok("no import code in subject", { from });
  const rows = await atList(T.streamers).catch(() => []);
  const profile = rows.find((r) => String(r.fields["Import Code"] || "").toUpperCase() === codeMatch[0]);
  if (!profile) return ok("unknown import code", { from, code: codeMatch[0] });

  const role = profile.fields["Role"]?.name || profile.fields["Role"] || "";
  const status = profile.fields["Signup Status"]?.name || profile.fields["Signup Status"] || "";
  const isTeamRole = ["admin", "manager", "streamer"].includes(role);
  const isApprovedCollector = role === "collector" && status === "approved";
  if (!isTeamRole && !isApprovedCollector) return ok("profile not eligible", { role });

  const csvText = Buffer.from(String(csvAtt.Content || csvAtt.content || ""), "base64").toString("utf8");
  const { portfolios, nonPokemon } = classifyCollectrCsv(csvText);
  const sealed: any[] = [], singles: any[] = [];
  for (const p of Object.values(portfolios)) { sealed.push(...p.sealed); singles.push(...p.singles); }
  if (sealed.length + singles.length === 0) return ok("csv had no importable rows", { nonPokemon });

  // hand off to the same writer the in-app importer uses, acting as this user
  const { importPortfolio } = await import("@/lib/importPortfolio");
  const result = await importPortfolio({
    profileRecId: profile.id,
    profileName: String(profile.fields["Name"] || from),
    isTeam: isTeamRole,
    sealed,
    singles,
  });
  return ok("imported", { from, ...result, nonPokemon });
}
