# Runbook: Backfill stock-movement costPrice for legacy warehouse receipts

## What this script does

The script fills in the missing `costPrice` value on warehouse goods-receipt records created before 5 August 2026, when the cost-tracking feature was added to the schema. It works by copying the cost from each item's current stock batch — **but only when that batch has never been restocked a second time at a different price**, so the recovered number is guaranteed to be the real original price from the invoice, not a blended average.

For each eligible row, the script looks up the corresponding `warehouse-batches` doc (keyed by warehouseId, SKU, and batchNo) and uses its `costPrice` field.

## What it does NOT do

- **Does not touch MRP:** `warehouse-batches` records have no MRP field at all (cost, expiry, qty, status, supplier only). There is no reliable historical source for old receipt MRPs, so rows missing MRP are left exactly as they are. A wrong MRP in an append-only ledger is worse than missing data.
- **Does not touch quantities or invoices:** `quantityDelta`, `refLabel`, and all other fields remain untouched.
- **Does not rewrite already-fixed rows:** If a row already has a `costPrice` value, the script ignores it. This makes the script idempotent and safe to re-run.
- **Does not touch corrected or unsafe batches:** The script skips any batch that was topped up more than once (blended cost, unsafe to assume it matches the original invoice), or any batch that was manually corrected at some point (cost may have been re-anchored). These rows must be reviewed against the paper invoice if recovery is needed.

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

## Important: Do NOT pass `--yes` for the production run

The `--yes` flag exists for automation and testing only. For any real production run against a live database:

- **Do NOT use `--yes`.** The typed confirmation prompt (`type "yes"`) is a deliberate safety check to ensure a human has reviewed the database target and the rows to be affected.
- Always read the dry-run output and the confirmation prompt carefully before proceeding.

## Idempotency

The script is safe to re-run at any time. A second run touches only rows that still have the `costPrice` key missing; it never overwrites an already-backfilled value. If you interrupt the script mid-run, you can simply re-run the same command to resume.

## Expected results (current dataset)

Based on the last dry-run test against the current production data:

- **296 rows** will have their `costPrice` filled in automatically (single-receipt batches, safe to copy from warehouse-batches).
- **12 rows** are skipped because the batch was restocked more than once (blended cost, unsafe).
- **10 rows** are skipped because the batch was manually corrected at some point (cost may have been re-anchored).
- **64 rows** have no batch record to copy from at all (very old, pre-batch-tracking receipts).

The 12 + 10 + 64 = 86 skipped rows are unaffected by this script and would need the paper invoice checked by hand if you want them filled in too.

## After the run

Once the script completes successfully:
1. The warehouse goods-receipt ledger now has cost tracking for 296 additional historical rows.
2. Reports and analytics that depend on cost-per-unit (e.g. profit-and-loss, COGS tracking) will include these receipts in their calculations.
3. The skipped rows remain unchanged; they can be addressed in a follow-up manual process if needed.

## Troubleshooting

**Script says "ABORT: no mongoDbUri configured."**
- The script reads from `config.mongoDbUri`, which comes from `.env` (loaded by `dotenv`). Make sure you are in the `haper-backend` directory and `.env` is present with a valid MongoDB connection string.

**Prompt shows a production database name/host.**
- STOP. Do not type `yes`. Exit the script (Ctrl+C). Verify you have the correct `.env` loaded for the target environment (dev vs prod). Re-run the dry run to confirm the correct database before proceeding.

**Verification fails with "do NOT hold the expected costPrice."**
- This is very rare (indicates a MongoDB write failure or a concurrent edit). The script exits with a non-zero status. Check the database logs and re-run to retry the failed rows.
