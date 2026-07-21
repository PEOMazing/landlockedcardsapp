import { currentUser } from "@clerk/nextjs/server";
import { atList, atUpdate, T, AtRecord } from "./airtable";

export type Me = {
  clerkId: string;
  email: string;
  isAdmin: boolean;
  isManager: boolean; // managers can create streams for others and earn override + packing
  isTeam: boolean; // admin, manager, or streamer - the business itself. External signups (collectors, vendors) are not team.
  isCollector: boolean; // approved external collector with a personal workspace
  role: string;
  signupStatus: string;
  streamer: AtRecord | null;
};

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
  const isAdmin = (user.publicMetadata as any)?.role === "admin" || role === "admin";
  const isManager = isAdmin || role === "manager";
  const isTeam = isAdmin || role === "manager" || role === "streamer";
  const sStatus = streamer?.fields?.["Signup Status"];
  const isCollector = !isTeam && role === "collector" && ((sStatus?.name || sStatus) === "approved");
  return {
    clerkId: user.id, email, isAdmin, isManager, isTeam, isCollector,
    role: role || "",
    signupStatus: streamer?.fields?.["Signup Status"]?.name || streamer?.fields?.["Signup Status"] || "",
    streamer,
  };
}

// streamer of record, assigned manager, or admin
export function ownsStream(me: Me, stream: AtRecord): boolean {
  if (me.isAdmin) return true;
  if (me.isManager) return true;
  if (!me.streamer) return false;
  return (
    stream.fields["Streamer Rec Id"] === me.streamer.id ||
    stream.fields["Manager Rec Id"] === me.streamer.id
  );
}

export function canManageStream(me: Me, stream: AtRecord): boolean {
  if (me.isAdmin) return true;
  return !!me.streamer && stream.fields["Manager Rec Id"] === me.streamer.id;
}
