# Test guide — level every ACTIVE Bhagwan Bazar item to qty 20

One-off operation that sets **every currently-ACTIVE item** of one store — by
default `"Haper - Bhagwan Bazar"` — to exactly **20 units**, using the same
audited manual-adjustment mechanism as the admin **Stock In / Adjust** control.
Not a silent database overwrite.

**Scripts**
- `haper-backend/scripts/migrations/bulk-set-bhagwan-bazar-qty-20.js` — real run (dry-run by default, `--apply` to write)
- `haper-backend/scripts/migrations/simulate-bulk-set-bhagwan-bazar-qty-20.js` — **offline** simulator, zero database
- `haper-backend/scripts/migrations/bulk-set-qty.core.js` — the pure planner shared by both

**Tests**
- `haper-backend/packages/admin/__tests__/bulk-set-bhagwan-bazar-qty-20.test.js` (in-memory Mongo, 12 tests)

**Status:** built + tested offline on 2026-08-10. **`--apply` has never been run,
and no live database (dev or prod) has been contacted by this script in any mode.**

## What it does

Real, plain-English version: "put 20 of everything on the shelf". An item with 0
gets 20 added. An item that somehow has 30 gets 10 taken away. An item that is
already at 20 is left completely alone.

The mechanism is the one behind `PATCH /item/:itemId/quantity`
(`packages/admin/src/routes/items/controller.js → updateItemQuantity`), which is
**delta-based, not "set to X"**:

| direction | repository call | guard |
|---|---|---|
| `delta >= 0` | `ItemRepository.applyStockIn(...)` | batch-aware; blank batch no. on a batch-ledger store is auto-named `AR-YYYYMMDD` |
| `delta < 0`  | `ItemRepository.findOneAndUpdateAtomicQty(...)` | refuses to go below zero (returns `null`) |

Each is paired **inside the same transaction** with a `stock-movements` row:

```
movementType : MANUAL_ADJUST
locationType : STORE
quantityDelta: <signed delta>     e.g. +20 or -10
balanceAfter : 20
refType      : "manual"
reason       : "bulk_set_qty_20_<YYYY-MM-DD>"
actorId      : <--actor admin _id>,  actorType: "admin"
```

So every single unit added or removed is visible in the store ledger
(admin → Inventory → Stock Ledger) and attributable to a named admin.

### What it deliberately does NOT use

`PUT /item/:itemId` (`controller.updateItem`). For a batch-ledger store it
silently **strips** `quantity` from the update; for a flag-off store it does a
raw `$set` with **zero** ledger entry. Wrong tool for a stock change.

### Items already at 20 are skipped

Delta 0 means no stock write **and no ledger row**. A no-op audit row would be
noise, not an audit trail.

### One item per transaction

~1,700 items in a single transaction would blow past Atlas's 60-second
transaction ceiling and lose all progress on any one bad row. Each item gets its
own short transaction, failures are collected (not thrown), and the run
continues. A failed item's stock and ledger are both rolled back — never one
without the other.

### Idempotent

The delta is **recomputed from live stock inside each transaction**, right before
the write. So a re-run after a partial failure only touches what is still
off-target, and a full re-run reports `0 updated, everything skipped` and writes
nothing.

## Offline dry run (NO database) — do this first

```bash
cd haper-backend
bsondump --quiet ../prod-dump/haper-prod/items.bson  > /tmp/items.jsonl
bsondump --quiet ../prod-dump/haper-prod/stores.bson > /tmp/stores.jsonl
node scripts/migrations/simulate-bulk-set-bhagwan-bazar-qty-20.js
```

Result from the 2026-08-10 export:

| | |
|---|---|
| active Bhagwan Bazar items | **1696** |
| already at 20 (skipped) | **28** |
| to INCREASE | **1546** items, **+27,784** units |
| to DECREASE | **122** items, **−3,689** units |
| items written | **1668** |

CSV: `haper-backend/scripts/migrations/data/bhagwan_bazar_qty20_affected_2026-08-10.csv`
(columns `iId,barcode,name,currentQty,newQty,delta`, biggest increase first).

✅ store resolved **by name**, aborting loud on 0 or 2+ matches
✅ counts match the known store shape (1776 total, 80 inactive → 1696 active)
✅ the biggest single decrease is `BI43606 Wowper Diaper S1 → −260`; sanity-check
   a handful of the big decreases with a human before applying, since those are
   the rows where a wrong "20" is most expensive.

## Real dry run (reads a live DB, writes nothing) — needs approval

```bash
cd haper-backend
node scripts/migrations/bulk-set-bhagwan-bazar-qty-20.js
```

✅ banner prints **MODE / DB HOST / DB NAME / STORE / TARGET QTY / LEDGER reason / ACTOR**
✅ shouts `⚠️ looks like PRODUCTION` when host or db name matches `/prod/i`
✅ writes the same date-stamped CSV under `scripts/migrations/data/`
✅ prints the plan + a 15-row sample, then `DRY RUN — nothing was written`
❌ nothing in `items` or `stock-movements` changes — verify with a count before/after

## Apply — needs explicit approval, run against dev first

```bash
cd haper-backend
node scripts/migrations/bulk-set-bhagwan-bazar-qty-20.js --apply --actor=<super admin _id>
# add --yes to skip the typed "yes" confirmation
```

✅ aborts if `--actor` is missing, or names an admin that does not exist
✅ types `yes` at the prompt before anything is written
✅ progress every 100 items
✅ final summary: updated / skipped / FAILED (with reason) / total units added / removed / CSV path
✅ exit code 1 if any item failed, 0 otherwise

Verify after applying (dev):

1. Admin → Inventory → item list for Bhagwan Bazar → every active item shows **20**.
2. Admin → Stock Ledger, filter the store → 1668 `MANUAL_ADJUST` rows with reason
   `bulk_set_qty_20_<date>`, mixed `+`/`−` deltas, `balanceAfter` 20 on all of them,
   all attributed to the actor admin.
3. Re-run **without** `--apply` → `items to adjust: 0` (proves idempotency).
4. Re-run **with** `--apply` → `items updated: 0, items skipped: 1696`, and the
   ledger row count does **not** grow.

## Edge cases covered by the Jest suite

| case | expected |
|---|---|
| item at 0, target 20 | `+20`, one MANUAL_ADJUST row, `balanceAfter` 20 |
| item at 30, target 20 | `−10`, one MANUAL_ADJUST row, `balanceAfter` 20 |
| item already at 20 | skipped, quantity unchanged, **zero** ledger rows |
| item with no `quantity` field | treated as 0, not `NaN` |
| decrease can never go negative | max decrease = stock on hand; the repository guard still returns `null` for an oversized decrease |
| item belongs to another store | fails that item only (`not found`), no ledger row, run continues |
| failure in the middle of the batch | items after it still processed |
| re-run of a stale plan | 0 updated, all skipped, no duplicate ledger rows |
| CSV vs reality | one CSV row per ledger row, same delta, same `balanceAfter`; skipped items never appear in the CSV |
| name containing a comma | quoted correctly in the CSV |

```bash
cd haper-backend/packages/admin && NODE_ENV=test npx jest __tests__/bulk-set-bhagwan-bazar-qty-20.test.js
# 12 passed
```

## Options

| flag | meaning |
|---|---|
| `--apply` | actually write (default is dry run) |
| `--yes` | skip the typed confirmation |
| `--actor=<id>` | admin the ledger rows are attributed to (or `SEED_ACTOR_ID`). Required for `--apply` |
| `--store=<name>` | target store name (default `Haper - Bhagwan Bazar`) |
| `--qty=<n>` | target quantity (default 20) |
| `--sample=<n>` | preview rows (default 15) |

## Deploy / PR

None. This is a manual one-off script — nothing in the running services changes,
so no deploy is needed. It is run by hand from a machine pointed at the intended
database.
