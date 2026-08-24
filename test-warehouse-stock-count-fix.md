# Test guide — warehouse physical-count reconciliation (4 SKUs, 2026-08-24)

One-off correction of **four** `warehouse-stocks` rows of **"Chhapra - Warehouse"**
(`6a4966bfb03f78b077eab7df`) against the manual physical-count sheet
`Store+WarehouseStock-Warehouse.csv` (columns `Stock`, `ADD +`, `Sub -`).

Of the 83 counted rows, only these 4 **reconcile** — only for these does
`Stock + ADD − Sub` land exactly on the `availableQty` seen in the fresh prod
dump. The other 79 do **not** reconcile and are out of scope: the script never
reads, plans or writes them.

> **The other 79 rows are covered by a separate, CSV-driven script** —
> see [test-warehouse-stock-count-fix-all.md](./test-warehouse-stock-count-fix-all.md).
> It classifies every row and holds the doubtful ones back; read its warning
> about the sheet's `ADD +` / `Sub −` columns being double-counted before
> applying anything from this sheet.

**Script**
- `haper-backend/scripts/migrations/fix-warehouse-stock-count-2026-08-24.js` — dry-run by default, `--apply` to write

## The four rows

| Barcode (sku) | Stock (sheet) | ADD/Sub | Adjusted = target | Expected live (dump) |
|---|---|---|---|---|
| 8901138512187 | 8 | +1 | 9 | 9 |
| 8901058018219 | 130 | −1 | 129 | 129 |
| 8909106025554 | 7 | −2 | 5 | 5 |
| 8906012040565 | 1 | +1 | 2 | 2 |

Target == expected for all four, so **the DB already agrees with the count**.
A run today is expected to report `confirmed` ×4 and write nothing.

## How it decides

| Thing | Rule |
|---|---|
| warehouse | id is hardcoded, but the **name is asserted** to be `"Chhapra - Warehouse"`; aborts otherwise |
| guard | update matches only while `availableQty` is still the dump value (compare-and-set) |
| drift | live value ≠ expected → **skipped and reported**, never overwritten (the count sheet is stale, a real movement happened) |
| zero delta | live == target → nothing written, and **no ledger row** (a 0-qty movement row would be a lie) |
| real delta | guarded `$inc` + `MANUAL_ADJUST` `stock-movements` row, in one transaction |
| batch warehouse | a non-zero delta is **refused** (roll-up must move with the lots — use goods-receipt / write-off) |
| reservations | a target below `reservedQty` is refused |
| table typos | `Stock + ADD − Sub == target` and `target == expected` are asserted before connecting |

## Run

```bash
cd haper-backend

# 1) DRY RUN — reads only, prints DB host/name + per-barcode verdict
node scripts/migrations/fix-warehouse-stock-count-2026-08-24.js

# 2) APPLY — only after reading the DB HOST/DB NAME banner
node scripts/migrations/fix-warehouse-stock-count-2026-08-24.js --apply --actor=<adminId>
```

`--actor=<adminId>` (or `SEED_ACTOR_ID`) is **required** for `--apply` — an
unattributed manual adjustment is not an audit trail. `--yes` skips the
interactive confirmation.

## Expected results

- ✅ Dry run prints the banner with the real `DB HOST` / `DB NAME`, the resolved
  warehouse name, whether the batch ledger is on, and a 4-row plan.
- ✅ All four verdicts read `confirmed — no write`; `rows needing a write: 0`.
- ✅ `--apply` reports `confirmed: 4`, `quantity CHANGED: 0`, `skipped: 0`,
  `FAILED: 0`, and **no** new `stock-movements` rows exist.
- ✅ Re-running `--apply` gives the identical result (idempotent).
- ❌ Wrong database → aborts with "no warehouse … Wrong database?".
- ❌ Warehouse renamed → aborts on the name assertion.
- ❌ A barcode whose live qty moved since the dump → that row alone reads
  `DRIFTED — skip` with expected vs live; the other three still process.
- ❌ A missing `warehouse-stocks` row → that row alone reads `MISSING` / `failed`.

## Edge cases

- **Someone sells/transfers one of these SKUs between the dry run and the
  apply** — the compare-and-set inside the transaction re-reads the live value,
  so the row is skipped, not overwritten.
- **Script run twice after a real correction landed** — the second run finds the
  row at `target`, not `expected`, so it skips. No double-application.
- **Batch ledger gets enabled later** — a real delta would then be refused with
  a message pointing at goods-receipt / write-off.

## Deploy

None. This is a manually-run script, not an API/app change — nothing to deploy,
no client follow-up.
