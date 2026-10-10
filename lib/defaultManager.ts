import { atList, T } from "./airtable";

// dm-v1. Who manages a show nobody assigned a manager to.
//
// An admin creating a show got no manager of record at all: the explicit
// assignment branch only fires when a managerId is passed, and the UI does not
// always pass one. The Oct 5 "POKE PULLS WITH ALYSSA" show is the result, with
// no manager and no override, so its packing hours had nowhere to land and
// nothing held it in the admin lists.
//
// The answer lives in the data rather than in this file, as a Default Manager
// checkbox on the Streamers table, so moving it is a tick in Airtable instead
// of a code change and a deploy.

export type StreamerLike = {
  id: string;
  fields: Record<string, any>;
};

/** The ticked Default Manager, or null.
 *
 *  Deactivated people are skipped: leaving the flag on someone who has been
 *  switched off would quietly keep handing them shows, which is the opposite
 *  of what deactivating them meant. Ticking more than one is a mistake rather
 *  than a meaning, so the first wins and the choice stays stable instead of
 *  depending on row order luck. */
export function pickDefaultManager(rows: StreamerLike[]): string | null {
  const ticked = rows.filter(
    (r) => !!r.fields["Default Manager"] && !r.fields["Deactivated At"],
  );
  return ticked.length ? ticked[0].id : null;
}

export async function defaultManagerId(): Promise<string | null> {
  try {
    return pickDefaultManager(await atList(T.streamers));
  } catch {
    // A show with no manager is worse than a show without this lookup, but it
    // is still a show. Never block creation on it.
    return null;
  }
}
