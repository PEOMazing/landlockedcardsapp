// lb-v2. Which Condition values mean "this is a slab in a case", and therefore
// has no binder pocket and is owed no sticker.
//
// One list, read by the slot pool on the server and by the singles page's
// raw/graded split in the browser, because the two disagreeing IS the bug this
// was written for. 37 slabs entered on 2026-09-26 were handed pockets 853 to
// 889 by a pool that thought they were sleeved cards, while the page filed them
// under graded and hid them from the raw view. The binder looked like it skipped
// from 852 to 890, and the never-printed count sat at 37 forever: labels owed
// for stickers with nowhere to stick them.
//
// Its own file, with no imports, because lib/slots pulls in the Airtable client
// and this has to be readable from a client component too.
//
// "Other" is here because the singles page has always counted it as graded. It
// is the odd one out and worth tidying, but a slot rule that contradicts the
// view in front of you is worse than one that inherits its quirk.
export const SLAB_CONDITIONS = [
  "PSA 10", "PSA 9", "PSA 8", "BGS 9.5", "CGC 10", "CGC 9.5", "Other Graded", "Other",
];

export function isSlab(condition: string | null | undefined): boolean {
  return SLAB_CONDITIONS.includes(String(condition ?? "").trim());
}
