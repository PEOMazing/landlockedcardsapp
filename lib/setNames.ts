// sn-v1. Turning the set name we have into set names TCGplayer might know.
//
// Written because of a specific, measurable failure. On the card show page
// every raw card had a picture and roughly a third of the GRADED ones did not:
// 23 of 70 in stock, against 1 of 1,226 raw. Running the image fill pass over
// those 23 filled exactly ZERO of them, and the reason was not the pictures. It
// was the set names, every one of which came in from a Collectr export:
//
//   Base Set (Unlimited)                  TCGplayer calls it Base Set
//   Base Set (1st Edition & Shadowless)   same set, printing in the name
//   Base Set (German) / (Traditional Chinese)   same again, language in the name
//   Japanese Ultra Shiny GX               the catalog, not the set name
//   Crown Zenith              #GG40       the mirror has Crown Zenith Galarian Gallery
//   Brilliant Stars           #TG23       ... and Brilliant Stars Trainer Gallery
//   M2a, SV8a, ASC, MEG                   Japanese era codes, not names at all
//
// So this is not really a picture bug. A set name that cannot be resolved is
// also a card that cannot be linked, and 68 of 70 in-stock slabs have no
// TCGplayer product id at all - which is why they cannot be auto-priced or
// swept for graded sales either. Fixing the names fixes more than the art.
//
// WHY THIS IS SAFE, which is the part worth being careful about. The obvious
// alternative was to widen the search instead: look the card up by name and
// number and ignore the set. I tried that against the live mirror before
// writing any of this and it is a trap. "Charizard #4" came back as
// "Charizard (Celebrations Metal Card) 004" from Miscellaneous Cards &
// Products. "Squirtle #63/102" came back as a League & Championship card.
// "Darkrai 077/173" came back as Ultra Prism's "Darkrai prism star 77". All
// three are confidently wrong art, which on a page a buyer is reading at a
// table is worse than a grey box.
//
// Candidates go the other way round. Each one is offered to the EXISTING
// strict resolver, which still has to match the card name and the collector
// number inside whichever set it finds. So a wrong guess at a set name fails
// closed and produces nothing, rather than producing somebody else's card.
// That property is what makes it reasonable to guess at all.

/** Parenthetical qualifiers that describe the PRINTING rather than the set.
 *
 *  An allowlist, not a general "strip the brackets" rule. Plenty of real set
 *  names have brackets that belong to them, and the printing already lives in
 *  the Printing and Variant columns, so these are the words that are safe to
 *  treat as noise on a set name. */
const PRINT_RUN_WORDS = [
  "1st edition", "first edition", "shadowless", "unlimited", "revised",
  "1st edition & shadowless", "1st edition and shadowless",
];

/** Language qualifiers, same idea. Which catalog a card is in is the Language
 *  column's job.
 *
 *  Worth saying plainly what this costs: a Base Set (German) card resolved
 *  through "Base Set" gets the ENGLISH art, because TCGplayer has no German
 *  Base Set group to find. That is the right card with the wrong text on it,
 *  which is a reasonable trade for a tile that otherwise shows nothing, and it
 *  is a trade rather than a win. */
const LANGUAGE_WORDS = [
  "english", "japanese", "jp", "jpn", "german", "french", "italian", "spanish",
  "portuguese", "korean", "chinese", "traditional chinese", "simplified chinese",
  "dutch", "polish", "russian", "thai", "indonesian",
];

/** Subsets TCGplayer files as their own group, recognised by the prefix on the
 *  collector number rather than by anything in the set name.
 *
 *  This is the one family that is mechanically certain: a Crown Zenith card
 *  numbered GG40 is in the Galarian Gallery, always, and the number is the
 *  only place that is written down. Verified against the live mirror for both
 *  Crown Zenith cards in the binder - Glaceon VSTAR GG40 and Suicune V GG38
 *  both resolve exactly once "Galarian Gallery" is on the end of the set. */
const SUBSET_BY_NUMBER: { prefix: RegExp; suffix: string }[] = [
  { prefix: /^gg\d/i, suffix: "Galarian Gallery" },
  { prefix: /^tg\d/i, suffix: "Trainer Gallery" },
  { prefix: /^rc\d/i, suffix: "Radiant Collection" },
  { prefix: /^sv\d/i, suffix: "Shiny Vault" },
];

const squeeze = (s: string) => s.replace(/\s{2,}/g, " ").replace(/\s+([,:])/g, "$1").trim();

/** The set name with a printing or language qualifier taken off, or "" when
 *  there was nothing of the kind to take off.
 *
 *  Handles both the bracketed form Collectr writes, "Base Set (Unlimited)",
 *  and a bare trailing word, "Base Set Unlimited". */
export function stripSetQualifier(setName: string): string {
  const raw = String(setName || "").trim();
  if (!raw) return "";
  let out = raw;
  for (const w of [...PRINT_RUN_WORDS, ...LANGUAGE_WORDS]) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    out = out
      .replace(new RegExp(`\\s*\\(\\s*${esc}\\s*\\)`, "gi"), " ")
      .replace(new RegExp(`\\s+${esc}\\s*$`, "gi"), " ");
  }
  out = squeeze(out);
  return out && out.toLowerCase() !== raw.toLowerCase() ? out : "";
}

/** The set name without a leading catalog marker, or "" when there is none.
 *
 *  setKey already drops a TRAILING "(Japanese)" because that is the shape the
 *  older imports used. Collectr writes it on the front instead - "Japanese
 *  Ultra Shiny GX", "Japanese Neo 3", "Japanese Fossil" - and the front form
 *  was never handled. */
export function stripCatalogPrefix(setName: string): string {
  const raw = String(setName || "").trim();
  const out = squeeze(raw.replace(/^(japanese|english|german|french|italian|spanish|korean|chinese)\s+/i, ""));
  return out && out.toLowerCase() !== raw.toLowerCase() ? out : "";
}

/** The subset suffix this collector number implies, or "" for a plain number. */
export function subsetSuffix(number: string): string {
  const head = String(number || "").trim().split("/")[0].trim();
  if (!head) return "";
  for (const { prefix, suffix } of SUBSET_BY_NUMBER) if (prefix.test(head)) return suffix;
  return "";
}

/** Every set name worth offering the resolver for this card, best guess first
 *  and never repeating one.
 *
 *  Order is the whole design. The name as given goes first, so a set that
 *  already resolves is unaffected by any of this and nothing that worked
 *  before can start resolving differently. Everything after it is a narrowing
 *  guess that the resolver is free to refuse.
 *
 *  The subset forms come before the bare strips, because a GG number in Crown
 *  Zenith is a near-certainty while dropping "(German)" is a compromise. */
export function setNameCandidates(setName: string, number = ""): string[] {
  const given = String(setName || "").trim();
  const out: string[] = [];
  const add = (s: string) => {
    const v = squeeze(String(s || ""));
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };

  add(given);

  const sub = subsetSuffix(number);
  if (sub) {
    // Both spellings the catalogs use. The mirror has "Crown Zenith Galarian
    // Gallery" with no colon; TCGplayer's own site writes it with one, and
    // setKey strips punctuation anyway, so offering both costs nothing.
    add(`${given} ${sub}`);
    add(`${given}: ${sub}`);
  }

  const noQual = stripSetQualifier(given);
  if (noQual) {
    add(noQual);
    if (sub) {
      add(`${noQual} ${sub}`);
      add(`${noQual}: ${sub}`);
    }
  }

  for (const base of [given, noQual].filter(Boolean)) {
    const noPrefix = stripCatalogPrefix(base);
    if (noPrefix) {
      add(noPrefix);
      const inner = stripSetQualifier(noPrefix);
      if (inner) add(inner);
    }
  }

  return out;
}
