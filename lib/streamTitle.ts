// How long a stream title is allowed to be.
//
// st-v1 (per Gabe 2026-10-20): 50 characters on the stored title, which is the
// thing that actually has to fit - in the streams list, in the payroll
// breakdown, in the picker on the store-sales upload, and in the OBS board
// header. Titles pasted off Whatnot run to 150 characters of capitals and
// exclamation marks, and every one of those places was truncating them
// differently.
//
// st-v2. New titles no longer carry a "2026-10-20 - " stamp. It cost 13 of the
// 50 characters to duplicate the Stream Date field, nothing ever read a date
// back out of a title, and the admin list already regexed it off before
// display. Old titles keep theirs and are still rewritten when a show moves
// date, so nothing already in the table has to change.
//
// Moving forward only. Nothing already in the table is touched or re-validated:
// a show created last month keeps its long name, and moving that show to a new
// date still works, because the rename path only checks a title somebody has
// actually just typed.
export const STREAM_TITLE_MAX = 50;

/** The date stamp older titles carry on the front.
 *
 *  Nothing writes this any more. It stays because titles created before st-v2
 *  still have one and two places still care: the admin list strips it for
 *  display, and moving a show rewrites it so the stamp cannot drift out of
 *  step with the real date. */
export const LEGACY_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}\s*-\s*/;

/** null when the title is fine, otherwise the message to show the person.
 *
 *  Rejects rather than truncating. A silently clipped title is one nobody
 *  notices until it is on screen in front of an audience, cut off mid-word,
 *  and by then the show has started. Saying "that is 14 over" costs one edit
 *  and is honest about whose decision it is. */
export function streamTitleError(title: string): string | null {
  const t = String(title ?? "").trim();
  if (!t) return "title cannot be empty";
  if (t.length > STREAM_TITLE_MAX) {
    const over = t.length - STREAM_TITLE_MAX;
    return `title is ${t.length} characters, ${over} over the ${STREAM_TITLE_MAX} limit - trim ${over}`;
  }
  return null;
}

/** A title with any legacy date stamp taken off the front. */
export function stripLegacyDate(title: string): string {
  return String(title || "").replace(LEGACY_DATE_PREFIX, "");
}
