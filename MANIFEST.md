# LandLocked Cards - one upload, six things

51 files. Everything in here was already tested together: 1,317 unit tests
pass, TypeScript is clean. Nothing in here is live yet.

## How to put it live

1. Unzip it. Keep the folder structure exactly as it is.
2. Go to github.com/PEOMazing/landlockedcardsapp and use "Add file" ->
   "Upload files". Drag the unzipped folders (app, components, lib) in.
   GitHub keeps the paths and overwrites the files it already has.
3. Commit straight to main. Vercel builds it in about two minutes.

## 1. Sealed product search (new)

The app could price a sealed box only if you pasted its TCGplayer link. Name
search did not work on sealed product at all - the card search throws away
every product with no collector number, which is every box, tin, bundle and
blister in the mirror. That is why most of the sealed inventory was never
mapped: mapping meant leaving the app and finding the product by hand, for
every row.

- Inventory -> any product -> "map" now opens with a name search, prefilled
  with the product's own name. Hit Search, pick the right one off the list,
  save. The link box is still there for the ones no name search will get
  right - club exclusives, repackaged bundles.
- The search reaches the whole catalog, not just the newest sets. It scores
  all 680 set names against what you typed, then only opens the files that
  scored, so "Shining Fates Tin" works even though that set is years old.
- English beats Japanese on a tie, since half the Japanese sets are named
  after their English counterpart. Type "japanese" and that flips.
- The box beats the bundle when you type box. That one matters: Surging
  Sparks Booster Box and Booster Bundle share every word but one and differ
  by about $350.

New: `lib/tcgMap.ts`, `components/TcgMapper.tsx`,
`app/api/inventory/tcg-lookup/route.ts`, `app/api/admin/sealed-price/route.ts`,
`lib/__tests__/sealedSearch.test.ts`.

`/api/admin/sealed-price` prices a list of names in one pass and writes
nothing. It is what values a lot someone is offering you before any of it is
inventory, and it labels each row exact, close or weak rather than quoting a
price it is not sure of.

## 2. Surprise set hits booked as store sales

This is the one underneath all the rest. On the 2026-10-22 show, 223 of 265
paid orders were read as shelf sales. The set recorded 42 hits out of 265,
and 134 of those "shelf sales" were then booked against a single Ultra
Premium Collection at $225.24 of product cost each.

The per-show export does not say which orders were Buy It Now, so store sales
are guessed from the shape of the title. That guess assumed a wheel listing
always carries the show's name in front of the item, "BANGERS ALL NIGHT!! -
item", and treated anything with no prefix as a shelf sale. A surprise set
show titles its listings with the bare product name. No prefix, so every spin
on the show looked like a shelf sale.

The show set answers this question and was never consulted. Now it is: a paid
order whose title names a line on the set is a spin, whatever shape the title
has, and only what is left over goes to the guesswork. The earnings report's
own Buy It Now column still wins where Whatnot gives us one.

Second fix in the same place: a product whose own name contains " - " was
being cut in half. The strip that removes a show prefix splits on the first
" - ", so "Chasing Glory Booster Pack - Chinese" became "Chinese", which
names nothing and belongs to a different set's packs. The full title is now
tried against the set first and only stripped when it does not match.

Checked against the real export: 0 orders to the shelf, 0 unrecognised, every
hit landing on the line it belongs to.

Changed: `lib/whatnotCsv.ts`, `lib/__tests__/surpriseSetHits.test.ts`.

## 4. Collectr importer fix

Japanese cards were being set aside as non-Pokemon rows and dropped. Rows
with a card-shaped condition but no card number were read as sealed. Both
fixed, and every imported row now gets linked to its TCGplayer product
instead of only the ones that happened to match.

## 5. Paste-a-link page for unlinkable cards

`/singles/link` lists every in-stock card with no Card ID and lets you paste
its TCGplayer link. It writes the Card ID, the art, the variant and the
rarity if that was blank. It deliberately never touches the comp, the set,
the number or the name, so a wrong paste cannot rewrite the card.

## 6. Market-first comps, still switched off

The comp engine ratchets one way: a single hot last sale lifts a comp and
nothing ever brings it back down. This replaces that with TCG market as the
basis, with last sales only overriding it when there are at least three of
them and they disagree by more than 25%.

It ships OFF. The setting `comp_basis_market` defaults to 0, so deploying
this changes no price. Before flipping it on, run
`/api/admin/comp-basis-preview` - it writes nothing and reports what would
move, by how much, and how many labels would need reprinting.
