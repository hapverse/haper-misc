# Test: Profit snapshot fix — late deliveries stop disappearing (live bug fix)

**Area:** Admin panel → **Profits** page (super admin only). Backend:
`packages/shared/repositories/profit-snapshot.repository.js`,
`packages/shared/constants/profit.constant.js`,
`packages/cron/src/jobs/daily-profit-snapshot.js`,
`packages/admin/src/routes/analytics/{router,controller}.js`.
**Endpoints:** `GET /admin/analytics/profit` (extra fields, additive) ·
**new** `POST /admin/analytics/profit/recompute?date=YYYYMMDD` (**super admin only**).
**One-off script:** `npm run profit:backfill` — **the user runs this by hand**, dry run by default.
**Deploy needed:** backend **redeploy** + one **environment variable**
(`PROFIT_ATTRIBUTION_CUTOVER`). **No DB migration.** The admin UI label is a **later phase** — for
now the new fields are checked in the API response. Deploy is **manual and user-only.**
**Tests (green):** `packages/admin/__tests__/profit-attribution.test.js` (24 cases) ·
`packages/cron/__tests__/daily-profit-snapshot.test.js` (9 cases) ·
`packages/admin/__tests__/order-cogs-capture.test.js` (existing suite, extended).
Suite totals for this slice: **admin 970 passed · cron 38 passed · delivery 133 passed.**

> This fix ships **inside** the Scheduled Delivery Phase 0 slice
> (see [test-scheduled-delivery.md](test-scheduled-delivery.md)) but it is a **separate, live
> production bug**. Test it on its own. It is independently revertable.

---

## What went wrong (real example)

The nightly job runs at **01:00 IST** and used to compute **yesterday, once, and never look at that
day again**.

A customer orders on **Monday**. The rider marks it delivered on **Tuesday at 11 AM**. Monday's
profit row was already written at 01:00 on Tuesday, while that order was still open — so the order
was left out. Monday is never revisited. **That order's money is invisible in profit reporting for
ever.**

Measured on the offline 14 July 2026 data dump, across the **9 days** the cron had actually run:

| | Lost |
|---|---|
| Orders | **67** |
| Revenue | **₹9,665** |
| Profit | **₹1,158** |

The cron kept running after that dump, so the real hole today is bigger.

---

## What changed

**1. Which day an order's profit counts on**

| Order type | Counts on | Changed? |
|---|---|---|
| Normal prepaid (UPI / card / wallet) | the day it was **ordered** | **No — exactly as today** |
| **COD** | the day it was **delivered** | **Yes** |
| **Scheduled** (any payment method) | the day it was **delivered** | **Yes** (no scheduled order can exist yet) |

Real example: a COD order placed **10 Aug**, delivered **12 Aug**, now counts on **12 Aug**.
For a normal order nothing moves — ordered and delivered inside half an hour, both dates are the
same day.

This is not a new invention: **cash reconciliation and rider incentives already key COD off the
delivery date.** Profit now agrees with the money the business already reconciles that way.

**2. The nightly job now re-computes a rolling 7-day window** instead of one day, so a late-marked
delivery is picked up the next night. A day is now **deleted and rebuilt** from the orders, so a
refunded order also disappears again (before, a stale row survived for ever).

**3. A cutover date.** Days **before** the cutover are **never recomputed** and keep their old
numbers — nothing already reported moves. The profit API now returns a label explaining the seam.

**4. A super-admin repair endpoint** — recompute one past day without a deploy.

**5. `deliveredOn` hardening.** A future code change can no longer overwrite an already-delivered
order's delivery time with "now" (which would silently move its money to another day).
**No behaviour change today** — no current path does this. It is there so it stays a no-op.

**6. A one-off backfill script** to recover the lost pre-cutover days — see the bottom section.

---

## Before you start — the setting, and the ORDER you do things in

`PROFIT_ATTRIBUTION_CUTOVER` is an **environment variable on the backend** (`YYYY-MM-DD`, IST).
It is **not** a database setting on purpose: a cutover that could be edited from a screen would
silently rewrite what past numbers mean. Set it to **the day this actually deploys**.
Code default if it is not set: **`2026-08-04`**.
(`PROFIT_SNAPSHOT_WINDOW_DAYS` is optional, default **7**.)

**The ordering is load-bearing. Do it in this order:**

1. Set `PROFIT_ATTRIBUTION_CUTOVER` = **the deploy day** and deploy the backend.
2. Wait until that date has **passed** (i.e. from the next day onward).
3. Then run the backfill — dry run first.

> ⚠️ **With the cutover in the future the nightly job writes nothing at all** and logs:
> `nothing to compute — the attribution cutover (…) is not in the past yet`.
> **That is expected, not a bug.** The nightly job is never allowed to touch a day **before** the
> cutover — those days keep the old "counted on the order date" meaning and are filled once, by
> hand, with the backfill. While the cutover is still in the future, every day the job could
> compute is a pre-cutover day, so there is nothing it may write. The same clamp makes the backfill
> window empty (`Nothing to do — the window … is empty`) until the cutover day is behind you.

---

## Walkthrough — the fix itself

Log in as **super admin** and open the **Profits** page. Keep the browser **DevTools → Network** tab
open; the new fields are on the `profit` request's response (the on-screen label is a later phase).

### 1. Nothing visibly changes on day one
- ✅ The Profits page loads exactly as before. Today / Yesterday / This week / This month / All time
  tiles all render, with the same shape of numbers.
- ✅ **Pre-cutover days show exactly the same figures as before the deploy.** Note down two or three
  past-day numbers before deploying and compare after — they must be identical. (The single
  exception is a pre-cutover day whose order was delivered *after* the cutover — see
  "The one exception — orders that straddle the cutover" in the backfill section.)
- ❌ Nothing on the customer apps, picker, delivery app or order screens changes at all. This is a
  reporting-only change.

### 2. The new API fields are present (additive)
- ✅ In DevTools open the `GET /admin/analytics/profit` response. Alongside every field that was
  there before, it now carries:

```jsonc
"attribution": {
  "cutoverDate": "2026-08-04",
  "beforeCutover": "order_date",
  "afterCutover": "delivery_date_for_cod_and_scheduled",
  "label": "Up to 3 Aug 2026 profit is counted on the order date. From 4 Aug 2026, COD and scheduled orders count on the delivery date; other prepaid orders still count on the order date. All days are IST."
},
"provisional": { "fromDate": "2026-07-26", "toDate": "2026-08-01", "reason": "last 7 days may still adjust" },
"timezone": "Asia/Kolkata"
```

- ✅ `cutoverDate` matches the environment variable you set. If it reads `2026-08-04` and you set
  something else, the variable is not reaching the server.
- ✅ Every field that existed before is **unchanged in name, shape and meaning** — an older admin
  build keeps rendering fine.
- ✅ `provisional.fromDate` → `provisional.toDate` is exactly the stretch of days the nightly job
  re-computes: **today minus 7** through **yesterday** (never earlier than the cutover). Those days
  can still move; anything older is settled.
- ✅ **A backwards range is expected while the cutover is still in the future.** `fromDate` is
  clamped up to the cutover, so you can see `"fromDate": "2026-08-04", "toDate": "2026-08-01"` —
  from *after* to. It means **nothing is provisional yet**, because the nightly job is not writing
  anything until the cutover has passed. It is handled in code, and it is not a bug. Once the
  cutover day is behind you the range reads forwards again.

### 3. A COD order delivered the next day (the headline behaviour)
Slowest test, but the one that proves the rule. Use a real COD order on the dev store.
- ✅ Place a **COD** order today. Do **not** deliver it. Let the 01:00 job run.
- ✅ **Tomorrow**, mark it delivered. Wait for the next 01:00 run (or use the recompute endpoint in
  step 4 for that day).
- ✅ The order's money now sits on the **delivery day**, and **not** on the order day.
- ❌ It must never appear on **both** days. Add the two days up and compare against the order total —
  it must be counted exactly once.

### 4. A late-marked delivery gets repaired (the actual bug)
- ✅ Place a **prepaid** order and deliver it **after** the 01:00 job has run for that day.
- ✅ Before this fix, that day's figure would never move again. Now, after the **next** nightly run,
  that day's revenue and profit **go up** by that order.
- ✅ The cron log reads:
  `[profit-snapshot] recomputing YYYY-MM-DD → YYYY-MM-DD IST (window 7d, cutover YYYY-MM-DD)...`
  then `Done — 7 day(s) recomputed, N store row(s) written.`

### 5. A refunded day loses its row
- ✅ Take a day (after the cutover) whose **only** order was later refunded / un-delivered.
- ✅ After the next nightly run that day shows **₹0**, not the old money. The stale row is deleted,
  not left behind.

### 6. Manual repair endpoint — `POST /admin/analytics/profit/recompute?date=YYYYMMDD`
Use it when the nightly job was down for longer than its 7-day window.
- ✅ As **super admin**, `POST /admin/analytics/profit/recompute?date=20260810` → **200** with
  `{ "date": "2026-08-10", "storesUpdated": N, "timezone": "Asia/Kolkata" }`.
- ✅ Running it twice on the same day gives the **same numbers** (it is delete-and-rebuild).
- ❌ Any date **before** the cutover → **400**:
  *"Days before the attribution cutover (…) are not recomputed — they keep the older 'counted on the
  order date' meaning."*
- ❌ **Today** or a future date → **400**: *"Only yesterday or earlier can be recomputed — today is
  calculated live."*
- ❌ Missing / malformed date → **400**: *"date is required as YYYYMMDD (IST)"*.
- ❌ As a **store admin** (or any non-super-admin) → **403**
  *"You do not have access to this resource"*. It writes money numbers, so it is role-gated, not
  merely revenue-permission gated.

### 7. All-time tile is not double counted
- ✅ Recompute yesterday with the endpoint, then reload the Profits page. **All time** must not jump
  by a day's worth of money. (All time now sums snapshots **up to yesterday only** and adds today
  live on top — one number, once.)

---

## THE BACKFILL — recovering the lost days

**The user runs this themselves.** It is a one-off. **Dry run is the default: it writes nothing
unless you pass `--apply`.**

```bash
cd /path/to/haper-backend

npm run profit:backfill                                   # DRY RUN — per-day table, writes NOTHING
npm run profit:backfill -- --only-changed                 # dry run, only the days that would move
npm run profit:backfill -- --apply                        # actually write
npm run profit:backfill -- --from=2026-07-01 --to=2026-07-31 --apply   # one month only
```

### What it does
Rebuilds each **pre-cutover** day from the orders as they stand today, on the **old rule** (an order
counts on the day it was **created**). It changes no definitions — it only adds back the orders that
were wrongly left out because they were completed after the snapshot had already run.

### The one exception — orders that straddle the cutover
An order **created before** the cutover but **delivered on or after** it (COD or scheduled) is
counted on its **delivery day** by the nightly job. So a rebuild of its creation day deliberately
leaves it **out** — otherwise the same money would sit on two days for ever.

That exclusion (the "seam guard") lives in the **shared query builder**
(`buildWindowStages` in `packages/shared/repositories/profit-snapshot.repository.js`), not inside
the backfill script. Every rebuild of a past day goes through it — the nightly job, the backfill,
the super-admin recompute endpoint and the older `npm run profit` — so none of them can double count,
and a script written later inherits the guard without anyone remembering to add it.

Real example, cutover 11 Aug: a COD order placed 10 Aug 23:40 and handed over 11 Aug 00:20 counts
once, on **11 Aug**. Rebuilding 10 Aug does **not** add it back.

- ✅ So a handful of pre-cutover days near the seam can show a figure **slightly lower** than what
  was reported before, by exactly the straddling orders. That is correct, not a regression.
- ✅ Days with no straddling order (the whole earlier history) are unchanged.
- ❌ If you ever see the same order's money on both its creation day and its delivery day, stop —
  that is the double count this guard exists to prevent.

### Dry-run walkthrough
- ✅ Run `npm run profit:backfill`. It first prints a banner you should actually read:

```
╔══════════════════════════════════════════════════════════════════════════╗
║  PROFIT SNAPSHOT BACKFILL — one-off, old basis, pre-cutover days only     ║
╠══════════════════════════════════════════════════════════════════════════╣
║  MODE      : DRY RUN — nothing is written                                 ║
║  DB HOST   : <the cluster it is pointed at>                               ║
║  DB NAME   : <the database it is pointed at>                              ║
║  CUTOVER   : 2026-08-04 IST (this script stops the day before)            ║
║  TIMEZONE  : Asia/Kolkata                                                 ║
╚══════════════════════════════════════════════════════════════════════════╝
```

- ✅ **Check DB HOST and DB NAME before anything else.** If the name or host looks like production
  the script prints `⚠️ The target looks like PRODUCTION.` — stop and be sure that is what you want.
- ✅ Then it prints one line per day: stored orders / revenue / profit, the real figures, and the
  three deltas. It ends with, e.g.
  `9 of 40 day(s) would change — 67 order(s), ₹9665.00 revenue, ₹1158.02 profit recovered.`
  and `DRY RUN — nothing was written.`
- ✅ `-- --only-changed` prints only the days that would move — use it when the window is months long.
- ✅ **Nothing is written.** Re-run the dry run as often as you like.

### Apply walkthrough
- ✅ `npm run profit:backfill -- --apply` prints the same banner, then asks:
  `Type the database name (<name>) to write N day(s) of snapshots:`
- ❌ Type anything else → `Names did not match — nothing was written.` and it exits.
- ✅ Type the exact database name → it rebuilds each day and finishes with
  `✅ Done — N/N day(s) rebuilt, M store row(s) written.`
- ✅ Run it a **second** time: a fresh dry run afterwards should report **0 days would change**. It
  is idempotent.
- ✅ Open the Profits page: the recovered days now show the higher figures; the totals rise by
  roughly the amount the dry run predicted.

### ⚠️ The caveat for the release note
The headline is **"past figures move up, never down"** — because the missing orders are ones that
completed late. **But a day CAN move down**: the script rebuilds the day from scratch, so if an
order that was counted back then has since been **refunded or un-delivered**, it correctly drops
out. That is the truth catching up, not a bug. **Every such day shows a negative delta in the
dry-run table before anything is written** — read the table before you type `--apply`.

### ⚠️ `npm run profit` — ASK THE USER FIRST, do not run it casually
`npm run profit` (`scripts/recalc-profit.js`) is a **separate, older** script. Two things about it
are worth knowing — one is now safe, one still needs care.

**Safe now — it can no longer double count across the seam.** Its snapshot phase calls the same
`computeAndSaveSnapshot` → `buildWindowStages` as the nightly job, the backfill and the recompute
endpoint, so it inherits the seam guard for free. A COD order created before the cutover and
delivered after it lands on **one** day, never two. That is exactly why the guard was put in the
shared query builder instead of in each script.
*(An earlier version of this guide warned about double counting here. That warning was written
before the guard existed — it is no longer true.)*

**Still needs care, for a different reason — it rewrites cost prices on past orders.** Its
**Phase 1** walks old orders and fills each item line's frozen `costPrice` from **today's** catalog
cost, wherever that line has no cost (`0`, `null` or the field missing). Profit is computed from
that sale-time `costPrice` snapshot on the order — so filling those blanks **genuinely moves past
profit numbers**, usually **down**, because a line that used to look free suddenly has a cost.

Real example: a March order sold one 1 kg pack of sugar for ₹58 with `costPrice: 0` on the line, so
it was booked as ₹58 revenue and ₹58 profit. Phase 1 fills in today's catalog cost, ₹52. That
order's profit becomes **₹6**, and March's profit total drops by ₹52. Nothing is broken — the old
figure was wrong — but a month that was already reported has just changed, and those figures now
also go out through the new cutover-labelled reports.

To be fair to the script, the blast radius is bounded: Phase 1 is **fill-only**. It never overwrites
a line that already has a cost, never touches `salePrice`, and only fills from a catalog item whose
cost is greater than 0.

**So the rule is "do not run it without asking", not a flat "never run it".**
- ❌ **Testers must not run it on their own.** With no flag it writes straight away — there is no
  type-the-database-name confirmation like the backfill has.
- ✅ If it needs to run, run `npm run profit -- --dry` first, show the user what it would change, and
  get an explicit yes.
- ✅ To recover the lost pre-cutover days, use **`npm run profit:backfill`** instead: dry run by
  default, hard-clamped so it can never touch a day on or after the cutover, and it does not touch
  order costs at all.

---

## Edge cases worth probing

| Case | Expected |
|---|---|
| An old order with **no `deliveryType` field at all** (every order placed before this change) | Treated as a normal "now" order — counts exactly as it does today |
| Old **CLOSED** orders with `deliveredOn: null` (~2,836 of them, all pre-Feb 2026) | Fall back to the order date. They must **not** vanish from reports |
| A COD order **created before** the cutover, **delivered after** it | Appears in **exactly one** day's row across the whole collection — never both sides of the seam |
| Re-closing an **already-closed** order (a write that sets CLOSED again without a delivery date) | The original delivered date is **kept**. Its money does not move to another day |
| Cancelled → reopened → delivered again | Does re-stamp the delivered date — the stored status is not CLOSED at that moment, so this is a genuine re-delivery |
| An order that is not CLOSED (open, un-delivered, admin-cancelled, refunded) | Never counted, as before |
| IST boundary | `deliveredOn` at `18:29 UTC` is the **4th** IST; `18:31 UTC` is the **5th**. Days are IST, not UTC |
| Same day computed twice from different times of day | **One** row, same numbers — never two rows for one business day |
| Nightly job dies on one bad day | The other days still compute; the log names the failed day |
| Cutover set to a **future** date | Nightly job writes nothing and logs a warning; backfill reports an empty window. Expected |

---

## Running the automated tests

In-memory Mongo only — **never point tests at the real database.** Run from the package directory so
the per-package in-memory setup fires:

```bash
cd packages/admin && NODE_ENV=test npx jest      # 970 passed
cd packages/cron  && NODE_ENV=test npx jest      # 38 passed
```

The dedicated files are `packages/admin/__tests__/profit-attribution.test.js` (the rule, re-runs,
the cutover, the API shape) and `packages/cron/__tests__/daily-profit-snapshot.test.js` (the rolling
window, the future-cutover warning, never writing a today row).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Nightly log says *"nothing to compute — the attribution cutover … is not in the past yet"* | The cutover is today or later. Expected until that day passes |
| `provisional.fromDate` is **later** than `provisional.toDate` | Expected while the cutover is still in the future — it means nothing is provisional yet. It reads forwards again once the cutover day has passed |
| `attribution.cutoverDate` shows `2026-08-04` but you set another date | `PROFIT_ATTRIBUTION_CUTOVER` is not reaching the process — check the backend `.env` on the server and restart |
| Log warns `PROFIT_ATTRIBUTION_CUTOVER="…" is not a valid YYYY-MM-DD date` | Wrong format (e.g. `04-08-2026`). It falls back to `2026-08-04` |
| Backfill prints `Nothing to do — the window … is empty` | The cutover has not passed yet, or `--from`/`--to` exclude everything |
| Backfill says `No closed orders at all` | Pointed at an empty / wrong database — re-read the DB NAME line in the banner |
| `POST /analytics/profit/recompute` returns 404 | Backend not redeployed — the endpoint is new this release |
| Recompute returns 403 for an admin who can see the Profits page | Only **super admin** may write money numbers; the read permission is not enough |
| A past day's figure went **down** after the backfill | An order counted back then has since been refunded or un-delivered. Check the dry-run table for that day |
| Profit figures disagree with the dashboard order tiles / COGS report | Expected and pre-existing — those reports still count by order date. Only the Profits page uses the new rule |
