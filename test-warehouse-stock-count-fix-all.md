# Test guide — warehouse PHYSICAL STOCK-TAKE, all 83 rows (2026-08-25)

Force **every** row of the manual physical-count sheet
`Store+WarehouseStock-Warehouse.csv` onto **"Chhapra - Warehouse"**
(`6a4966bfb03f78b077eab7df`), treating the sheet as the truth.

**Script — this is the one to run**
- `haper-backend/scripts/migrations/fix-warehouse-stock-count-apply-all-2026-08-25.js`
  — dry-run by default, `--apply` to write.

**Superseded, do not run**
- `fix-warehouse-stock-count-all-2026-08-25.js` — the earlier "the sheet is
  doubtful" version. It is kept for its written-up analysis of where the sheet's
  `ADD +` / `Sub −` columns came from, is marked SUPERSEDED in its header, and
  now **hard-aborts on `--apply`**. Its dry run still works.
- `fix-warehouse-stock-count-2026-08-24.js` — the original 4-row fix. Historical.

---

## The decision this script implements

The operator reviewed the sheet row by row and ruled:

> "db should hold whatever is in csv. csv is right. STOCK + (ADD+/SUB-)"

So:

```
Target = Stock + (ADD + , blank = 0) − (Sub − , blank = 0)
```

`Target` is **authoritative**. For each barcode the script reads the **live**
warehouse quantity at run time and moves it to exactly `Target` — however far
away it is and in whichever direction. This is a physical stock-take: the shelf
beats the system's book value.

Two things the earlier script did are **deliberately gone**:

| earlier behaviour | now |
|---|---|
| held back "large delta" / "ADD == Stock" rows | **applied** — e.g. `8901595863051` (Stock 96, ADD 96 → **192**) goes in; the operator confirmed this jump is a real stock-take finding |
| skipped a row whose live value had drifted from the snapshot | **overwritten** — the whole job is to overwrite whatever the DB currently says |
| used the sheet's `DB Stock` / `Diff` columns as the guard | **ignored for the write decision** (that was an old comparison); they're printed for context only |

The **one** thing still refused: a **negative target**. A shelf cannot hold −27
units, so `Target < 0` is arithmetic that is wrong in the sheet, not a count.
Those rows are skipped and reported loudly, and are **not clamped to 0** —
silently zeroing a shelf someone counted 35 units on would be worse than doing
nothing.

---

## The hard part: this warehouse is batch-tracked

`Chhapra - Warehouse` has `batchesEnabled`, so `warehouse-stocks.availableQty`
is a **derived roll-up**: it must equal Σ(`qtyRemaining`) over that sku's open
`warehouse-batches` rows, and the nightly `inventory-batch-reconcile` check
asserts exactly that. A bare `$set availableQty = Target` would move the total
without moving a single lot, and every touched sku would light up on the next
reconcile. So the **lots** move:

| case | what happens |
|---|---|
| `delta > 0` (found more) | `WarehouseBatchRepository.stockIn()` into a dedicated lot **`SC-YYYYMMDD`** (IST), `source: MANUAL`, `expiresAt: null` |
| `delta < 0` (found fewer) | `WarehouseBatchRepository.stockOutFEFO()` consumes `\|delta\|` oldest-expiry-first |
| lots don't hold `\|delta\|` | **refused** (`REFUSED-insufficient-batches`) — nothing touched, never forced negative |
| sku has stock but **no lots at all** (pre-batch data) | `ensureLegacyBatch` seeds the LEGACY lot first, in the same transaction, so FEFO has something to consume |
| `delta == 0` | nothing written, **no ledger row** (a 0-qty movement row would be a lie) |

Design choices worth knowing:

- **`delta` is computed against Σ(open lots), not against `availableQty`.**
  Normally identical. When they differ (pre-existing drift) the **lots** are the
  real inventory and the roll-up is the stale copy — anchoring on the lot sum is
  what makes the final recompute land on `Target` *exactly*, so the drift gets
  fixed as a side effect. Any such row prints `PRE-EXISTING DRIFT: …`.
- **Its own batch number `SC-…`**, not `LEGACY` and not that day's `AR-…`
  receipt lot. Merging counted-in units into a supplier lot would blend their
  cost and hide the correction. A same-day re-run merges into the same `SC-` lot,
  which keeps it idempotent.
- **Cost of found units = the sku's current `warehouse-stocks.costPrice`** (its
  last known cost here). Those units are physically real and were bought at
  *some* price; carrying the existing cost leaves the weighted average — and
  therefore COGS — unchanged. A 0 would silently dilute the average toward zero
  and understate cost of goods for everything sold out of that sku afterwards.
  Falls back to 0 only when the sku has no cost on record at all, and every such
  row is called out in the plan (`no costPrice on record …`).
- **`expiresAt: null`** — a person counting a shelf does not know the lot's
  expiry. Null sorts **last** in FEFO (`fefoCompare` treats it as `Infinity`), so
  real dated stock is still consumed before it.
- If the `batchesEnabled` flag is ever **off**, the same target is reached with a
  compare-and-set `$set availableQty = Target`.

Every real change is paired, **in the same transaction**, with one signed
`MANUAL_ADJUST` row in `stock-movements`, `reason:
"physical_stock_take_reconciliation_2026-08-25"`.

**Transaction granularity: one per row.** All 83 in one transaction would let a
single refused sku roll back 82 good corrections.

---

## Counts for the real 83-row CSV

Parsed straight from `Store+WarehouseStock-Warehouse.csv` with the script's own
`readSheet` / `computeTarget`:

| | count |
|---|---|
| rows | **83** |
| MALFORMED (won't parse / duplicate barcode) | **0** |
| REFUSED — negative target | **6** |
| rows that will be written or confirmed | **77** |

The 6 negative-target rows (these need a re-count or a sheet fix — the script
will not write them):

| barcode | Stock | ADD + | Sub − | Target |
|---|---|---|---|---|
| `8901414035034` | 2 | – | 6 | **−4** |
| `8906017861295` | 35 | – | 62 | **−27** |
| `8901063139374` | 30 | – | 32 | **−2** |
| `8901063025486` | 12 | – | 16 | **−4** |
| `8901088704564` | 1 | – | 6 | **−5** |
| `8909106071216` | 2 | – | 4 | **−2** |

**Expected ADD / REMOVE / NOOP split.** The real split is decided against the
**live** DB at run time, so the dry run is the authority. Measured against the
sheet's own (stale) `DB Stock` column — the best offline estimate — it is:

| action | rows | units |
|---|---|---|
| **ADD** (found more) | **47** | **+1042** |
| **REMOVE** (found fewer) | **26** | **−203** |
| **NOOP** (already at target) | **4** | 0 |
| REFUSED — negative | **6** | – |
| total movement | | **1245 units** |

`REFUSED — no warehouse-stocks row` and `REFUSED — insufficient batch stock`
cannot be predicted offline — both need the live `warehouse-stocks` /
`warehouse-batches` rows. Expect **0 of each** if the sheet's `DB Stock` column
is still roughly accurate (every one of the 26 removals asks for less than that
column holds), but **the dry run is what tells you for real** — read it before
`--apply`.

---

## Not silently corrected

`reservedQty` (units committed to an approved, not-yet-dispatched transfer) is
**additive** — free-to-promise is `availableQty − reservedQty`. If the counted
target lands **below** `reservedQty`, the count still wins (the units are simply
not on the shelf) but the row is flagged `⚠ target N is BELOW reservedQty M` so
someone can go fix the affected transfer. Warning, never a refusal.

---

## Run

```bash
cd haper-backend

# 1) DRY RUN — reads only. Prints DB HOST / DB NAME, the resolved warehouse,
#    whether the batch ledger is on, and the full per-row plan
#    (COUNT / ADD / SUB / TARGET / LIVE / LOTS / DELTA / ACTION).
node scripts/migrations/fix-warehouse-stock-count-apply-all-2026-08-25.js

# 2) APPLY — only after reading the banner and the REFUSED section of the dry run.
node scripts/migrations/fix-warehouse-stock-count-apply-all-2026-08-25.js --apply --actor=<adminId>
```

Options:

```bash
--csv=/path/to/sheet.csv   # a different / re-exported count sheet
--actor=<adminId>          # or SEED_ACTOR_ID; REQUIRED for --apply
--yes                      # skip the interactive prompt (NOT on a prod-looking target)
```

`--actor` must be a real, existing admin — an unattributed manual adjustment is
not an audit trail. On a **production-looking** DB name or host, `--apply`
requires typing the **exact database name** and `--yes` does not bypass it.

---

## Expected results

- ✅ Dry run prints the banner with the real `DB HOST` / `DB NAME`, resolves the
  warehouse **by name** (`Chhapra - Warehouse`), and reports
  `batch ledger: ENABLED` plus the lot name adds will land in (`SC-20260825`).
- ✅ `PLAN` block totals ADD + REMOVE + NOOP + REFUSED + MALFORMED = **83**.
- ✅ `MALFORMED: 0`, `REFUSED — negative target: 6` (the six barcodes above).
- ✅ A boxed **"REFUSED — NOT WRITTEN, AND NOT CLAMPED"** section lists them with
  the reason on a `↳` line.
- ✅ `--apply` reports `quantity CHANGED` = the ADD + REMOVE count and writes
  exactly that many `MANUAL_ADJUST` rows in `stock-movements` with
  `reason: "physical_stock_take_reconciliation_2026-08-25"`.
- ✅ After `--apply`, `warehouse-stocks.availableQty` equals `Target` for every
  applied barcode — the script asserts this **inside** the transaction and rolls
  that sku back if the roll-up doesn't land on the target.
- ✅ Batch integrity holds: for every applied sku,
  `availableQty == Σ(open warehouse-batches.qtyRemaining)`. Verify with
  `WarehouseBatchRepository.reconcileWarehouse(<warehouseId>)` or the nightly
  `inventory-batch-reconcile` — `drifted` should not contain any touched sku.
- ✅ Adds appear as a `SC-YYYYMMDD` batch with `source: "MANUAL"`,
  `expiresAt: null`, `costPrice` = the sku's prior cost.
- ✅ Removals consumed the **earliest-expiry** lots first; the ledger row's
  `batchNo` lists the lots that gave up units (`A|B` when it spanned two).
- ✅ **Re-run `--apply`**: every previously-applied row reads `confirmed` with
  `delta 0` and **no second write, no second ledger row** (the target is
  absolute, so idempotence is structural).
- ❌ Wrong database → aborts with "no warehouse … Wrong database?".
- ❌ Warehouse renamed → aborts on the name assertion.
- ❌ `--apply` without `--actor` → aborts **before** connecting.
- ❌ `--actor` that isn't a real admin → aborts before any write.
- ❌ A barcode with no `warehouse-stocks` row → that row alone reads
  `REFUSED-no-stock-row`; every other row still processes.
- ❌ A removal bigger than the open lots hold → `REFUSED-insufficient-batches`,
  that sku untouched, run continues.
- ❌ Running the superseded `fix-warehouse-stock-count-all-2026-08-25.js --apply`
  → hard abort pointing at this script.

## Edge cases

- **Someone sells/transfers a SKU between the dry run and the apply** — the
  write path re-reads the live value and the lots inside the transaction, so it
  still lands on `Target`; it never acts on the printed plan's numbers.
- **A sku whose roll-up disagrees with its lots** — the lot sum wins, the row
  prints `PRE-EXISTING DRIFT`, and the run leaves the roll-up on `Target`.
- **A sku with stock but no batch rows** (pre-batch data) — a `LEGACY` lot is
  seeded first, in the same transaction.
- **Someone adds a column to the sheet** — columns are resolved by **header
  name**, not position, so the numbers cannot silently shift. `DB Stock` and
  `Diff` are now optional; the sheet parses without them.
- **A duplicate barcode in the sheet** — MALFORMED, never applied: two targets
  for one shelf and no way to know which count is later.
- **`Diff` disagrees with `DB Stock − Stock`** — a printed note only. That
  comparison is stale and no longer decides anything.

## Deploy

None. This is a manually-run script, not an API/app change — nothing to deploy,
no client follow-up.
