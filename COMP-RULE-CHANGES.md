# Comp rule, rebuilt

16 October 2026. Everything here came out of one card: the PSA 10 Darkrai Prism
Star that the engine said was worth $2,500 when it was worth about $9,000.

Chasing that one number turned up three separate defects. All three are fixed,
all three have regression tests built from the real sales data, and the full
suite is green at **960 tests, up from 924**.

---

## 1. A median over a fixed window cannot see a repricing

**The bug.** The rule took the median of the newest five sales inside 30 days.
That assumes the price is flat across the window. Darkrai's window held two
different markets:

| Date | Price |
|---|---|
| Oct 15 | $9,499.99 |
| Oct 08 | $8,500 |
| Sep 26 | $2,500 |
| Sep 24 | $2,000 |
| Sep 24 | $2,000 |

The median of those five is **$2,500**: below every October sale and above
every September one. Not a compromise. A number that was never true on any day.

**The fix.** Before taking any median, test whether the sales describe one
market or two. Split them in time order and look for a recent group that is
cleanly separated from the older group. When there is one, comp off the recent
group alone and say so.

Four guards decide whether a separation is real, and each one exists because
something would otherwise go wrong:

- **Two sales minimum at the new level** (`STEP_MIN_RECENT`). One sale at a new
  price is noise: a shill, a bad listing, an ask misread as a sale. Two
  independent sales is a market. This is what stops a lone $15,000 print from
  moving anything, and it encodes the standard a careful person applies by hand.
- **Two sales minimum at the old level** (`STEP_MIN_OLDER`). Caught by its own
  test. Without it, five sales near $100 preceded by a single $1,000 read as a
  9x crash, when the honest reading is that the $1,000 is the odd one. One sale
  is noise whichever direction it points.
- **The new level has to look like a level.** Its own high over its own low must
  stay inside 2x. This is what rejects a lone spike: pair $15,000 with the
  $2,500 beneath it and the group spans 6x, which is not a level, so no split
  containing the spike ever qualifies.
- **A ceiling on the gap** (`STEP_MAX_GAP`, set to `1 / WASH_FRACTION` = 5).
  Sales of $20 and $25 followed two days later by $480 to $520 were being read
  as a 19x rally. Cards do not go up 19x in 48 hours; sellers do wash two cheap
  copies before listing the real one. Below a fifth of the going rate is already
  this codebase's definition of a wash sale, so past that ceiling the problem is
  handed back to the low-outlier filter, which gets it right.

Symmetric for steps down, because carrying a dead card at its old number is how
it ends up anchoring a surprise set.

**Known limit, written down rather than left to be found:** a genuine crash of
more than 5x inside 30 days will lag until the old sales age out of the 90-day
lookback. That errs toward over-valuing briefly, which is the wrong direction
for you, so a card you believe has crashed hard is worth a human look.

On the real Darkrai data the rule now returns **$9,000** and the Comp Source
reads:

> eBay solds (PSA 10, repriced up 3.4x: median of 2 at the new level as of
> 2026-10-15, was $2,000, 3 older sales not counted)

---

## 2. An ask is not a price

**The bug.** When a seller accepts a Best Offer, eBay publishes the asking price
and suppresses what actually changed hands. Collectr recorded Darkrai's $15,000
ask as a $15,000 sale. The real sale was $8,500.

This error only ever points one way, because an accepted offer is at or below
the ask by definition, and it is largest on exactly the expensive negotiated
cards where being wrong costs the most.

**The fix.** `SaleRow` gained `askOnly` and `askingPrice`, and `isPricedSale()`
keeps asks out of every median. Two signals mark one:

- the feed says so, via `askOnly`, which adapters set when the source returns a
  null or missing sold price on a negotiated sale
- the row is flagged best-offer **and** its price is exactly the asking price,
  which is what a mis-ingest looks like from outside

That second test is the one that catches a vendor who does not know its own data
is wrong. A genuine accepted offer essentially never lands on the ask to the
cent; a feed that substituted the ask lands on it every time.

Note what this deliberately does **not** do: it does not drop every negotiated
sale. Darkrai's $8,500 was a Best Offer and it is the best evidence on the card.
The distinction that matters is not "was this negotiated" but "do we know what
it sold for."

When every sale is unreadable the function returns null rather than inventing a
number from asking prices, and the Comp Source discloses the cut: *"2 negotiated
sales excluded, price not published."*

---

## 3. The wash filter was keyed to the window high

**The bug.** `dropWashSales` threw out sales below 20% of the **highest** sale
in the window, which assumes the high sale is the real one. Sales of $100, $110
and $900 kept only the $900: every legitimate sale sat below a fifth of the
outlier. A rule written to stop one bad sale deciding a price handed that bad
sale the price outright.

This was live on the raw path and priced 722 cards. There was a test in the
suite documenting it as an unfixable limit: *"The cap cannot save a card from
this, because both numbers come from the same poisoned set."* The limit was not
inherent. It was the anchor.

**The fix.** Measure the floor against the **median**. Two agreeing sales now
outvote one absurd one. There is now a single implementation shared by the raw
and slab paths.

Two sales remain a special case and still key off the high: with two prices
there is no majority, their median is just their midpoint, and a $1 wash sale
against a genuine $200 one would otherwise drag the comp to $100.50.

**Blast radius, measured before shipping.** I pulled the Comp Detail for 60 raw
cards with 3+ sales and replayed both rules offline. **Zero comps move.** That
is not luck: the new filter always keeps a superset of the old one, so they can
only diverge when a card has a sale below a fifth of its window high, and
nothing in normal data does. The fix is a no-op except on the pathological cases
it exists for. No repricing pass was run; nothing in Airtable changed.

One knock-on worth knowing. The Espeon-style outlier demotion guard on the raw
path now correctly does **not** fire, because the thing it was rescuing cards
from is fixed upstream. Espeon moves $21.23 to $22.51 and the Eevee $6.30 to
$6.50, both toward the cluster. The guard still fires where it is genuinely
needed, which is when the outlier is the only sale inside the window.

---

## Where the data should come from

I surveyed every option. The short version:

**No eBay API returns accepted Best Offer prices.** Marketplace Insights is
closed to new users, is still beta, and cannot even flag a sale as
best-offer-accepted. The Finding API was decommissioned in February 2025. eBay
also put sold listings behind a login wall in late August 2026, which is why
every scraper in this space is either degraded or signing in with an account.

**Two free eBay tools do have the real number.** Terapeak Product Research
states it in writing: *"the actual price that the item sold for, even if a Best
Offer was accepted."* It is free with Seller Hub and UI-only. eBay's Price Guide
for Trading Cards is grade-matched, covers Pokemon in English and Japanese, uses
accepted offer prices, and takes a CSV upload of up to 5,000 cards. Also UI-only.
Use the Price Guide as a calibration oracle: it is the only source that states on
the record that its median uses accepted offers.

**The reframe that matters: you need the flag, not the reconstructed price.**
Excluding flagged best-offer sales removes the upward bias without having to
trust any vendor's reconstruction. A flag is far easier for a vendor to get
right and far easier for you to verify.

**compsapi, which is already wired into the codebase as `COMPS_API_KEY`, is the
only source with a documented per-row flag.** `best_offer=1` returns a
`best_offer` boolean, and `best_offer=verify` adds `best_offer_confidence`,
`asking_price` and `asking_gap_pct`. `slabSales()` now reads all of those.
Free tier is 100 requests a month with no card, which is enough to validate
before paying anyone. Their method is undisclosed and the operation looks like
one person, so budget for it disappearing; the comp source string records which
feed answered so you will know which valuations rested on it.

**Fallback: Pokemon Price Tracker**, $99/mo Business for commercial use. Pokemon
native, covers Japanese, per-grade graded sales from eBay and Fanatics Collect,
and a title-parsing endpoint. It says nothing about Best Offer anywhere, so treat
its eBay-derived graded numbers as a ceiling and prefer its Fanatics rows, which
are auction hammer prices and clean by construction. No German at all.

**Your 18 Japanese cards** have a better option than eBay for sanity checks:
Yahoo Japan Auctions via Apify, a few cents a lookup. It is an auction format, so
a closing bid is a real clearing price and the whole Best Offer problem vanishes
by construction.

**Your 2 German cards**: there is nothing. Cardmarket's API is closed to new
applicants and is condition-graded rather than slab-graded anyway. Hand-price
them.

**Rejected:** Card Ladder, Market Movers, PSA APR (no APIs; APR is now
login-walled and scraping it would endanger your PSA cert access), TCGplayer
(closed, and raw-only), PriceCharting (collapses PSA 9 and CGC 9 into one
number, and silent on Best Offer), Collectr (no API, no published methodology,
and demonstrably wrong on this exact criterion), and the whole field of
commodity "eBay sold comps" Apify actors, none of which document best-offer
handling.

---

## Still open

1. **Nothing reprices slabs automatically.** `refreshSingleComps` filters on
   `RAW_CONDITIONS`, so all 88 slabs are manual until a rotation exists.
2. **The raw rising-sale lift fires on one sale.** A single high print can still
   lift a raw comp up to 2x the median. That is a separate rule with its own
   tuning and I left it alone deliberately, but it is the same "one print is
   noise" question this work just answered for slabs, and it is the next thing
   I would look at.
3. **Verification of the 88 slabs** still needs a key in Vercel and the build
   deployed.
4. **Two language conflicts and three suspect-language cards** from the
   reconcile are still unresolved, in the CSV from earlier.

## Files

Changed: `lib/salesWindow.ts`, `lib/slabComp.ts`, `lib/gradedSales.ts`.
Tests: `lib/__tests__/slabStep.test.ts` is new (37 tests). `slabComp.test.ts`,
`outlierSale.test.ts` and `soldPick.test.ts` were updated where they pinned the
old behaviour, each with a comment saying what changed and why.

Everything else in this zip is unchanged and included only so the files resolve
against each other.
