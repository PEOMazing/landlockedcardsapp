import { currentUser } from "@clerk/nextjs/server";
import { atList, atUpdate, T, AtRecord } from "./airtable";

export type Me = {
  clerkId: string;
  email: string;
  isAdmin: boolean;
  isManager: boolean; // managers can create streams for others and earn override + packing
  isTeam: boolean; // admin, manager, or streamer - the business itself. External signups (collectors, vendors) are not team.
  isCollector: boolean; // approved external collector with a personal workspace
  // da-v1: access switched off. Their record, hours and past pay all stay put;
  // what goes is the ability to see or touch anything.
  isDeactivated: boolean;
  deactivatedAt: string;
  role: string;
  signupStatus: string;
  streamer: AtRecord | null;
};

/** da-v1: who someone is, given only what their record says.
 *
 *  Pulled out of getMe so it can be tested, because this is the whole of the
 *  access rule and the rest of getMe needs a live Clerk session to run. Every
 *  gate in the app keys off these booleans, so this function is the one place
 *  deactivation has to be right. */
export function deriveRoles(input: {
  role?: string;
  signupStatus?: string;
  clerkAdmin?: boolean;
  deactivatedAt?: string | null;
}) {
  const deactivatedAt = String(input.deactivatedAt || "");
  const isDeactivated = !!deactivatedAt;
  const role = input.role || "";
  // Deactivation beats everything, including admin granted by Clerk metadata
  // rather than by the record. Switching these off here revokes access across
  // the whole app at once, instead of relying on ~80 call sites to remember.
  const isAdmin = !isDeactivated && (!!input.clerkAdmin || role === "admin");
  const isManager = !isDeactivated && (isAdmin || role === "manager");
  const isTeam = !isDeactivated && (isAdmin || role === "manager" || role === "streamer");
  const isCollector =
    !isDeactivated && !isTeam && role === "collector" && input.signupStatus === "approved";
  return { isAdmin, isManager, isTeam, isCollector, isDeactivated, deactivatedAt };
}

export async function getMe(): Promise<Me | null> {
  const user = await currentUser();
  if (!user) return null;
  const email = user.emailAddresses?.[0]?.emailAddress?.toLowerCase() || "";

  let rows = await atList(T.streamers, {
    filterByFormula: `{Clerk User ID} = '${user.id}'`,
  });
  if (rows.length === 0 && email) {
    rows = await atList(T.streamers, { filterByFormula: `LOWER({Email}) = '${email}'` });
    if (rows.length > 0 && !rows[0].fields["Clerk User ID"]) {
      await atUpdate(T.streamers, rows[0].id, { "Clerk User ID": user.id });
    }
  }
  const streamer = rows[0] || null;
  const role = streamer?.fields?.["Role"];
  const sStatus = streamer?.fields?.["Signup Status"];

  // da-v1: deactivation is NOT returned as null. Every caller reads null as
  // "not signed in" and sends them to /sign-in, which with a live Clerk
  // session bounces straight back and loops. They stay signed in, with every
  // role power off, and land on the access-removed page.
  const { isAdmin, isManager, isTeam, isCollector, isDeactivated, deactivatedAt } = deriveRoles({
    role: role?.name || role || "",
    signupStatus: sStatus?.name || sStatus || "",
    clerkAdmin: (user.publicMetadata as any)?.role === "admin",
    deactivatedAt: streamer?.fields?.["Deactivated At"],
  });
  return {
    clerkId: user.id, email, isAdmin, isManager, isTeam, isCollector,
    isDeactivated, deactivatedAt,
    role: role || "",
    signupStatus: streamer?.fields?.["Signup Status"]?.name || streamer?.fields?.["Signup Status"] || "",
    streamer,
  };
}

/** da-v1: may this person be deactivated right now?
 *
 *  Returns the reason to refuse, or null to go ahead. Pulled out of the route
 *  so the two refusals are testable: both exist to stop the app being locked
 *  with the key inside, since admin can come from Clerk metadata rather than
 *  the record and there is no way back in from the UI. */
export function deactivationRefusal(input: {
  targetId: string;
  actorId: string;
  targetName: string;
  targetRole: string;
  otherLiveAdmins: number;
}): string | null {
  if (input.targetId === input.actorId) return "you cannot deactivate your own account";
  if (input.targetRole === "admin" && input.otherLiveAdmins < 1) {
    return `${input.targetName} is the only active admin, so deactivating them would lock everyone out`;
  }
  return null;
}

// streamer of record, assigned manager, or admin
export function ownsStream(me: Me, stream: AtRecord): boolean {
  // da-v1: this one does not key off a role boolean, it matches rec ids, so it
  // needs a check of its own. Without it a deactivated manager keeps every
  // show they are still manager of record on, which for Daniel is 81 of them.
  if (me.isDeactivated) return false;
  if (me.isAdmin) return true;
  if (me.isManager) return true;
  if (!me.streamer) return false;
  return (
    stream.fields["Streamer Rec Id"] === me.streamer.id ||
    stream.fields["Manager Rec Id"] === me.streamer.id
  );
}

// Any manager can RUN any stream, including one a streamer created for themselves
// with no manager attached. ACCESS ONLY: the override keys on the stream, so working
// a show you are not assigned to earns no override on it.
export function canManageStream(me: Me, stream: AtRecord): boolean {
  if (me.isDeactivated) return false;   // da-v1, same reason as ownsStream
  if (me.isAdmin) return true;
  if (me.isManager) return true;
  return !!me.streamer && stream.fields["Manager Rec Id"] === me.streamer.id;
}
