# LandLocked Cards - Stream Ops

## Quick start checklist
1. Airtable: create a PAT (data.records read+write on base `appYgQY5zxiVPyRWl`)
2. Streamers table: add yourself (Role: admin), Daniel (Role: manager, Override % as decimal), and each streamer - Name, Email, Active checked
3. Inventory: fill in Buy Price on the seeded products (P&L is only real once these are in)
4. Clerk: new app, restricted sign-ups, invite by email
5. GitHub: new repo `landlocked-cards-app`, upload these files
6. Vercel: new project, set env vars from `.env.example`, deploy
7. First stream: New stream > build show set > Copy show set > paste into the platform > clock in

Show set builder, inventory management, and streamer pay - the web app version of the 2026 Calculator workbook.

## What each role sees

**Streamers** (log in, see only their own data):
- Create a stream, build the show set with a searchable inventory picker (type "ETB" to filter)
- One-click "Copy show set" produces `4x Topps Pack` lines ready to paste into the streaming platform
- Live spot economics: spots (giveaways excluded), value per spot, break-even at the multiplier
- Timeclock: type stream start and end (and packing start/end) - hours calculate automatically,
  including overnight streams (8:00 PM to 1:30 AM = 5.50 hrs). Multiple entries per stream are fine.
- After the stream: enter after-fees, promo, tips, and track hits per product
- Weekly pay cards showing Option A (hourly) vs Option B (commission) with the winner highlighted
- Streamers never see buy prices, support pay, or company profit

**Stream managers** (e.g. Daniel):
- Everything a streamer gets, plus: creating streams and assigning them to another streamer
- On managed streams the manager does the packing (the streamer packing field is hidden); they enter
  their own packing hours and earn packing pay plus a commission
  override (their Override % on the Streamers table) on the managed streams' weekly commissionable profit
- Managed-stream losses net against gains within the week, same as streamer commission
- The assigned streamer sees and runs the stream normally and their pay is unaffected by the override,
  which comes out of the company side

**Admin** (you):
- Pay dashboard: every streamer, every week - profit, commissionable, A vs B, total pay, support, company profit
- Analytics tab: per-stream P&L with contribution, spots, and hits; hit tracking scoped to items over
  the hit threshold (default $10, adjustable in Settings) - packs are filler, hits are the high-value
  items, and the dashboards show hit pool size, hit odds per spot, and delivered rates; wage breakdown;
  per-person stats; hours and efficiency metrics
- Inventory tab: add products with buy price + market price + on-hand qty, inline editing, search, retire
- Per-product TCGplayer link and optional automated price refresh
- Settings tab: hourly rate, packing rate, support %, tier structure, break-even multiplier

## Pay logic (identical to the workbook)

Weeks run Sunday-Saturday. Only streams marked Complete count.
1. Week net profit = sum of (after fees - promo - product cost - tips) across the week. Tips are paid
   through 100% to the streamer, so they come out of profit before any commission or override. Losses offset gains.
2. Packing pay = packing hours x packing rate, deducted to get commissionable profit.
3. Option A = week hours x hourly rate. Option B = progressive tiers (15% / 20% / 25%) on commissionable.
4. Stream pay = the higher. Total pay = stream pay + packing pay + tips (tips ride on top of pay).
5. Support = support % x max(commissionable - stream pay, 0).
6. Manager override: for the streams a manager runs, packing (streamer's and manager's) comes out of
   profit first, the streamer's pay (higher of hourly or commission) is removed next, and the override %
   applies to what remains: override = override % x max(commissionable - streamer pay, 0). Manager also
   earns their packing hours x packing rate. Both come out of the company side; the streamer's pay is
   never reduced by the override. Company profit = what remains after all of the above.

Product cost per stream = sum of buy-price snapshots x qty on the show set (giveaways included, since they come out of profit). Prices snapshot at the moment a product is added to a show, so later price edits never change past pay.

## Setup

### 1. Airtable (already done)
Base `appYgQY5zxiVPyRWl` ("LandLocked Cards Streams") is live in your Airtable with tables: Inventory, Streamers, Streams, Stream Products, Settings. Settings and your 7/4 product list are seeded. Buy prices are blank - fill those in on the Inventory tab in the app or directly in Airtable.

Create a personal access token at airtable.com/create/tokens with scopes `data.records:read` + `data.records:write` on this base. That is `LLC_AIRTABLE_TOKEN`.

**Add yourself and your streamers to the Streamers table**: Name, Email (the email they will log in with), Hourly Rate (leave blank to use the default), Role = `admin` for you / `manager` for stream managers like Daniel / `streamer` for everyone else, Active checked. For managers, also set Override % as a decimal (0.05 = 5%). On their first login the app links their Clerk account to the row by email automatically.

### 2. Clerk
Create a new Clerk application (same flow as the PCP portal). Copy the publishable + secret keys. Recommended: turn off public sign-ups in Clerk (Restrictions > Sign-up mode: Restricted) and invite streamers by email, so only people you invite can get in.

### 3. GitHub + Vercel
1. Create a new repo (e.g. `landlocked-cards-app`) and upload these files through the web editor.
2. New Vercel project from the repo.
3. Environment variables (from `.env.example`):
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL` = `/sign-in`
   - `LLC_AIRTABLE_TOKEN`
   - `LLC_AIRTABLE_BASE_ID` = `appYgQY5zxiVPyRWl`
   - `PRICECHARTING_TOKEN` (optional, see below)
4. Deploy.

## Market prices: the honest situation

TCGplayer's developer API is closed to new applicants, so direct TCGplayer Market Price pulls are not possible for a new app. The workarounds built in:

1. **Manual + quick link** (works today, free): every inventory row has a TCGplayer link (uses your saved URL, or falls back to a search for the product name). Click, check, type the number.
2. **Automated via PriceCharting** (optional, paid): pricecharting.com sells API access that covers sealed Pokemon product. Add `PRICECHARTING_TOKEN` and the "Refresh all prices" / per-item "refresh" buttons will update Market Price by name match. Name matching is best-effort - spot-check after a bulk refresh.
3. **Collectr**: they do run an API program, but it is application-based - register at getcollectr.com/api and approval is at their discretion (their terms mainly guard against competing collection-tracker apps, which you are not). The refresh route is already structured for it: once approved, set `PRICE_PROVIDER=collectr` and `COLLECTR_API_KEY`, and fill in the one marked function in `app/api/prices/refresh/route.ts` using their docs.
4. Other self-serve vendors (JustTCG, TCGAPIs, tcgapi.dev) also sell sealed pricing and slot into the same provider function.

Buy price is always yours to enter - no API knows what you actually paid.

## File map

- `lib/calc.ts` - the entire pay engine (tiers, weekly netting, spot metrics)
- `lib/airtable.ts` / `lib/settings.ts` / `lib/auth.ts` - data + auth plumbing
- `app/dashboard` - streamer home. `app/streams/*` - stream builder.
- `app/admin/*` - pay dashboard, inventory, settings
- `app/api/*` - all routes enforce role checks server-side
