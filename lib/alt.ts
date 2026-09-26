// ALT (alt.xyz) price checks for graded cards.
//
// The app never fetches prices from ALT. It only builds links that a person
// opens in a new tab, reads the comp off, and types into Comp. Two kinds:
//   - a saved card page (Singles "ALT Link"), the exact slab's sold tab
//   - a sold-listings search built from the card's name, set and number,
//     used when no card page has been saved yet
// Shared by the Graded page (client) and the singles PATCH route (server).

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Pull ALT's card id out of any direct ALT link:
 *  alt.xyz/itm/<id>/sold, alt.xyz/itm/<id>/research, app.alt.xyz/research/<id>. */
export function altIdFromUrl(url: string): string | null {
  const s = String(url || "").trim();
  if (!/alt\.xyz/i.test(s)) return null;
  const m = s.match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}

/** The sold tab for a card id. Sold is where the comps are. */
export const altSoldUrl = (id: string) => `https://alt.xyz/itm/${id}/sold`;

/** True for the short share links the ALT phone app hands out. */
export const isAltShareLink = (url: string) => /(^|\/\/)alt\.app\.link\//i.test(String(url || "").trim());

/** Resolve a share link (alt.app.link/...) to a card id, server side only.
 *  The share page carries the real alt.xyz URL in its body and redirects. */
export async function resolveAltShareLink(url: string): Promise<string | null> {
  let u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const res = await fetch(u, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
    const fromFinal = altIdFromUrl(res.url);
    if (fromFinal) return fromFinal;
    const body = await res.text();
    const m = body.match(/https?:\/\/(?:app\.)?alt\.xyz\/[^"'\s<>]*/i);
    return m ? altIdFromUrl(m[0]) : null;
  } catch {
    return null;
  }
}

type AltCard = { name: string; setName?: string; number?: string; language?: string };

/** Sold-listings search in ALT's own format, newest first, e.g.
 *  "Pokemon Scarlet and Violet Promo Japanese Pikachu #291". The grade is
 *  left out on purpose: ALT titles do not word grades consistently, so
 *  adding one hides good matches. The results show the grade on each sale. */
export function altSearchUrl(c: AltCard): string {
  // "028/102" -> "28": ALT writes the number without the set total or zeros
  const num = String(c.number || "").split("/")[0].trim().replace(/^0+(?=\d)/, "");
  // "Arceus (AR8)", "Empoleon LV.X - DP11": the tail repeats the number
  const name = String(c.name || "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+-\s+\S+$/, "").trim();
  const q = [
    "Pokemon",
    c.setName || "",
    c.language && c.language !== "English" ? c.language : "",
    name,
    num ? `#${num}` : "",
  ].join(" ").replace(/\s+/g, " ").trim();
  return `https://alt.xyz/browse?query=${encodeURIComponent(q)}&soldListings=true&sortBy=newest_first`;
}

/** Where Check price goes: the saved card page if there is one, else a search. */
export const altCheckUrl = (c: AltCard & { altLink?: string }) => (c.altLink ? c.altLink : altSearchUrl(c));
