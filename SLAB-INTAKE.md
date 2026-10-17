# Adding a slab

**1005 tests green, up from 976. Typecheck clean. Production build compiles
and both new routes register.**

The graded path used to end with the app telling you to leave:

> Graded comps are manual: check ALT or eBay sold listings and enter the comp
> above.

That line is gone. The hardest part of the job now happens inside the tool,
and the comp arrives with its evidence attached.

## What the form does now

**Grading company, then grade.** Two short rows instead of one wall of
twenty-one chips. The grade list is **derived from `SLAB_CONDITIONS`**, not
written out a second time, so the dropdown and the Condition column cannot
drift apart. That guard earned its place immediately: the first version
offered BGS 8.5, 8 and 7, none of which the app can store, and a test caught
it before it shipped. It is the same shape as the bug where PSA 7 was
unstorable for a month while slabs carrying it sat in the collection.

Switching grader keeps your grade when the new grader issues it, so flipping
PSA to CGC on a 10 does not make you pick 10 again. BGS and CGC get 9.5, PSA
does not.

**Search the card or paste its TCGplayer link.** Both end at the same card
object, so use whichever is faster. `?tcgUrl=` on the cards endpoint reads the
product id out of a pasted URL and resolves it to one card; the link parser
takes the full product page, tracking parameters, and a bare id, and returns
**null rather than guessing**, because attaching the wrong product to a slab is
silent and permanent.

**Paste the sold results.** This is the part that matters. Select the rows on
130point or eBay, paste, and the comp appears as you type with the working
underneath: which sales counted, which were set aside, and why. Under the hood
it is `quoteSlab`, which runs the real engine — step detection, the lone-high
guard, the ask-is-not-a-price filter, the low-outlier floor. A card added
through this form and the same card repriced next month go down one code path.

**The sold link is stored** in `ALT Link`, so Recomp later reopens that exact
search instead of guessing at a query. Validated against an allow-list rather
than trusted, because it renders as a clickable link on the public label page.

## The preview cannot lie

`POST /api/singles/slab-quote` is read-only and returns the price, the source
string, and every parsed sale tagged with whether it counted. `POST
/api/singles` then **re-runs the same `quoteSlab` call** on the way in rather
than trusting a number the browser worked out. One function, two callers, so
what was on screen is what gets written. A form that previews $9,000 and saves
$2,500 would be worse than one that previews nothing.

## The parser

Deliberately a paste and not a fetch. eBay login-walled sold listings in August
2026, 130point publishes no API, and every scraper in that gap breaks silently
and hands back something that still parses. A person looking at the page can
see what a server cannot.

It reads the shapes that matter — money and dates — and ignores titles, advert
lines and marketplace chrome, so it survives both sites' layouts and whatever
they do next year. Dates: `15 Oct 26`, `27 Sept 26` (four letters, which breaks
naive month parsing), `Oct 15, 2026`, `2026-10-15`.

**Two prices on one row means an accepted offer, and the LOWER one is the
sale.** 130point prints the ask struck through beside what changed hands.
Reading that pair backwards is exactly the error that put a $15,000 asking
price into this collection as a sale, so it has its own test against the real
Darkrai paste, copied verbatim off the page on 2026-10-16. If that test stops
producing $9,000, the form is lying to somebody holding a card.

A row with a price but no date is skipped and **counted**, and the count is
shown. A paste that half worked should say so.

## What it tells you before you commit

Thin samples, stale comps, repricings, demoted sales and excluded negotiated
sales are all surfaced as plain sentences next to the number — while you are
still holding the card and could go and find more sales. Not after.

## Files

New: `lib/soldPaste.ts`, `lib/slabIntake.ts`,
`app/api/singles/slab-quote/route.ts`, `lib/__tests__/slabIntake.test.ts`.

Changed: `app/api/singles/route.ts` (grader/grade, paste, link),
`app/api/pokemon/cards/route.ts` (`?tcgUrl=`), `lib/tcgcsvCards.ts`
(`getTcgcsvCardByProductId`), `app/singles/SinglesClient.tsx` (the form).

## Open

- **The raw path is untouched.** Everything above is behind `mode === "graded"`.
- **`peerMove` is still not wired into the route**, so the English-to-Japanese
  corroboration works in the library and in tests but not yet on a live recomp.
- `getTcgcsvCardByProductId` scans groups and early-exits on a hit. Fine for a
  single lookup; it is not something to call in a loop.
