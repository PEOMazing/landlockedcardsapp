import { NextResponse } from "next/server";
import { atGet, atList, atUpdate, isRecId, T } from "@/lib/airtable";
import { deactivationRefusal, getMe } from "@/lib/auth";

// Admins edit streamer profiles from the settings page.
//
// da-v1: this route also owns deactivation, which is the one edit here with
// consequences beyond the record. See setDeactivated below.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const b = await req.json();

  // deactivation is handled on its own, before the ordinary field edits, so
  // the guards below cannot be sidestepped by sending it alongside a rename
  if (b.deactivated !== undefined) {
    const out = await setDeactivated(params.id, !!b.deactivated, me.streamer?.id || "");
    if ("error" in out) return NextResponse.json(out, { status: out.status || 400 });
    return NextResponse.json(out);
  }

  const fields: Record<string, any> = {};
  if (b.name !== undefined) fields["Name"] = String(b.name).trim();
  if (b.email !== undefined) fields["Email"] = String(b.email).trim().toLowerCase();
  if (b.role !== undefined && ["streamer", "manager", "admin"].includes(b.role)) fields["Role"] = b.role;
  if (b.hourlyRate !== undefined) fields["Hourly Rate"] = b.hourlyRate === null || b.hourlyRate === "" ? null : parseFloat(b.hourlyRate) || 0;
  if (b.overridePct !== undefined) fields["Override %"] = b.overridePct === null || b.overridePct === "" ? null : parseFloat(b.overridePct) || 0;
  if (b.active !== undefined) fields["Active"] = !!b.active;
  // changing the email relinks on next sign-in
  if (b.relink) fields["Clerk User ID"] = "";
  await atUpdate(T.streamers, params.id, fields);
  return NextResponse.json({ ok: true });
}

type Result =
  | { ok: true; name: string; deactivated: boolean; cleared: string[] }
  | { error: string; status?: number };

// Switch a person's access on or off.
//
// Deactivating stamps Deactivated At, which getMe reads to turn off every role
// power at once, and clears them off work that has not settled yet. Shows that
// are Complete are never touched: their hours are already earned and in most
// cases already paid, and rewriting who managed a finished show would quietly
// move money that has gone out.
async function setDeactivated(id: string, off: boolean, actorId: string): Promise<Result> {
  const rec = await atGet(T.streamers, id).catch(() => null);
  if (!rec) return { error: "no such person", status: 404 };
  const name = String(rec.fields["Name"] || "someone");

  if (off) {
    const roleOf = (r: any) => r.fields["Role"]?.name || r.fields["Role"] || "";
    const targetRole = roleOf(rec);
    let otherLiveAdmins = 0;
    if (targetRole === "admin") {
      const all = await atList(T.streamers);
      otherLiveAdmins = all.filter(
        (r) => r.id !== id && roleOf(r) === "admin" && !r.fields["Deactivated At"],
      ).length;
    }
    const refusal = deactivationRefusal({
      targetId: id, actorId, targetName: name, targetRole, otherLiveAdmins,
    });
    if (refusal) return { error: refusal, status: 400 };
  }

  await atUpdate(T.streamers, id, { "Deactivated At": off ? new Date().toISOString() : null });

  // reactivating only restores access: stream roles stay wherever they were
  // reassigned to while the person was gone
  if (!off) return { ok: true, name, deactivated: false, cleared: [] };

  const cleared = await clearUnsettledStreamRoles(id);
  return { ok: true, name, deactivated: true, cleared };
}

/** Take a deactivated person off shows that have not finished, so they stop
 *  picking up packing hours and override on work they are not doing. Returns
 *  the titles touched, for the UI to report. */
async function clearUnsettledStreamRoles(personId: string): Promise<string[]> {
  const rows = await atList(T.streams, { filterByFormula: "{Deleted At} = BLANK()" });
  const touched: string[] = [];
  for (const r of rows) {
    const status = r.fields["Status"]?.name || r.fields["Status"] || "";
    if (status === "Complete") continue;   // settled: never rewritten
    const fields: Record<string, any> = {};
    if (r.fields["Manager Rec Id"] === personId) fields["Manager Rec Id"] = "";
    if (r.fields["Override Rec Id"] === personId) fields["Override Rec Id"] = "";
    if (Object.keys(fields).length === 0) continue;
    await atUpdate(T.streams, r.id, fields);
    touched.push(String(r.fields["Title"] || r.fields["Stream Date"] || r.id));
  }
  return touched;
}
