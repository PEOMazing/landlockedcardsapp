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
