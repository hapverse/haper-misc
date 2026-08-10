# Test guide — stock up every EMPTY (qty 0) Bhagwan Bazar item to qty 20

One-off operation that sets the quantity of every currently-ACTIVE item of one
store — by default `"Haper - Bhagwan Bazar"` — **that is currently at 0** to
exactly **20 units**, using the same audited manual-adjustment mechanism as the
admin **Stock In / Adjust** control. Not a silent database overwrite.

> **SCOPE CHANGE — 2026-08-10:** the user's instruction is
> **"don't touch any item of that store whose qty > 0"**. Only items sitting at
> **zero** stock are in scope. Any item holding stock — 1 unit or 300 — is left
> **completely alone**: no quantity change, no ledger row, and no line in the CSV.
> The earlier version of this script levelled *everything* to 20 in **both**
> directions (1668 items, including **122 decreases**); those decreases are now
> impossible.

**Scripts**
- `haper-backend/scripts/migrations/bulk-set-bhagwan-bazar-qty-20.js` — real run (dry-run by default, `--apply` to write)
- `haper-backend/scripts/migrations/simulate-bulk-set-bhagwan-bazar-qty-20.js` — **offline** simulator, zero database
- `haper-backend/scripts/migrations/bulk-set-qty.core.js` — the pure planner shared by both

**Tests**
- `haper-backend/packages/admin/__tests__/bulk-set-bhagwan-bazar-qty-20.test.js` (in-memory Mongo, 17 tests)

**Status:** built + re-scoped and re-validated offline on 2026-08-10. **`--apply`
has never been run, and no live database (dev or prod) has been contacted by this
script in any mode.**

## What it does

Real, plain-English version: "put 20 on every shelf that is **empty**". An item
showing 0 gets 20 added. An item that already has 30 — or 20, or even just 1 —
is not looked at again. Nothing ever gets taken away.

The mechanism is the one behind `PATCH /item/:itemId/quantity`
(`packages/admin/src/routes/items/controller.js → updateItemQuantity`), which is
**delta-based, not "set to X"**:

| direction | repository call | used here? |
|---|---|---|
| `delta >= 0` | `ItemRepository.applyStockIn(...)` | **yes, always** — every in-scope item is at 0, so the delta is always `+20` |
| `delta < 0`  | `ItemRepository.findOneAndUpdateAtomicQty(...)` | **never** — unreachable from this script's plan |

Each write is paired **inside the same transaction** with a `stock-movements` row:

```
movementType : MANUAL_ADJUST
locationType : STORE
quantityDelta: +20
balanceAfter : 20
refType      : "manual"
reason       : "bulk_set_qty_20_<YYYY-MM-DD>"
actorId      : <--actor admin _id>,  actorType: "admin"
```

So every single unit added is visible in the store ledger
(admin → Inventory → Stock Ledger) and attributable to a named admin.

### Two independent guards against a decrease

1. **The planner drops them.** `buildPlan` only ever emits rows whose
   `currentQty === 0`; an item with stock goes to an `outOfScope` bucket that is
   never written and never serialized to CSV.
2. **`assertNoDecreases` throws.** It runs on the whole plan, again on the whole
   work list at the start of `applyPlan`, and again per item inside the
   transaction. A negative delta anywhere aborts loudly with
   `SCOPE VIOLATION … must never remove units` instead of writing.

Plus a third, at write time: `applyOne` **re-reads live stock inside the
transaction** and skips the item if it is no longer 0.

### What it deliberately does NOT use

`PUT /item/:itemId` (`controller.updateItem`). For a batch-ledger store it
silently **strips** `quantity` from the update; for a flag-off store it does a
raw `$set` with **zero** ledger entry. Wrong tool for a stock change.

### One item per transaction

~1,200 items in a single transaction would blow past Atlas's 60-second
transaction ceiling and lose all progress on any one bad row. Each item gets its
own short transaction, failures are collected (not thrown), and the run
continues. A failed item's stock and ledger are both rolled back — never one
without the other.

### Idempotent

The live quantity is **re-read inside each transaction**, right before the write.
If the item is no longer empty — stale plan, a sale/receipt landed, or a previous
partial run already stocked it — it is skipped and nothing is written. So a
re-run after a partial failure only touches the still-empty items, and a full
re-run reports `0 updated, everything skipped` and writes nothing.

## Offline dry run (NO database) — do this first

```bash
cd haper-backend
bsondump --quiet ../prod-dump/haper-prod/items.bson  > /tmp/items.jsonl
bsondump --quiet ../prod-dump/haper-prod/stores.bson > /tmp/stores.jsonl
node scripts/migrations/simulate-bulk-set-bhagwan-bazar-qty-20.js
```

Result from the 2026-08-10 export (**re-run after the scope change**):

| | |
|---|---|
| active Bhagwan Bazar items | **1696** |
| in stock (qty > 0) — **OUT OF SCOPE, untouched** | **531** |
| zero stock — in scope | **1165** |
| items written | **1165**, all `+20` → **+23,300 units** |
| DECREASES | **0** (structurally impossible) |

CSV: `haper-backend/scripts/migrations/data/bhagwan_bazar_qty20_zerostock_only_2026-08-10.csv`
(columns `iId,barcode,name,currentQty,newQty,delta`; 1165 data rows, every row
`currentQty = 0`, `newQty = 20`, `delta = 20`). The `zerostock_only` in the file
name is deliberate — the older all-items CSV was deleted so it cannot be mistaken
for this one.

✅ store resolved **by name**, aborting loud on 0 or 2+ matches
✅ counts reconcile: 1776 total → 80 inactive → 1696 active → 531 in stock + 1165 empty
✅ no row in the CSV has a negative delta or a non-zero `currentQty`
✅ this CSV is the revert list — every `iId` in it went from 0 to 20 and nothing else changed

## Real dry run (reads a live DB, writes nothing) — needs approval

```bash
cd haper-backend
node scripts/migrations/bulk-set-bhagwan-bazar-qty-20.js
```

✅ banner prints **MODE / DB HOST / DB NAME / STORE / TARGET QTY / SCOPE / DIRECTION / LEDGER reason / ACTOR**
✅ SCOPE line reads `ACTIVE items with qty = 0 ONLY (qty > 0 untouched)`
✅ DIRECTION line reads `STOCK IN ONLY — this run can never remove units`
✅ shouts `⚠️ looks like PRODUCTION` when host or db name matches `/prod/i`
✅ writes the date-stamped `..._zerostock_only_<date>.csv` under `scripts/migrations/data/`
✅ prints the plan (incl. `in stock, OUT OF SCOPE` count) + a 15-row sample, then `DRY RUN — nothing was written`
❌ nothing in `items` or `stock-movements` changes — verify with a count before/after

## Apply — needs explicit approval, run against dev first

```bash
cd haper-backend
node scripts/migrations/bulk-set-bhagwan-bazar-qty-20.js --apply --actor=<super admin _id>
# add --yes to skip the typed "yes" confirmation
```

✅ aborts if `--actor` is missing, or names an admin that does not exist
✅ the prompt states how many items will be stocked up **and** how many with stock will NOT be touched
✅ progress every 100 items
✅ final summary: stocked up / skipped (no longer 0) / FAILED (with reason) / units added / `units removed: 0` / items with stock untouched / CSV path
✅ exit code 1 if any item failed, 0 otherwise

Verify after applying (dev):

1. Admin → Inventory → item list for Bhagwan Bazar → every item that showed **0**
   now shows **20**; every item that already had stock shows **the same number as before**.
2. Admin → Stock Ledger, filter the store → **1165** `MANUAL_ADJUST` rows with reason
   `bulk_set_qty_20_<date>`, **all `+20`**, `balanceAfter` 20 on all of them, all
   attributed to the actor admin. **No negative row may exist.**
3. Re-run **without** `--apply` → `to STOCK IN: 0` (proves idempotency).
4. Re-run **with** `--apply` → `items stocked up: 0`, and the ledger row count does
   **not** grow.

## Edge cases covered by the Jest suite

| case | expected |
|---|---|
| item at 0, target 20 | `+20`, one MANUAL_ADJUST row, `balanceAfter` 20 |
| item at 30, target 20 | **out of scope** — not planned, quantity stays 30, zero ledger rows |
| item at **1**, target 20 | **out of scope** — untouched, despite being 19 away from the target |
| item at 19 or 21 | **out of scope** — "close to 20" is irrelevant; only 0 is in scope |
| item already at 20 | out of scope (it holds stock), quantity unchanged, **zero** ledger rows |
| item with no `quantity` field | treated as 0 → **in** scope, `+20`, not `NaN` |
| plan over quantities 0..49 | exactly one row planned (the 0), all deltas positive, `decreases: 0` |
| hand-built row with `delta: -10` | `applyPlan` **throws** `SCOPE VIOLATION`, writes nothing |
| `--qty=0` against an item holding 3 | skipped, quantity stays 3 (the old script would have emptied it) |
| item belongs to another store | fails that item only (`not found`), no ledger row, run continues |
| failure in the middle of the batch | items after it still processed |
| re-run of a stale plan (all now at 20) | 0 updated, all skipped, no duplicate ledger rows |
| CSV vs reality | one CSV row per ledger row, same delta; stocked items never appear; no negative delta anywhere |
| name containing a comma | quoted correctly in the CSV |

```bash
cd haper-backend/packages/admin && NODE_ENV=test npx jest __tests__/bulk-set-bhagwan-bazar-qty-20.test.js
# 17 passed
```

## Options

| flag | meaning |
|---|---|
| `--apply` | actually write (default is dry run) |
| `--yes` | skip the typed confirmation |
| `--actor=<id>` | admin the ledger rows are attributed to (or `SEED_ACTOR_ID`). Required for `--apply` |
| `--store=<name>` | target store name (default `Haper - Bhagwan Bazar`) |
| `--qty=<n>` | target quantity for the empty items (default 20) |
| `--sample=<n>` | preview rows (default 15) |

## Deploy / PR

None. This is a manual one-off script — nothing in the running services changes,
so no deploy is needed. It is run by hand from a machine pointed at the intended
database.
