# The 130point sweep, and what it changed

**34 of 88 slabs checked** against live 130point data through your own Chrome
session. The sweep validated the new rule, found four more defects in it, and
moved the book by a net **+$9,175** with large corrections in both directions.

**976 tests green, up from 924 at the start. Typecheck clean. Production build
passes.**

The remaining 54 slabs are unchecked. They are the bottom of the book by value
(all under $200 each, roughly $6,000 combined), so the money is already
covered, but they are not done and this document does not pretend otherwise.

---

## Is there a script that can do this?

No, and I would not write one. 130point has no API, so a script means scraping
a free service's internal endpoints. It would break when they change a page key,
and it would not break loudly: it would return something that parses. That is
precisely how a $15,000 asking price became a $15,000 sale. They would also
block 88 lookups.

What works instead is what produced this document: **Claude in Chrome driving
130point in your own browser.** Same requests your browser already makes, at
human pace, with your session. Nothing to block, and when a page changes I see
a page I cannot read rather than a number that is quietly wrong. About 20 to 30
seconds a card.

---

## Card by card

### 1. Darkrai Prism Star, English Ultra Prism 77/156, PSA 10 — validated

Full history pulled. Fifteen sales from January. The rule, run against real
data, returns **$9,000**, exactly what we set by hand. The step detector fires
at 4.25x and prices off the two October sales.

Worth seeing the whole year, because it changes how you'd treat the card:

$699 (Jan) → $700, $800 (Mar) → $1,050 (Apr) → $1,194–1,300 (Jun) → $1,300
(Jul) → $999–1,025 (Aug) → $1,100, $2,000, $2,000, $2,500 (Sep) → **$8,500,
$9,499.99 (Oct)**.

That is a card that quadrupled in three weeks after a year of grinding upward.
The comp is right, and it is a comp I would be selling into rather than holding.

### 2. Darkrai Prism Star, Japanese SM12a 077/173, PSA 10 — I had it wrong, then you had it right

I set $785 last night off one sale. The card's own history is $102.50, $150.97,
$192.87, $148.39 across August and September. My new rule demoted the lone sale
to **$150**, and you overruled it.

You were right, and the ratio proves it rather than just suggesting it:

| | English | Japanese | Ratio |
|---|---|---|---|
| Feb–Mar | $700–800 | $37–90 | ~11–13x |
| Aug–Sep | $2,000 | $151 | 13.2x |
| Oct | $9,000 | **$784.90** | 11.5x |

At September's ratio, a $9,000 English card implies **$682** for the Japanese.
The sale was $784.90, six days after the English stepped. Not an outlier. The
second half of a move.

**Set to $785**, with the reasoning and a falsifiable prediction recorded on the
record: if the ratio holds the next Japanese sale lands above $500; if it comes
in near $200 the comp should drop to $150.

Also worth knowing: there is a **third** Darkrai Prism Star, Japanese Ultra Sun
SM5S 031/066, trading at $263–460. Three cards, one name. Any search that does
not pin the set number will blend them.

### 3. Gengar, Fossil #5, PSA 8 — needs your eyes, $1,170 at stake

- **Unlimited** #5 holo PSA 8: ten sales in October between $360 and $477,
  clustered hard on **$400**.
- **1st Edition** #5 holo PSA 8: $1,450, $1,500, $1,525, $1,595, $1,643, $1,700,
  $1,701, $1,732. Median about **$1,570**.

Your base says $400, Collectr said $1,432. Those are not a disagreement about
price, they are a disagreement about which card you own. **Left unchanged.**
Read the PSA label and tell me.

### 4. Misty's Gyarados, Gym Challenge 13/132, PSA 9 — same question, base looks right

- **Unlimited**: ~$375–400.
- **1st Edition**: nineteen sales, $770 to $1,150, median about **$900**.

Your base is $900, which matches 1st Edition exactly, so I believe it and
**left it unchanged**. Collectr's $1,633 is too high either way. Nothing has
sold in 30 days, so it is a stale comp.

### 5. Scizor, Neo Discovery 29/75, PSA 10 — both numbers were wrong

Your base said $2,200. Collectr said $93.94. The card actually trades at
**$398–412** for Unlimited, and the single highest sale in two years of history
is **$679.99** for a 1st Edition.

**Corrected to $406**, with the printing question flagged on the record. Even
the 1st Edition reading is a third of what you were carrying. This is a $1,794
markdown on one card and it was hand-entered, not Collectr's fault.

---

## The data gap that matters more than any single card

**Four of the five have a 1st Edition / Unlimited question worth 2x to 4x, and
your Airtable records do not say which.** The original 37 slabs were entered
with Card Name, Set, Number, Condition and nothing else.

No comp engine can fix this. The sales data separates the printings cleanly, so
the moment a record says which printing it is, the matching is reliable. Until
then every vintage slab is a coin flip between two prices that differ by more
than the card is worth. Filling in Printing on the vintage slabs is worth more
than anything else on the open list.

---

## Two more defects, found by running real data instead of my own fixtures

### A lone high sale set the comp with nothing confirming it

The Japanese Darkrai case. One sale inside the window, five times the card's own
history. The step detector could not speak because it needs two sales. The
low-outlier filter could not speak because it only cuts lows. So one print set
the price.

That is the same shape as Espeon on the raw path, which `lib/comp` has had a
demotion guard for since the import that created it. The slab path had nothing.
It does now: `demoteLoneHigh`. One-directional, matching `lib/comp`, because
believing a lone high over-values the card and an over-valued slab anchors a
surprise set, while a lone low is as likely to be a real decline as a wash sale.

### Sibling corroboration, which is your idea

Then you pointed out the guard was wrong on this card, and the fix is not to
loosen it. The guard reads one card's own sales and is structurally blind to the
English printing moving first. So `slabComp` now takes an optional `peerMove`:
how far a related printing moved. A lone high within 2x of the sibling's move is
corroborated and survives; anything else is still demoted. `moveFactorOf()`
reads a sibling's move straight off its own comp result, so the route can comp
the English copy, hand its factor to the Japanese one, and get this right
automatically.

Tested both ways: a 4.5x sibling move rescues the sale, a 1.2x move does not,
and a sibling that fell does not.

### A stale card threw away its own history

The old stale branch returned the single newest sale. Misty's Gyarados has
nineteen sales just outside the window and the rule picked the highest auction
result off the top of them. It now medians the recent ones.

That change had a trap in it, caught by its own test: a card that repriced and
then went quiet was getting its two levels medianed together, which is the
original bug in a different branch. It answered $5,450 for a card that had moved
from $2,000 to $8,900. The step test now runs **before** the stale branch.

---

## Still open

1. **Printing on the vintage slabs.** The highest-value thing on this list.
2. **Gengar**: $400 or $1,570, depending on the label.
3. **The route does not yet pass `peerMove`.** The function supports it and is
   tested; wiring the English-to-Japanese lookup into
   `app/api/singles/slab-comp/route.ts` is the remaining step.
4. **83 slabs unchecked.** Say the word and I will run the same loop on the rest,
   about 40 minutes.
5. **Nothing reprices slabs automatically** — `refreshSingleComps` still filters
   on `RAW_CONDITIONS`.
6. **The raw rising-sale lift still fires on one sale** and can lift a comp 2x.
   Same "one print is noise" question, 722 cards, untouched.

---

# Addendum: the rest of the sweep (cards 6 to 34)

Four more defects in the rule, all found by running it against live data rather
than against fixtures I wrote myself.

## 5. One high sale at the top of the old cluster could hide a move

**Dark Weezing 1st Edition 14/82 PSA 10.** September ran $1,055 to $1,550,
October ran $3,050 to $3,999. A 3.5x move. The step test scored it
3050/1550 = **1.97** against a threshold of 2 and rejected it, because it
measured the closest edges of the two clusters and one September sale happened
to run high.

Separation is still measured edge to edge and must be total. **Magnitude is now
measured median to median.** A single sale at the top of the old cluster can no
longer hide a repricing, which is the same mistake as anchoring the wash filter
on the window high, in a different place.

`STEP_MAX_GAP` moved from 5 to 10 as a consequence, and it is calibrated rather
than derived: Darkrai's genuine 5.8x move has to be admitted, the $20-to-$500
wash case at 22x has to be rejected, so the line sits between them.

## 6. The old cluster needed its own wash filter

Sales of $500, $520, $480 and $25 split into [$500, $520] against [$480, $25],
whose median of $252 made a 2.02x "repricing" out of one wash trade. The $25 is
not half of an old market. `dropLowOutliers` now runs on the older group before
it is measured, and the split is rejected if too little of an old level
survives.

## 7. A lone high sale set the comp with nothing confirming it

**Japanese Darkrai SM12a.** One sale inside the window at five times the card's
own history. The step detector could not speak (needs two sales), the
low-outlier filter could not speak (only cuts lows), so one print set the
price. `demoteLoneHigh` is the guard, mirroring the one `lib/comp` has carried
on the raw path since Espeon.

## 8. Sibling corroboration

Then Gabe overruled that guard on the same card, correctly. The English
printing had stepped to $9,000 six days earlier and the two printings had
tracked at 11-13x all year, so at September's ratio the sale was almost exactly
where it should be. `slabComp` now takes an optional `peerMove`, and a lone
high within 2x of a related printing's move survives. `moveFactorOf()` reads
that factor off a sibling's own comp result.

---

# What the sweep found in the data

## The printing field is where the money is

Four of the first five cards had a 1st Edition / Unlimited question worth 2x to
4x. The answer turned out to be sitting in the **Notes** field of the original
37 records all along, in the form `PSA 8 NM-MT | cert 121394457 | Holo` or
`PSA 9 Mint | cert 107815515 | Holo, 1st Edition`.

That resolved both open questions and **confirmed both of your hand-entered
numbers**: Gengar is Unlimited at $400, Misty's Gyarados is 1st Edition at
$871. Collectr had priced Gengar as a 1st Edition at $1,432, which is the
single clearest example of why the printing matters more than the algorithm.

Worth moving that data into the Printing field so the comp engine can read it
without a human.

## I damaged four records

I wrote flags into **Notes** on Scizor, Slowking, Metagross GX and Mega
Charizard X ex before realising that field held your cert numbers and printing
markers. Those values are gone from the field but recoverable from Airtable's
per-record revision history (open the record, click the clock icon).

Scizor is the one worth recovering: its old note would have settled the 1st
Edition question that is still open on it, and the gap is $406 against $680.

## The corrections, biggest first

| Card | Was | Now | Why |
|---|---|---|---|
| Darkrai Prism Star EN PSA 10 | $2,000 | **$9,000** | genuine 4.25x repricing in October |
| Slowking Neo Genesis PSA 9 | $2,500 | **$7,000** | base was stale; 1st Ed confirmed |
| Scizor Neo Discovery PSA 10 | $2,200 | **$406** | hand-entered, 5x over market |
| Dark Weezing 1st Ed PSA 10 | $3,013 | **$3,950** | 3.7x step, found by fix #5 |
| Pikachu SM162 CGC 10 | $1,232 | **$431** | highest sale on record is $431 |
| Mega Charizard X ex JP PSA 10 | $750 | **$75** | 10x over; a dozen sales at $65-$132 |
| Darkrai Prism Star JP PSA 10 | $154 | **$785** | your correlation call |
| Reshiram & Zekrom GX PSA 10 | $2,700 | **$2,323** | 8 sales, all $2,001-$2,500 |
| Metagross GX PSA 10 | $275 | **$591** | MARGINAL 2.2x step, worth a look |
| Pikachu ex Surging Sparks | $1,000 | **$727** | ten sales, $710-$863 |

Fourteen of the 34 moved less than 5%. The book is mostly sound; the damage is
concentrated in a handful of hand-entered figures.

## Still open

1. **Printing on the vintage slabs**, moved from Notes into its own field.
2. **Scizor's printing**, recoverable from revision history. $406 or $680.
3. **Metagross GX** at $591 on a marginal step call.
4. **54 slabs unchecked**, all under $200 each.
5. **The route does not pass `peerMove` yet.** The function supports it and is
   tested; wiring the EN-to-JP lookup into `app/api/singles/slab-comp/route.ts`
   is the remaining step.
6. **Nothing reprices slabs automatically** — `refreshSingleComps` still filters
   on `RAW_CONDITIONS`.
7. **The raw rising-sale lift still fires on one sale** and can lift a comp 2x,
   across 722 cards. Same question this work just answered for slabs.
