# Runbook: Backfill stock-movement costPrice for legacy warehouse receipts

## What this script does

The script fills in the missing `costPrice` value on warehouse goods-receipt records created before 5 August 2026, when the cost-tracking feature was added to the schema. It works by copying the cost from each item's current stock batch — **but only when that batch has never been restocked a second time at a different price**, so the recovered number is guaranteed to be the real original price from the invoice, not a blended average.

For each eligible row, the script looks up the corresponding `warehouse-batches` doc (keyed by warehouseId, SKU, and batchNo) and uses its `costPrice` field.

## What it does NOT do

- **Does not touch MRP:** `warehouse-batches` records have no MRP field at all (cost, expiry, qty, status, supplier only). There is no reliable historical source for old receipt MRPs, so rows missing MRP are left exactly as they are. A wrong MRP in an append-only ledger is worse than missing data.
- **Does not touch quantities or invoices:** `quantityDelta`, `refLabel`, and all other fields remain untouched.
- **Does not rewrite already-fixed rows:** If a row already has a `costPrice` value, the script ignores it. This makes the script idempotent and safe to re-run.
- **Does not touch corrected or unsafe batches:** The script skips any batch that was topped up more than once (blended cost, unsafe to assume it matches the original invoice), or any batch that was manually corrected at some point (cost may have been re-anchored). These rows must be reviewed against the paper invoice if recovery is needed. *(If you want a best-effort estimate in these rows instead, see the opt-in `--include-approximate` flag below — it is off by default.)*

## Run steps

### Step 1: Dry run — inspect what would be changed

```bash
cd /Users/office/Documents/haper/haper-backend
node scripts/migrations/backfill-stock-movement-cost-mrp.js
```

**What to check in the output:**
1. The banner at the top displays **DB HOST** and **DB NAME**. Verify these match the database you intend to update (usually a dev database). If it shows production, STOP — do not proceed without explicit approval.
2. The script prints the number of rows that will be backfilled.
3. Read the **"Skipped"** sections carefully:
   - **multi-receipt batches** (batch received more than once): blended cost, no invoice source. These rows need a manual invoice check if you want them filled in.
   - **corrected batches**: touched by a receipt correction. Cost may have been re-anchored; paper invoice check needed.
   - **no matching warehouse-batches doc**: no batch record exists to copy from (very old, pre-batch-tracking receipts). Paper invoice check needed.

### Step 2: Review and confirm the batch

Once satisfied with the dry-run output, proceed to the apply step. The script will show the target database again and require you to type `yes` to confirm before any writes happen.

```bash
node scripts/migrations/backfill-stock-movement-cost-mrp.js --apply
```

The script will:
1. Display the target database name and host again.
2. Prompt: `Write costPrice to <N> row(s) in "<dbName>" on <host>? (type "yes"):`
3. You must type **exactly `yes`** (lowercase) and press Enter.
4. If you type anything else or press Ctrl+C, the script aborts with no changes written.

### Step 3: Verify the write

After the script completes, it prints a verification check: `Verification: all <N> row(s) hold the exact expected costPrice ✅`

This confirms that every intended row was written correctly. If you see an error message instead, the script reports details on which rows failed and why.

## Optional: `--include-approximate` (opt-in, best-effort — NOT the safe default)

By default the script refuses two groups of rows because the recovered number is not
guaranteed to match the original invoice:

- **blended / multi-receipt** — the batch was topped up more than once, so its cost is a weighted average;
- **corrected** — someone edited the batch later through the admin UI, so its cost may have been re-anchored.

If you would rather have an *estimate* in those rows than nothing at all, pass the flag:

```bash
node scripts/migrations/backfill-stock-movement-cost-mrp.js --include-approximate           # dry run
node scripts/migrations/backfill-stock-movement-cost-mrp.js --include-approximate --apply   # writes
```

**Real example.** Batch `AUTO-EXP-20270201` for SKU `8901058017687` was received twice.
The warehouse batch today says `costPrice = 13.46`, which is the average of the two
deliveries. The first delivery's real invoice price might have been 13.10 and the second
13.82 — we cannot tell. With the flag on, both ledger rows get 13.46. It is close, and it
is useful for a rough COGS number, but it is **not** the number on the paper bill.

What the flag does and does not change:

- It **only** rescues the blended and corrected rows. Rows with no batch number, or whose
  batch record no longer exists, are still left completely untouched — there is genuinely
  nothing to copy from.
- **MRP is still never written.** The flag has no effect on MRP at all.
- Dry-run-first, `--apply`-to-write, and the typed `yes` confirmation all still apply.
- The confirmation prompt spells out the split, e.g.
  `Write costPrice to 0 EXACT + 16 APPROXIMATE row(s) in "<db>" on <host>? (type "yes"):`
  so you cannot miss that estimated values are about to be written.
- **`--yes` is ignored when this flag is on.** Approximate values are non-provable money
  data, so a human must type `yes` no matter how the script was launched.

### How to tell an estimate apart afterwards

Every approximately-filled row gets a marker appended to its `note` field. Rows filled in
under the strict rule are never tagged. So: tagged = estimate, untagged = exact.

```js
db.getCollection("stock-movements").find({ note: /costPrice backfilled APPROX/ })
```

The dry run also prints every approximate row in full (never sampled) under a separate
**"APPROXIMATE backfill"** heading, split by reason. Keep that run log — together with the
note tag it is the audit trail for these rows.

## Important: Do NOT pass `--yes` for the production run

The `--yes` flag exists for automation and testing only. For any real production run against a live database:

- **Do NOT use `--yes`.** The typed confirmation prompt (`type "yes"`) is a deliberate safety check to ensure a human has reviewed the database target and the rows to be affected.
- Always read the dry-run output and the confirmation prompt carefully before proceeding.

## Idempotency

The script is safe to re-run at any time. A second run touches only rows that still have the `costPrice` key missing; it never overwrites an already-backfilled value. If you interrupt the script mid-run, you can simply re-run the same command to resume.

## Expected results (current dataset)

Measured by replaying the local production dump (`prod-dump/haper-prod`) into an in-memory
MongoDB. Of 902 `PURCHASE_IN` rows, **86** are missing `costPrice` and 378 are missing MRP.

**Default (strict) run — 86 missing rows:**

| Outcome | Rows |
| --- | --- |
| filled in automatically (single-receipt batch, provably the invoiced cost) | **0** |
| skipped — batch restocked more than once (blended cost) | **12** |
| skipped — batch manually corrected at some point | **10** |
| skipped — no batch record to copy from at all | **64** (56 with no batch number + 8 with no batch record) |

> **Note on an earlier figure.** A previous version of this runbook said 296 rows would be
> filled in. That number could not be reproduced and is inconsistent with its own totals
> (296 filled + 86 skipped implies 382 missing rows; the dump has 86). Treat the table
> above as the current measurement, and re-run the dry run against the real target database
> before the actual run — the dry run always prints the true counts for that database.

**With `--include-approximate` — same 86 rows, re-split:**

| Outcome | Rows |
| --- | --- |
| filled in — EXACT | **0** |
| filled in — APPROXIMATE | **16** (12 blended + 4 corrected) |
| still untouched — nothing to copy from | **70** (56 no batch number + 14 no batch record) |

The flag rescues 16 of the 22 previously-skipped unsafe rows. The other 6 are corrected
rows whose batch was **renamed** by the correction (they still point at the old name
`AUTO-RCV-20260801`, and no batch record exists under that name any more), so there is no
cost to copy and they stay untouched — which is the intended behaviour.

In both modes the 378 rows missing MRP are left exactly as they are.

Any row still left over needs the paper invoice checked by hand.

## After the run

Once the script completes successfully:
1. The warehouse goods-receipt ledger now has cost tracking for the rows the dry run listed.
2. Reports and analytics that depend on cost-per-unit (e.g. profit-and-loss, COGS tracking) will include these receipts in their calculations.
3. The skipped rows remain unchanged; they can be addressed in a follow-up manual process if needed.

## Troubleshooting

**Script says "ABORT: no mongoDbUri configured."**
- The script reads from `config.mongoDbUri`, which comes from `.env` (loaded by `dotenv`). Make sure you are in the `haper-backend` directory and `.env` is present with a valid MongoDB connection string.

**Prompt shows a production database name/host.**
- STOP. Do not type `yes`. Exit the script (Ctrl+C). Verify you have the correct `.env` loaded for the target environment (dev vs prod). Re-run the dry run to confirm the correct database before proceeding.

**Verification fails with "do NOT hold the expected costPrice."**
- This is very rare (indicates a MongoDB write failure or a concurrent edit). The script exits with a non-zero status. Check the database logs and re-run to retry the failed rows.

---

# Follow-up script: the rows with NO batch number

`scripts/migrations/backfill-stock-movement-cost-nobatch.js`

## Why a second script

The script above can only work when the receipt row carries a **batch number** — that is
the key it uses to find the batch record holding the cost. Roughly 71 old receipt rows on
production have **no batch number at all** (they were written before batch auto-naming
existed), so the first script deliberately lists them under *"no batchNo"* and leaves them
alone. This second script exists only for that leftover group.

The two scripts never overlap: the first one skips every row without a batch number, this
one selects **only** rows without a batch number. Neither can pick up a row the other one
already filled in (both require the `costPrice` key to be missing).

## Where the cost comes from

With no batch to read, the cost is taken from another collection, in a fixed order:

1. **`warehouse-stocks.costPrice` for the exact warehouse + SKU on the row.** This is the
   warehouse's own recorded cost for that product — the most specific source, and there is
   only ever one such record, so there is no choice to make.
2. **Otherwise `items.costPrice` (the store-level record) — but only if every matching
   store record agrees on one price.** Real example: SKU `8902102163923` (Exo Bar) shows
   `3.61` in one store and `3.68` in another. Nothing in the data says which one was on
   this bill, so that row is **skipped as "ambiguous — needs manual review"**. The script
   never picks the newest/cheapest/first one.
3. **Neither source has a usable price → skipped as "no recoverable cost found."** A cost
   of `0` counts as "never priced", not as a real price of zero.

## How to tell these rows apart afterwards

Every row written by this script is tagged in its `note` field with the source it came
from (any existing note text is kept, the tag is appended after ` | `):

```
... | costPrice backfilled from warehouse-stocks (no batch, pre-2026-08-05 receipt)
... | costPrice backfilled from items.costPrice (no batch, pre-2026-08-05 receipt)
```

```js
db.getCollection("stock-movements").find({ note: /costPrice backfilled from/ })
```

That is a **different** marker from the first script's `costPrice backfilled APPROX`, so
the two backfills never blur together in an audit. These values are the current recorded
cost for the SKU — the best evidence available, but **not** provably the price typed on
the original bill. Keep the run log.

## Run steps

```bash
cd /Users/office/Documents/haper/haper-backend

# 1) DRY RUN — writes nothing, prints every row it would change and its source
node scripts/migrations/backfill-stock-movement-cost-nobatch.js

# 2) APPLY — after reading the dry run; prompts for a typed "yes"
node scripts/migrations/backfill-stock-movement-cost-nobatch.js --apply
```

The connection comes from `MONGO_DB` in your own `.env`, exactly like every other
migration script. The banner prints **DB HOST** and **DB NAME** before anything happens —
read them. If that is not the database you meant, Ctrl+C.

There is **no `--yes` bypass on this script at all**: every value it writes is inferred
from another collection, so a human types `yes` every time.

## Reading the output

- Rows that would be written are listed **in full** (never sampled), with the value and the
  source: `costPrice=3.68  [source: warehouse-stocks]`.
- Ambiguous rows are listed in full too, with the competing values, e.g.
  `items.costPrice disagrees across 2 item record(s): [3.61, 3.68]` — that list is the
  manual-review to-do.
- A **BY INVOICE (refLabel)** table closes the report so you can see exactly what happened
  to each bill:

```
  refLabel              total  wh-stock  items  ambig  unrecov  other
  6834                  44     30        8      4      2        0
  (null ref)            11     6         3      1      1        0
  6849                  10     7         2      1      0        0
  6912                  5      3         1      0      1        0
  INV-2607-N02247       1      1         0      0      0        0
```

(the numbers above are from a synthetic fixture used in testing — the real counts come from
your own dry run.)

## What it does NOT do

- **Never touches MRP** — same reasoning as the first script.
- **Never touches rows that have a batch number** — those belong to the first script.
- **Never overwrites an existing cost**, so it is idempotent and safe to re-run; a second
  run reports 0 rows and cannot append the note marker twice.
- **Never guesses** between competing prices — an ambiguous row stays untouched.
- **Does not update the Verify Bill screen's provenance labeling.** After `--apply`, the
  Warehouse "Verify Bill" page for these invoices will show a full "Total cost (billed)"
  figure with no "(N lines missing cost)" warning anymore — but there is no visual cue on
  that screen that the number came from this backfill rather than the original receipt. The
  only way to tell is querying the `note` field for the tag `"costPrice backfilled from"`.

## ✅ / ❌ checks

- ✅ Dry run makes zero writes and lists every candidate row.
- ✅ A row whose warehouse has a cost for that SKU is filled from `warehouse-stocks`.
- ✅ A row with no warehouse cost but one agreed store cost is filled from `items.costPrice`.
- ❌ A row with two different store costs is **not** filled — it appears under AMBIGUOUS.
- ❌ A row with no cost anywhere is **not** filled — it appears under "no recoverable cost".
- ✅ Re-running after an apply reports 0 rows and changes nothing.
- ✅ `mrp` is untouched in every case.

Automated coverage:
`packages/admin/__tests__/backfill-stock-movement-cost-nobatch.test.js` (in-memory Mongo).
