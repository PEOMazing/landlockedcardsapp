import { AtRecord } from "./airtable";
import { getTcgcsvCard, parseCardId, resolveSingleToTcg } from "./tcgcsvCards";

// Finding a picture for a card, kept deliberately separate from finding a
// price for it.
//
// Pricing has to be strict. An ambiguous match there writes a confident wrong
// number onto a sticker and somebody sells a $340 card for $12, so the resolver
// refuses anything it cannot pin down exactly. That strictness is correct and
// it is also why a card that cannot be priced ends up with no picture either:
// one refusal was doing both jobs.
//
// A picture carries none of that risk. The worst case is the wrong art next to
// the right name, which a human spots instantly. So image lookup gets to be
// looser than price lookup, and gets its own path here rather than loosening
// the one that guards the money.

/** What the scan page shows when there is genuinely no art to show. Not a
 *  found image - the caller keeps it out of the Image URL column. */
export type CardImage = { url: string; source: "card-id" | "resolved" | "by-name" } | null;

/** Pull an image for a record without caring whether it can be priced. */
export async function findCardImage(rec: AtRecord): Promise<CardImage> {
  const f = rec.fields;
  const setName = String(f["Set Name"] || "");
  const number = String(f["Card Number"] || "");
  const name = String(f["Card Name"] || "");
  const language = String(f["Language"] || "");
  const variant = String(f["Variant"] || "");
  const rarity = String(f["Rarity"] || "");

  // Already linked: the product is known, just read its art.
  const cardId = String(f["Card ID"] || "").trim();
  if (cardId && parseCardId(cardId)) {
    try {
      const card = await getTcgcsvCard(cardId);
      const url = String(card?.imageLarge || card?.image || "");
      if (url) return { url, source: "card-id" };
    } catch {
      // fall through to the looser paths
    }
  }

  // The strict resolver. When it succeeds it hands back the art directly.
  try {
    const hit = await resolveSingleToTcg({ setName, number, name, variant, rarity, language });
    if (hit?.image) return { url: hit.image.replace("_200w", "_400w"), source: "resolved" };
  } catch {
    // same
  }

  // Loosest path: the strict resolver refused, and the usual reason is that a
  // number or a name landed on several printings of one card - "Dondozo - 012"
  // and "Dondozo - 012 (Cosmos Holofoil)". Those are different products at
  // different prices and the same picture, so for art the tie does not need
  // breaking. Dropping the number as well casts the net wider still, for the
  // promo and unnumbered sets where the number was never usable.
  for (const number2 of [number, ""]) {
    try {
      const loose = await resolveSingleToTcg({
        setName, number: number2, name, variant, rarity, language, allowAmbiguous: true,
      });
      if (loose?.image) return { url: loose.image.replace("_200w", "_400w"), source: "by-name" };
    } catch {
      // try the next widening, then give up
    }
  }

  return null;
}

// ---------------- detecting art that belongs to a different card ----------------
//
// Filling a blank image is not the only failure. A card can carry a picture
// that is confidently, silently wrong: "Dark Blastoise (JP)" sat in the binder
// for weeks showing a Dark Hypno, because its Image URL pointed at product
// 84613 while its Card ID said 575743. Nothing flagged it. The fill pass skips
// anything that already has a URL, so a wrong picture is more permanent than
// no picture at all.
//
// The Card ID is the authority here. It is what the pricing engine trades on,
// it is what the QR scan resolves, and it is written by a resolver that
// refuses to guess. If the image and the Card ID name two different products,
// the image is the one that is wrong.

// Every host we have ever written art from. A URL from anywhere else was put
// there by a human on purpose, and a human's choice is not ours to overwrite.
const TCG_IMAGE_HOST = /^(tcgplayer-cdn\.tcgplayer\.com|product-images\.tcgplayer\.com)$/i;

/** The TCGplayer product a stored image URL is showing, or null if we cannot
 *  tell. Handles every shape we have written: `/product/90738_400w.jpg`,
 *  `/product/90738_in_200x200.jpg`, and the older `/fit-in/437x437/90738.jpg`. */
export function imageProductId(url: string): number | null {
  const raw = String(url || "").trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!TCG_IMAGE_HOST.test(parsed.hostname)) return null;

  // The id is always the leading digits of the final path segment. Sizing
  // hints ("_400w", "_in_200x200") and the extension follow it; directory
  // segments that look numeric ("437x437") are not the last one, so they
  // cannot be mistaken for it.
  const last = parsed.pathname.split("/").filter(Boolean).pop() || "";
  const m = last.match(/^(\d+)(?:[_.]|$)/);
  if (!m) return null;

  const id = parseInt(m[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// ---------------- asking the CDN for the big version ----------------
//
// Stored art is the 200px thumbnail, which is right for a table row and far
// too small for anything a viewer sees: blown up to fill an OBS tile it is
// visibly soft. TCGplayer serves the same product at several sizes and the
// largest is the "_in_1000x1000" form, which comes back around 1000px on the
// long edge - five times the linear resolution, checked across a whole show's
// worth of products.
//
// A rewrite, not a new stored value. The thumbnail is still the right thing
// almost everywhere, and a URL nobody has to migrate is a URL that cannot go
// stale. Callers that need the big one ask for it at the point of use and keep
// the original as a fallback, because this is somebody else's CDN and the only
// guarantee we have is what it happened to serve last time.

/** The largest version of a TCGplayer image URL. Anything not recognisably
 *  theirs comes back untouched: a hand-uploaded image from another host has no
 *  size variants to ask for, and guessing at one would break a working link. */
export function bigCardImage(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return raw;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  if (!TCG_IMAGE_HOST.test(parsed.hostname)) return raw;

  const segs = parsed.pathname.split("/");
  const last = segs[segs.length - 1] || "";
  // "90738_200w.jpg", "90738_400w.jpg", "90738_in_200x200.jpg", "90738.jpg"
  const m = last.match(/^(\d+)(?:_.*)?\.(jpg|jpeg|png|webp)$/i);
  if (!m) return raw;

  segs[segs.length - 1] = `${m[1]}_in_1000x1000.jpg`;
  parsed.pathname = segs.join("/");
  return parsed.toString();
}

/** True only when we can prove the stored art is a different product than the
 *  Card ID claims. Deliberately answers false whenever anything is unknown:
 *  no image, no Card ID, a hand-uploaded image from another host, or a URL
 *  shape we do not recognise. Repair should never fire on a guess. */
export function imageMismatch(url: string, cardId: string): boolean {
  const shown = imageProductId(url);
  if (shown === null) return false;

  const linked = parseCardId(String(cardId || "").trim());
  if (!linked) return false;

  return shown !== linked.productId;
}
