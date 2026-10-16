# LandLocked Cards - merged upload, 2026-10-16

47 files. Everything uncommitted against `da2877a`, in one upload. Supersedes
landlocked-packer-v2.zip, landlocked-mcap-search.zip and landlocked-slab-tracker.zip.

Verified by checking out da2877a clean, overlaying these 47 files, and running
the full build on the result: typecheck clean, 924 tests pass, production build
clean, no module_not_found.

## What is in it

**Packer / manager / override split (pk-v5, pk-v6)**
The three roles are three fields. Packing pay follows the packer and nobody
else; manager of record buys access and no money. Previously no pay page read
Packing Fee at all, so the flat fee had never paid anyone since it shipped.
  lib/calc.ts, lib/packingFee.ts (re-export shim only, see below),
  app/api/streams/route.ts, app/api/streams/[id]/route.ts, app/api/time/*,
  app/api/streamers/[id]/route.ts, app/admin/payroll|analytics|insights|streams,
  app/admin/page.tsx, app/streams/[id]/StreamEditor.tsx, app/dashboard,
  app/vendor, components/Timeclock.tsx, lib/settings.ts

  NOTE: lib/packingFee.ts is deliberately a one-line re-export. Two production
  deploys failed with module_not_found when it was a real module that did not
  survive the upload. The rule it holds moved into lib/calc, which every caller
  already imports.

**Add-a-card search reaches the junk drawer (mc-v1)**
Miscellaneous Cards & Products, Blister/Deck Exclusives and League cards are
searchable. They were excluded twice over - flagged supplemental and outside
the newest-16 window - so stamped promos like Umbreon ex 060/131 could not be
found. Query now matches set name too, and strips a trailing (MCAP).
  lib/tcgcsvCards.ts

**Slab comp engine (sl-v1 .. sl-v4)**
Median of up to 5 eBay sales in 30 days, low outliers dropped, stale fallback
disclosed. Own route, a bulk button on the graded view, and a Recomp button on
the QR sticker page.
  lib/slabComp.ts, app/api/singles/slab-comp/route.ts,
  app/label/[id]/page.tsx, app/label/[id]/QuickSell.tsx,
  app/singles/SinglesClient.tsx

**Full grade ladder + Collectr grade parsing (sl-v3)**
PSA 1-10, BGS, CGC, SGC. normalizeGrade reads "PSA 10.0 GEM - MT" and friends.
Without this, 13 of 82 slabs in the export read as raw cards, got binder
pockets, and would have been priced off NM market.
  lib/slab.ts, lib/slots.ts, app/api/singles/route.ts

**Language accuracy (sl-v2)**
An English slab can no longer be priced off a Japanese sale. Asymmetric:
unmarked reads as English, and a non-English card must prove itself. Fixes the
same hole in the raw graded-sales panel.
  lib/gradedSales.ts, lib/slabComp.ts

**Slabs in surprise sets, uncapped (sl-v2)**
Slabs are ordinary candidates and exempt from maxItemPct. The swap-down pass
cannot evict them, so the rest of the wheel trades down around a big one.
  lib/quickSet.ts, app/api/quick-set/route.ts

**Import provenance (im-v1)**
A comp seeded by an import is its own basis, not an "estimate". A market price
for the right printing and condition is not the same claim as NM market times
a condition guess.
  lib/comp.ts, lib/pricingHealth.ts

**Graded upside panel (gs-v1)**
What a raw card last sold for at each PSA grade, so "is this worth sending off"
has an answer.
  lib/gradedSales.ts, components/GradedSales.tsx, components/GradeStrip.tsx,
  app/api/singles/graded-sales/route.ts, app/scan/ScanClient.tsx

## Still needed outside this upload

- Airtable Condition select: add PSA 7, 6, 5, 4, 3, 2, 1, CGC 9, BGS 9
- Airtable Language select: add German
- COMPS_API_KEY set in Vercel, or every eBay pull reports itself switched off
- Slab No (fldD2PVvrxOU5soY2) exists but is not backfilled yet
- No slab rotation: nothing reprices the 83 slabs unless someone clicks
