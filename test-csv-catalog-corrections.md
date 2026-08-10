# Test guide — CSV catalog corrections (brand / tags / name / selling price)

One-off data-correction migration that applies a corrected CSV export of the
Bhagwan Bazar catalog to the database.

**Scripts**
- `haper-backend/scripts/migrations/backfill-csv-catalog-corrections.js` — real run (dry-run by default, `--apply` to write)
- `haper-backend/scripts/migrations/simulate-csv-catalog-corrections.js` — offline simulator, NO database
- `haper-backend/scripts/migrations/csv-catalog-corrections.core.js` — the shared diff engine both use

**Source CSV**: `/Users/office/Documents/haper/Copy of bhagwan_bazar_active_items.xlsx - bhagwan_bazar_active_items.csv`

## What it changes (and what it must not)

| Field | Where | Rule |
|---|---|---|
| `brand` | `products` (1 doc per iId) + `items` (ALL stores) | plain trimmed string compare; overwrite with CSV value when different. **Blank CSV cell → skipped, never written** |
| `tags` | `products` + `items` (ALL stores) | same as brand (incl. the blank-cell skip) |
| `name` | `products` + `items` (ALL stores) | same as brand (incl. the blank-cell skip) — added 2026-08-09 |
| `sellingPrice` | `items` for **Haper - Bhagwan Bazar only** | blank `Discount % to MRP` → leave untouched. Otherwise `csvMrp − csvMrp × pct / 100` from the CSV's own `mrp`, **rounded to the nearest whole rupee (round-half-up)** — changed from 2dp on 2026-08-10 |

Never touched: `price` (MRP), `barcode`, `category`, `subCategory`,
`costPrice`, `quantity`. Known MRP mismatches are deliberately out of scope.

### Selling price is a WHOLE RUPEE (changed 2026-08-10)

`sellingPrice` used to be stored to 2 decimals (`93.1`, `9.5`, `28.5`). It is now
rounded to the nearest **whole rupee** using the normal convention — **0.5 and
above rounds up**, below 0.5 rounds down:

| mrp | disc | exact | stored sp |
|---|---|---|---|
| 98 | 5% | 93.1 | **93** (down) |
| 50 | 5% | 47.5 | **48** (up — exactly .5) |
| 10 | 5% | 9.5 | **10** (up — exactly .5) |
| 30 | 5% | 28.5 | **29** (up — exactly .5) |
| 15 | 15% | 12.75 | **13** (up) |
| 460 | 4% | 441.6 | **442** (up) |

Implemented as `roundRupee()` in the shared core (`Math.round(n + Number.EPSILON)`).
The old `round2()` still exists but is now used **only** to normalise the existing
stored value before comparing it (float noise), never to produce a new price — so
nothing else that rounds money is affected.

❌ Fails if the dry run prints any `sp: … → 93.1`-style value with decimals. Every
`to` value must be an integer.

### Blank-source guard — a blank CSV cell NEVER reaches the DB (added 2026-08-10)

For **brand, tags and name alike**: if the CSV cell is empty or whitespace-only,
that field is **skipped for that row** — no compare, no change record, no write.
The existing database value is left exactly as it was.

A blank in the correction sheet means *"no correction supplied"*, **not** *"erase
this field"*. Real example: CSV line 1080 (`BI961664`, Vatika Shampoo) has an
empty brand cell; the DB keeps `"Dabur"` instead of being blanked out. Same for
line 1468 (`BI762239`, Britannia Bourbon → keeps `"Britannia"`). Together those
2 rows span 6 docs (2 products + 4 items), which is why brand writes are 150 and
not 156.

The report prints these as
`CSV rows with a blank source cell, SKIPPED (no DB write) : 2 (brand=2, tags=0, name=0)`
plus an assertion line `invariant OK: no update blanks an existing value : 0`.
❌ If that invariant line ever prints `INVARIANT BROKEN`, stop — the guard has
regressed and the run would erase catalog data.

The guard lives in `computeChanges()` in the shared core, so the simulator, the
dry run and `--apply` all behave identically.

A doc whose brand + tags + name all changed is still **one** `updateOne` — the
per-field lists are collapsed by `buildDocUpdates()` in the shared core, so
"field writes" (5296) is larger than "doc writes" (4568). Both are printed.

**`name` is customer-visible.** Renaming an item changes what shoppers see in the
app and what the Atlas Search index `item_search` matches on (it re-indexes
automatically, but expect search results to shift). Past orders are safe: the
order schema snapshots `items[].name` at order time, so invoices/history do not
retro-change.

The Bhagwan Bazar store id is resolved **by name at runtime** (`StoreModel.find({ name: "Haper - Bhagwan Bazar" })`).
If 0 or >1 stores match, the script aborts instead of guessing.

## Steps

### ✅ 1. Offline simulation first (no DB)
```
cd haper-backend
node scripts/migrations/simulate-csv-catalog-corrections.js
```
Expected against the July/Aug prod dump exports (`/tmp/items.jsonl`, `/tmp/products.jsonl`, `/tmp/stores.jsonl`):
- CSV rows read: 1523
- CSV rows read: 1523
- brand updates 150 (products 50 + items 100) — was 156 before the blank-source guard
- tag updates 4568 (products 1523 + items 3045 — the CSV is a fully re-curated tag set)
- **name updates 378 (products 126 + items 252 — 126 distinct iIds renamed)**
- **sp updates 142** (was 200 under the old 2dp rule); 1305 rows have a blank
  discount and are left alone. The drop is expected: 58 rows whose 2dp price
  differed from the DB now round to a whole rupee that already equals the stored
  value (e.g. `BI22549` Maggi 35gm — mrp 7, 4% → 6.72 vs stored 7; whole-rupee
  gives 7, so nothing to write). Which rows are *eligible* did not change — only
  the computed value did.
- **blank source cells skipped: 2 (brand=2, tags=0, name=0)**
- **`invariant OK: no update blanks an existing value : 0`**
- TOTAL field writes 5238 (was 5296 when sp was 200) / TOTAL doc writes 4568
  (products 1523 + items 3045) — doc writes are unchanged because every sp doc is
  also a tag doc, so it is the same `updateOne` either way
- 0 rows with unusable discount/mrp, 0 missing product/item docs

❌ Fails if: any "no items doc in ANY store" rows appear (CSV drifted from catalog),
or the `INVARIANT BROKEN` line appears (the blank guard regressed), or the blank
skip count jumps sharply (CSV lost a column — a whole column of blanks would be
silently "no correction" for every row).

### ✅ 2. Dry run against the target DB
```
node scripts/migrations/backfill-csv-catalog-corrections.js
```
Check the banner box: MODE = DRY RUN, and **DB HOST / DB NAME are the DB you intend**.
A `/prod/i` host or name prints an extra ⚠️ line — stop and get explicit approval.
Numbers should match the simulation (modulo real drift since the dump).

### ✅ 3. Apply
```
node scripts/migrations/backfill-csv-catalog-corrections.js --apply
```
Type `yes` at the prompt (or pass `--yes`). After writing it re-reads and re-diffs:
`Verification re-diff: 0 remaining difference(s) ✅` must print, exit code 0.

### ✅ 4. Idempotency re-run
```
node scripts/migrations/backfill-csv-catalog-corrections.js
```
Must report `TOTAL field writes: 0` and `TOTAL doc writes  : 0`.
❌ Any non-zero number means a write did not stick.

The blank-source skip count stays at `2 (brand=2, tags=0, name=0)` on every run —
it is a *skip*, not a pending change, so it never converges to 0 and must not be
read as "work left to do". Proven offline: applying all 4568 `$set`s to in-memory
copies of the exports and re-running the diff gives 0 changes, and the 6
blank-brand docs still hold their original brand.

## Edge cases to eyeball before `--apply`

- **Blank source cells (no longer a risk — guarded)**: 2 CSV rows have an empty
  brand cell (`BI961664` Vatika, `BI762239` Britannia Bourbon). They used to
  produce 6 doc updates blanking the DB brand; since 2026-08-10 they are
  **skipped** and the DB keeps `"Dabur"` / `"Britannia"`. Verified in this CSV:
  blank brand = 2, blank tags = 0, blank name = 0. If a blank `name` ever appears
  it is likewise skipped — a blank product name would break the app UI, so the
  guard protects that too. Filling those CSV cells in and re-running is the way
  to actually correct them.
- **Case-only differences**: 24 doc updates differ only in letter case
  (`BIKANO` → `Bikano`, `CADBURY` → `Cadbury`). Correct per the plain-compare rule.
  Case-only `name` diffs: 0.
- **Name rewrites worth a human read** — the CSV is authoritative but it does
  contain typos and inconsistent styling. Real examples from the current file:
  `Cadbury Silk Bubbly - 46gm` → `Cadbury Dairy Mil Silk Bubbly - 46gm` ("Mil"),
  `Celebrations - 51.2g` → `Cadbury Celebrations - MRP 50` (weight → MRP),
  `KitKat Chocolate Bar - 12gm` → `Kit kat Chocolate - 12gm`. Skim the NAME
  samples in the dry run and fix the CSV rather than the DB if any look wrong.
- **Exactly-.5 selling prices**: 41 CSV rows compute to an exact `.5` (e.g.
  `BI26511` 50 × 5% → 47.5, `BI65515` 10 × 5% → 9.5, `BI94539` 30 × 5% → 28.5).
  These all round **UP** (48, 10, 29). Eyeball a couple of them in the dry run —
  they are the cases where a half-down convention would have given a different
  answer, so they are the fastest way to confirm the rule is applied.
- **No fractional selling prices any more**: every sp written is a whole rupee.
  A decimal appearing in the sp samples means the rounding regressed.
- **Discount format**: `5`, `5%`, `" 5 "` all parse. Values outside 0–100 or
  non-numeric are skipped and listed under "unusable discount/mrp".
- Duplicate or blank `iId` rows in the CSV are skipped and printed by line number.

## Deploy

No app code changes — script only. Nothing to deploy; run it manually against the
intended DB after the dry run is reviewed.
