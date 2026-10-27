# LandLocked Cards - one upload, five things

47 files. Everything in here was already tested together: 1,310 unit tests
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

## 2. The 10-22 show: duplicate store lines, and why they would not delete

134 shelf sales of 134 different listings were booked against one Mega
Charizard X ex Ultra Premium Collection at $225.24 of product cost each, which
is about $30,000 of imaginary cost on a show that took $3,492.94.

They were deleting. I checked three of the line ids out of the deletion log
against the base and all three were gone. Four separate bugs were conspiring
to make it look otherwise:

- **Airtable's rate limit was invisible.** 5 requests per second per base, and
  nothing in the client noticed a 429 - every helper threw on any non-ok
  response. One line removal is about six calls, so three deletions in a
  second is already over. Some deletes threw, and so did the page's own
  reload. Every Airtable call now retries 429s and 5xx with backoff, honouring
  Retry-After.
- **A rate-limited reload said "Stream not found".** Anything that was not a
  403 reported as a missing stream, which is what you saw after deleting a
  few lines, and it is the opposite of the truth. It now distinguishes 404
  from 429 from everything else.
- **No dedupe key.** Store lines dedupe on the Whatnot order id and these had
  none, so the guard could never see them and every re-upload booked the set
  again. A repeat is now recognised by product, units and price when there is
  no order id. It counts rather than sets, so two buyers each taking one pack
  at $15.99 are still two sales and a third still books.
- **The request could not finish.** 134 bookings runs past a minute and the
  platform kills the function mid-loop: rows written, no answer, and the
  obvious next move is to upload again. It now stops at 45 seconds, says how
  many are left, and is safe to resume.

Plus the cleanup itself. Store sales on a show now shows a red panel when it
finds a mis-booking, saying how many lines, what product cost they are adding,
and how much stock comes back. One button removes them in a single batch
request - about fourteen requests for 134 lines instead of eight hundred
calls - which is why it will work where deleting them one at a time did not.
It only ever removes store lines with no order id that share a product with
more than 25 others, so it cannot reach a real hand-entered sale.

The deletion tripwire is retired. It did its job, and it was adding an
Airtable write to every deletion on a path already over the rate limit.

Changed: `lib/airtable.ts`, `lib/storeSales.ts`,
`app/api/lines/store/bulk/route.ts`, `app/api/lines/[id]/route.ts`,
`app/api/streams/[id]/store-duplicates/route.ts`,
`app/streams/[id]/StreamEditor.tsx`, `components/StoreSales.tsx`,
`components/StoreDuplicates.tsx`, `lib/__tests__/storeDedupe.test.ts`.

## 3. Collectr importer fix

Japanese cards were being set aside as non-Pokemon rows and dropped. Rows
with a card-shaped condition but no card number were read as sealed. Both
fixed, and every imported row now gets linked to its TCGplayer product
instead of only the ones that happened to match.

## 4. Paste-a-link page for unlinkable cards

`/singles/link` lists every in-stock card with no Card ID and lets you paste
its TCGplayer link. It writes the Card ID, the art, the variant and the
rarity if that was blank. It deliberately never touches the comp, the set,
the number or the name, so a wrong paste cannot rewrite the card.

## 5. Market-first comps, still switched off

The comp engine ratchets one way: a single hot last sale lifts a comp and
nothing ever brings it back down. This replaces that with TCG market as the
basis, with last sales only overriding it when there are at least three of
them and they disagree by more than 25%.

It ships OFF. The setting `comp_basis_market` defaults to 0, so deploying
this changes no price. Before flipping it on, run
`/api/admin/comp-basis-preview` - it writes nothing and reports what would
move, by how much, and how many labels would need reprinting.
