// Recognising a page that is running against a build that no longer exists.
//
// Every Next.js build stamps its JavaScript with content-hashed filenames:
// /_next/static/chunks/webpack-ef9e45ee.js and so on. Those filenames are baked
// into the HTML document the browser already has. Deploy again, or roll back,
// and the live domain starts serving a different set of hashes. The page in
// somebody's hand is still asking for the old ones, gets a 404, and React dies
// with "Application error: a client-side exception has occurred".
//
// This is not a bug in the app and no amount of testing finds it, because it
// only happens to a browser that was holding the page across a deploy. During a
// show that is every streamer on the roster, and the error screen looks exactly
// like the app broke.
//
// Vercel sells the platform-level fix for this (Skew Protection, which keeps the
// old build's files served for a while) and it is not on this plan. So the app
// handles it: recognise the signature, reload once, carry on. A reload fetches
// the current document, which names the current files.

/** Error text that means "an asset this build expected is not there any more".
 *  Each of these is a real browser message, not a guess:
 *   - Chrome and Firefox, webpack chunk: "Loading chunk 2117 failed", and for a
 *     route chunk the name carries the path: "Loading chunk app/streams/[id]
 *     /page failed", so the name is matched as non-whitespace rather than as
 *     a word
 *   - Next.js wraps the same thing as ChunkLoadError
 *   - native dynamic import, Chrome: "Failed to fetch dynamically imported module"
 *   - native dynamic import, Safari: "Importing a module script failed"
 *   - Safari, script tag: "Unexpected token '<'" when a 404 HTML page is
 *     parsed as JavaScript. Deliberately NOT matched: it is too close to an
 *     ordinary parse error to reload on. The asset listener below catches that
 *     case from the element instead, which is unambiguous.
 */
const STALE_MESSAGE =
  /ChunkLoadError|Loading (?:CSS )?chunk \S+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function isStaleBuildError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "string") return STALE_MESSAGE.test(err);
  const e = err as { name?: unknown; message?: unknown };
  if (typeof e.name === "string" && e.name === "ChunkLoadError") return true;
  if (typeof e.message === "string") return STALE_MESSAGE.test(e.message);
  return false;
}

/** True for a <script> or <link> pointing at this build's own static assets.
 *  Scoped to /_next/ on purpose: a Clerk script or a Google font failing is a
 *  network problem, and reloading the page does not fix a network problem. */
export function isOwnAssetUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("/_next/static/");
}

export const RELOAD_KEY = "llc-stale-reload";
const WINDOW_MS = 60_000;
const MAX_TRIES = 2;

/** Whether to spend a reload, and the bookkeeping that stops a reload loop.
 *
 *  A loop here is worse than the error screen: the page would flash and
 *  reload forever and nobody could read what went wrong. So the budget is two
 *  reloads a minute per tab, and after that the error screen stands with a
 *  button on it. Kept as a pure function of the stored value and the clock so
 *  it is testable without a browser.
 */
export function nextReloadState(
  stored: string | null,
  now: number,
): { reload: boolean; store: string } {
  let tries = 0;
  let first = now;
  if (stored) {
    const [t, n] = stored.split(":");
    const at = Number(t);
    const count = Number(n);
    if (Number.isFinite(at) && Number.isFinite(count) && now - at < WINDOW_MS) {
      tries = count;
      first = at;
    }
  }
  if (tries >= MAX_TRIES) return { reload: false, store: `${first}:${tries}` };
  return { reload: true, store: `${first}:${tries + 1}` };
}
