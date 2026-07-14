import { NextResponse } from "next/server";
import { atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// Personal import code for the email-in flow. Shown next to the import
// address so a portfolio sent from any email can still be matched.
export async function GET() {
  const me = await getMe();
  if (!me?.isManager && !me?.isCollector) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!me.streamer) return NextResponse.json({ error: "no profile" }, { status: 400 });
  let code = me.streamer.fields["Import Code"];
  if (!code) {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    code = "CQ-" + Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    await atUpdate(T.streamers, me.streamer.id, { "Import Code": code });
  }
  return NextResponse.json({ code, email: me.email });
}
