# Test guide — bulk warehouse → Bhagwan Bazar clearance transfer

Operation that moves **all** stock held in the Chhapra warehouse into the
"Haper - Bhagwan Bazar" store as a **single** stock transfer, driven through the
normal `CREATE → DISPATCH → RECEIVE` lifecycle so the bookkeeping is identical to
a transfer a human would build in the admin UI.

It is **repeatable**: the warehouse keeps receiving new goods, so the script can
be run again on a later day to clear whatever has arrived since. Each day's run
is its own transfer (see [Repeatable clearances](#repeatable-clearances--one-transfer-per-run-not-one-forever)).

**Scripts**
- `haper-backend/scripts/migrations/bulk-transfer-warehouse-to-bhagwan-bazar.js` — real run (dry-run by default, `--apply` to write)
- `haper-backend/scripts/migrations/simulate-bulk-warehouse-transfer.js` — offline simulator, **NO database**
- `haper-backend/scripts/migrations/bulk-warehouse-transfer.core.js` — the shared planner both use

## What it does

Every `warehouse-stocks` row of the resolved warehouse with `availableQty > 0`
becomes one line of one transfer. As of the last dump that is **450 lines /
7,808 units** (the real first run moved 455 lines / 7,916 units as `TR000009`).
The plan is recomputed **live on every run**, so a later run automatically covers
only the goods that have arrived since — the numbers below are illustrative, not
fixed.

It does **not** re-implement the transfer logic. It calls the real admin
controllers (`packages/admin/src/routes/transfer/controller.js`) with a synthetic
`req`/`res`/`next`, after passing the payload through the real Joi validators.
So the FEFO warehouse batch picks, the `stock-movements` `TRANSFER_OUT` /
`TRANSFER_IN` rows, the `reserved → inTransit → released` buckets, the store
batches and the `dispatchedBy`/`receivedBy` audit stamps are all produced by the
same code the UI runs.

| Thing | How it is decided |
|---|---|
| warehouse | resolved **by name** `"Chhapra - Warehouse"` at runtime; **aborts** on 0 or 2+ matches |
| store | resolved **by name** `"Haper - Bhagwan Bazar"` at runtime; same abort rule |
| which SKUs | `warehouse-stocks` rows for that warehouse with `availableQty > 0` |
| quantity per line | the full `availableQty` |
| store item per line | the store's `items` doc whose **barcode == the warehouse SKU** |
| actor | a real `super_admin` `_id` (`SEED_ACTOR_ID` / `--actor=`), verified to exist and to hold the role |

**A warehouse SKU that resolves to nothing is never skipped.** It lands in an
`UNRESOLVED` list and the script **aborts before writing anything**. A partial
transfer would leave stranded warehouse stock with no record of why.

## How to dry-run

Dry run is the default — there is no flag to add and nothing is written.

```bash
cd haper-backend
node scripts/migrations/bulk-transfer-warehouse-to-bhagwan-bazar.js
```

It prints the DB **host** and **name** it connected to (never the URI, never
credentials) and shouts `⚠️` if either looks like production. **Read those two
lines before doing anything else.**

The banner also prints the **marker** this run belongs to (today's date in IST
unless `--marker=` is given). The plan itself is read live from `warehouse-stocks`
each time, so a dry run always reflects the stock in the warehouse *right now*,
including goods received since the last clearance.

Then it prints the resolved warehouse/store, the plan counts, the sample payload,
a transaction-size estimate, and confirms the payload passes the real
`POST /transfer` validator.

✅ Expected on a clean run:

```
   warehouse stock rows read       : 450
   ├─ availableQty = 0 (skipped)   : 0
   ├─ UNRESOLVED (must be 0)       : 0
   └─ transfer lines               : 450   (total units 7808)

   store items resolved but INACTIVE : 0
   duplicate barcodes in store       : 0
   ✅ payload passes the real POST /transfer Joi validator.
```

❌ Stop and fix the data if any of these appear:
- `UNRESOLVED` > 0 — those SKUs have no Bhagwan Bazar item; enroll them first.
- `duplicate barcodes in store` > 0 — two store items share a barcode; the
  `(storeId, barcode)` partial unique index should make this impossible.
- `transfer lines` > 500 — the create validator caps `items` at 500 and this can
  no longer go as one transfer.

### Offline dry-run (no database at all)

Validates the barcode-resolution logic against static `bsondump` exports. This is
what to run first, before pointing anything at a real database.

```bash
bsondump prod-dump/haper-prod/warehouse-stocks.bson > /tmp/warehouse-stocks.jsonl
bsondump prod-dump/haper-prod/items.bson            > /tmp/items.jsonl
bsondump prod-dump/haper-prod/stores.bson           > /tmp/stores.jsonl
bsondump prod-dump/haper-prod/warehouses.bson       > /tmp/warehouses.jsonl

cd haper-backend
node scripts/migrations/simulate-bulk-warehouse-transfer.js
```

It resolves warehouse + store **by name** from those exports, prints the same
plan report, and runs the same gates. ✅ Ends with `All gates pass.`

## How to apply

```bash
cd haper-backend
SEED_ACTOR_ID=<super admin _id> \
  node scripts/migrations/bulk-transfer-warehouse-to-bhagwan-bazar.js --apply

# second clearance on the same day (rare):
SEED_ACTOR_ID=<super admin _id> \
  node scripts/migrations/bulk-transfer-warehouse-to-bhagwan-bazar.js --apply --marker=2026-08-10-batch2
```

It re-prints the plan, then asks for an interactive `yes` naming the DB and host.
`--yes` skips that prompt (use only in a scripted context).

The final summary must read:

```
   status              : RECEIVED
   lines received      : 450 / 450
   units moved         : 7808
   short lines         : 0 ✅
   TRANSFER_OUT ledger : 450 row(s) ✅
   TRANSFER_IN  ledger : 450 row(s) ✅
   warehouse SKUs still holding stock : 0 ✅ warehouse is empty
```

Exit code is `0` only if the transfer is `RECEIVED`, no line is short, and the
`TRANSFER_OUT` count matches the line count.

### Scale caveat — read before applying

Dispatch and receive each process **every line inside a single Mongo
transaction** (~2,250 and ~1,800 writes at 450 lines). If that exceeds the
server's `transactionLifetimeLimitSeconds` (60s by default on Atlas), the step
**aborts cleanly and completely** — nothing is half-applied — and the script can
simply be re-run. Prefer a quiet period. The dry run prints the estimate.

## Repeatable clearances — one transfer per run, not one forever

The transfer's `note` carries a **date-scoped marker**, built from **today's date
in IST**:

```
[bulk-wh-clearance-2026-08-10] Bulk warehouse clearance transfer — 2026-08-10 IST
```

Every run searches for a transfer with this warehouse + store + **this run's
marker**, and resumes it. That gives both properties at once:

| Situation | Marker | Result |
|---|---|---|
| second run the **same** day (crash / timeout retry) | same | **resumes** the same transfer — never a duplicate for the same batch |
| run on a **later** day (new goods have arrived) | different | **new** transfer for whatever stock is in the warehouse now |

Options that control the marker:

| Flag | Meaning |
|---|---|
| *(none)* | marker = today's date, IST — the normal case |
| `--marker=2026-08-10-batch2` | a **second** clearance on the same day (e.g. a big goods receipt landed in the afternoon) |
| `--marker=2026-08-09` | resume a run that **started before midnight** and has to be finished after it — pass the day it started |

The suffix must be 1–40 characters of letters/digits/`.`/`-`/`_`; anything else
(spaces, brackets, regex characters) is **rejected before the script touches the
database**.

The banner at the top of every run prints the marker it is using, so it is always
clear which generation of clearance a run belongs to:

```
║  MARKER    : [bulk-wh-clearance-2026-08-10]  (today, IST)                  ║
```

> **History.** The first production run (2026-08-10, `TR000009`, 455 lines /
> 7,916 units) was made before date-scoping and carries the old fixed marker
> `[bulk-wh-clearance-v1]`. No date-scoped marker matches it, so it is never
> resumed, re-received, or double-applied.

### Resumability — it cannot create a duplicate transfer within one run

Against **this run's** marker:

| Found | Behaviour |
|---|---|
| nothing | CREATE → DISPATCH → RECEIVE |
| `CREATED` | skip create; DISPATCH → RECEIVE |
| `DISPATCHED` | skip create + dispatch; RECEIVE only |
| `RECEIVED` | prints "already complete", exits `0`, writes nothing |
| `CANCELLED` | **aborts** — start a fresh clearance with a different `--marker=<suffix>` |
| 2+ matches | **aborts** — never guesses which one to continue |

Because each step is individually atomic, a crash or timeout leaves the transfer
in its previous status, and a re-run picks up exactly there. Nothing is applied
twice.

✅ **Same-day re-run is a no-op.** Run `--apply`, let it finish, then run
`--apply` again the same day. The second run must print `✅ Already RECEIVED` and
write nothing — **not** create `TR0000NN+1`. Even if new stock has landed in the
warehouse meanwhile, that stock stays put; it is picked up by the next day's run.

✅ **Next day's run is a fresh transfer.** With new stock in the warehouse, a run
on a later calendar day must create a **new** `TR0000NN+1` (marker = that day's
date) and move exactly the newly-arrived quantities. Yesterday's transfer must
stay `RECEIVED` and untouched.

✅ **Two clearances in one day.** After a completed run, `--marker=<today>-batch2`
must create a second, separate transfer for the stock that arrived after the
first one.

These three behaviours are covered by the persisted in-memory-Mongo suites
`haper-backend/packages/admin/__tests__/bulk-warehouse-transfer-apply.test.js`
and `…-core.test.js`.

## How to verify in admin

1. **Transfer list** — Inventory → Transfers. One new row, status `RECEIVED`,
   store "Haper - Bhagwan Bazar", note starting with **this run's** marker
   (e.g. `[bulk-wh-clearance-2026-08-11]`).
   Open it: every line shows `receivedQty == quantity` and carries
   `batchAllocations` (the FEFO lots picked at dispatch).
2. **Warehouse stock** — Warehouse → Stock. Every SKU that was in the run shows
   `availableQty = 0`, `reservedQty = 0`, `inTransitQty = 0`.
   ⚠️ SKUs that already had `availableQty = 0` before the run are untouched.
3. **Bhagwan Bazar item quantities** — each item's `quantity` has risen by
   **exactly** the transferred amount. On the last dump every Bhagwan Bazar item
   was at `0`, so afterwards each should equal its transfer line's quantity.
4. **Stock-movements ledger** — Inventory → Ledger, filter by the transfer.
   - 450 `TRANSFER_OUT` rows against the **warehouse** (negative `quantityDelta`)
   - 450 `TRANSFER_IN` rows against the **store** (positive `quantityDelta`)
   - every row has `refType: "transfer"`, `refId` = the transfer `_id`,
     `refLabel` = the human `TR0000NN`
5. **Store batches** — a receiving store batch per FEFO lot, `source: TRANSFER`,
   `sourceTransferId` = the transfer, carrying the warehouse lot's real cost and
   expiry (not the item's average cost).
6. **Discrepancy report** — Inventory → Transfer discrepancies. This transfer
   must **not** appear; it only lists short receipts.

### Pre-existing in-transit stock is not disturbed

42 of the SKUs already carry `inTransitQty` from 7 older `DISPATCHED` transfers
(`TR000001`–`TR000008`). `inTransitQty` is a shared per-SKU counter, so this run
adds its quantity at dispatch and removes the same quantity at receive — a full
receipt nets to zero and the older transfers' in-transit units survive intact.
✅ After the run, those 42 SKUs should still show their original `inTransitQty`.
This only holds because every line is received in full; a partial receipt would
leave the counter high.

## Rollback

What is actually possible depends on the stage, per the existing `cancel`
controller:

| Stage | Cancel possible? | What it does |
|---|---|---|
| `CREATED` | ✅ yes | releases the reservation and marks `CANCELLED`. No stock had moved, so nothing to undo. (This transfer is created directly, so it holds no reservation and the release is a no-op.) |
| `DISPATCHED` | ✅ yes — **full rollback** | returns each line's units to the warehouse, restoring **each FEFO lot to its own batch** with its real cost + expiry, clears in-transit, and writes a `MANUAL_ADJUST` ledger row per line with `reason: "transfer_cancelled_return"`. |
| `RECEIVED` | ❌ **NO** | the controller refuses with `400 "A received transfer cannot be cancelled"`. |

**There is no one-click rollback once the transfer is RECEIVED**, and there is no
store→warehouse transfer in this model (transfers are warehouse→store only).
Reversing it would be a manual, two-sided correction:

- store side — `PATCH /admin/items/:itemId/quantity` (Adjust Stock) per item to
  bring the quantity back down; writes `MANUAL_ADJUST` rows.
- warehouse side — put the stock back via a goods receipt
  (`POST /admin/procurement/receive`), which writes `PURCHASE_IN` rows against a
  supplier and therefore **distorts purchase history**.

That reversal is 450 manual adjustments and leaves a messier ledger than the
original. **So the real safety control is the dry run, not the rollback** — do
not `--apply` until the dry run reports `UNRESOLVED: 0` and the counts look
right. If something looks wrong after DISPATCH but before RECEIVE, cancel there:
that stage rolls back cleanly and completely.

## Deploy / PR needed

None. This is a script run by hand against a database; it ships no API or app
change. Nothing needs redeploying for it to take effect — the store's new
quantities are live the moment the transfer is `RECEIVED`.
