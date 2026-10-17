# Test guide — repairing a lot recorded at the wrong cost (and the orders sold from it)

## Scenario
A store-batch lot (a "lot" = one batch of stock on the shelf, with its own cost per unit)
was created with a wrong cost. Every sale from that lot froze the wrong cost on the order
line, so profit for those days is understated.

Real case (Haper Mart, "Aadi / Adrakh - 50g"): true cost 6, but an item edit set 45 and the
batch switch-on seeded the LEGACY lot at 45; a cancel-restock then averaged it to 37.94 (restocks no longer do this: see `test-inventory.md` section 17).
Each unit sold at 10 showed a loss of 35 instead of a profit of 4.

Two one-off scripts in `haper-backend/scripts/migrations/` (NOT in `run.js`), both dry-run by default:

| Step | Script | Writes |
|---|---|---|
| A | `repair-bad-lot-cost.js --survey` | nothing (read-only list of lots at a suspicious cost) |
| B | `repair-bad-lot-cost.js` | that lot's `costPrice` + the item's roll-up cost (repo rule `recomputeItemRollup`) |
| C | `restate-order-line-cost.js` | `orders.items[].costPrice` + that line's `batchAllocations[].costPrice` only |
| D | admin `POST /analytics/profit/recompute?date=YYYYMMDD` | `profit_snapshots` for one past day |

**Tests:** `packages/admin/__tests__/repair-bad-lot-cost.test.js`, `restate-order-line-cost.test.js` (in-memory Mongo).
Run: `cd haper-backend/packages/admin && PATH=/opt/homebrew/opt/node@24/bin:$PATH NODE_ENV=test npx jest __tests__/repair-bad-lot-cost.test.js __tests__/restate-order-line-cost.test.js --runInBand --coverage=false`

## Order to run (do B before C)
B first stops new sales at the bad cost; C's window runs to "now", so anything sold in between is still caught.

1. **A — survey.** `node scripts/migrations/repair-bad-lot-cost.js --survey` (and `--value=37.94`).
   - ✅ Prints every lot at that cost with store, item, barcode, batch, units left, item sell/MRP.
   - ✅ `COST>MRP` / `COST>SELL` flags mark the clearly impossible ones.
   - ❌ Asks for `--cost` or writes anything -> wrong script/version.
2. **B — dry run.** `... --store=<id> --item=<id> --lot=<lot _id or batchNo> --cost=<n>`
   - ✅ Shows `lot cost 37.94 -> 6` and `item cost 7.99 -> 5.09` (example: 3 units at 6 + 30 at 5 = 5.09).
   - ✅ Prints the undo line (`--cost=<old value>`).
   - ❌ `item quantity X != open lots Y` -> stock drift; fix it first with `repair-store-batches-stale-and-cost.js`.
3. **B — apply.** add `--apply --confirm-db=<db name>`; type the db name at the prompt.
   - ✅ `APPLIED`, and `Roll-up matches the dry-run projection`.
   - ✅ Lot `qtyRemaining` / `qtyReceived` unchanged; other lots unchanged.
   - ✅ Re-run says `already has this cost` and writes nothing.
4. **C — dry run.** `node scripts/migrations/restate-order-line-cost.js --store=<id> --item=<id> --cost=<n>`
   - ✅ One row per order with before -> after and the profit change; cancelled orders marked `*` and `skip-cancelled`.
   - ✅ `MANUAL` rows = a line that mixes a bad lot with a good one; never written.
5. **C — apply.** add `--apply --confirm-db=<db name> --backup=<file outside any git repo>`.
   - ✅ Backup file written first; `Re-plan after write: 0 order(s) still to write (clean)`.
   - ✅ Other lines in the same order (other items) keep their cost; salePrice/quantity untouched.
   - ✅ Re-run says `Nothing to write`.
   - Undo: `--revert=<backup file> --cost=<n>` (dry run), then add `--apply --confirm-db=<db name>`.
6. **D — profit snapshots.** As super admin, call the recompute endpoint once per affected day (IST).
   The nightly 01:00 job only redoes the last 7 days, so older days stay wrong until recomputed.
   - ✅ Profit page for those days goes up by the dry-run's per-order deltas (plus any unrelated late changes).

## Edge cases
- `--cost` missing, 0, or with 3 decimals -> refused. `--cost` equal to one of `--values` -> refused.
- `--lot=LEGACY` when two lots share that batchNo -> refused; pass the lot `_id`.
- Store with batches OFF -> step B refused (item cost is not lot-driven there).
- Order cancelled between dry run and apply -> its write matches nothing and is reported, not forced.
- `--include-cancelled` restates cancelled/failed/fully refunded orders too; no profit effect (only CLOSED orders count).
- Product COGS report (`/analytics/product-cogs`) and today's tile read orders live — correct right after C, no recompute.

## Deploy
Nothing to deploy — standalone scripts, run by hand. Profit endpoint already exists.
