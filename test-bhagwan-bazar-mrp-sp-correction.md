# Test guide — Bhagwan Bazar MRP + selling-price correction

One-off data-correction migration for the **167 active Bhagwan Bazar items whose
`sellingPrice` was missing or 0**. Those 167 were exported as a worklist, the
shop team filled in a price for each one by hand (some as a *discount % off MRP*,
some as a *direct selling price*), and also corrected a few wrong/zero MRPs.
This migration applies that filled-in sheet.

**Scripts**
- `haper-backend/scripts/migrations/backfill-bhagwan-bazar-mrp-sp.js` — real run (dry-run by default, `--apply` to write)
- `haper-backend/scripts/migrations/simulate-bhagwan-bazar-mrp-sp.js` — offline simulator, **NO database**
- `haper-backend/scripts/migrations/bhagwan-bazar-mrp-sp.core.js` — the shared diff engine both use

**Source CSV** (hand-filled sheet): `/Users/office/Documents/haper/Bhagwan bazar no selling price - Sheet1.csv`
**Bundled copy used by default** (portable, travels with the repo):
`haper-backend/scripts/migrations/data/bhagwan_bazar_no_selling_price.csv` — a
byte-faithful copy of the sheet. Columns: `name, brand, category, mrp, barcode,
iId, Discount % to MRP, Tags, Selling Price`.

> This is a **separate** migration from `test-csv-catalog-corrections.md`
> (brand/tags/name, catalog-wide). That one deliberately never touched MRP. This
> one owns MRP + sellingPrice for these 167 iIds and never touches
> brand/tags/name. Run them in either order; they write disjoint fields.

## What it changes (and what it must not)

| Field | Where | Rule |
|---|---|---|
| `price` (MRP) | `items` for **Haper - Bhagwan Bazar only** | write the sheet's `mrp` when it is **> 0** and differs from what is stored. Sheet cell blank or `0` → **MRP write skipped entirely**, stored value kept |
| `sellingPrice` | `items` for **Haper - Bhagwan Bazar only** | `Selling Price` filled → `roundRupee(that value)`. Else `Discount % to MRP` filled → `roundRupee(effMrp − effMrp × pct / 100)`. Else → untouched |

Never touched: `brand`, `tags`, `name`, `barcode`, `category`, `subCategory`,
`costPrice`, `quantity`, **every other store**, and the whole `products`
collection (MRP/selling price are per-store `items` fields — `products` has no
price field at all).

### effectiveMrp — what the selling-price maths runs against

`effectiveMrp = sheet mrp (if > 0) → else a KNOWN_MRP_OVERRIDES entry → else the stored items.price`

The **sheet** value and a **KNOWN_MRP_OVERRIDES** value are both written back to
`price` (an override entry is human-confirmed source data — see below). The
*stored price* fallback is never written back to itself. The fallbacks exist so a
row whose MRP cell was left blank still prices off a real MRP instead of off zero.

### Whole rupee, round-half-up

Same `roundRupee()` convention as the earlier catalog migration (copied, not
imported, so this migration is self-contained): `93.1 → 93`, `93.5 → 94`,
`94.5 → 95`. ❌ Fails if any `sp: … → 151.05`-style decimal appears in the report.

### Zero/blank-source guard

A blank or `0` MRP cell means *"no correction supplied"*, never *"set the MRP to
zero"*. Such rows are listed under **"rows whose sheet MRP was blank or 0 → no
MRP taken from sheet"**, and the stored price is kept (unless a confirmed
KNOWN_MRP_OVERRIDES entry supplies one). ❌ Fails if the report's
`invariant OK: no update writes a zero/negative price` line is ever non-zero.

### Sanity guard — selling price above MRP

If the computed sp is **greater than** effectiveMrp it is a data-entry error. It
is **not written** and **not clamped** — it is printed under
`❗ ANOMALY — sp above MRP, NOT written` for a human to fix in the sheet.

### The Kissan Peanut Butter special case (BI512871) — RESOLVED 2026-08-10

The sheet shows `mrp = 0` with `Discount % to MRP = 5` — the MRP cell was cleared
by accident while the discount was being typed. The stored `items.price` in the
fresh prod export is **also 0** (that item doc was recreated on 2026-08-09 with
zeroed prices). So there was **no valid MRP anywhere**, in the sheet or in the DB.

**The user explicitly confirmed on 2026-08-10 that the real MRP is 165** ("keep it
165"). That makes 165 *confirmed source data* — the same confidence as if the
sheet cell had said 165 — so this row is now treated like any other row in the
batch.

The value lives in `KNOWN_MRP_OVERRIDES` in the core module: the only place a
value that is in neither the sheet nor the DB may enter this migration. Each entry
carries `source` (who confirmed it, when) and `note` (why it was needed), and the
dry run prints a **PROVENANCE** line for it so a future reader can see this one
number came from a person, not from the sheet or the database.

> The source CSV in the repo is **not** edited to 165 — it stays byte-faithful to
> the hand-filled sheet (`mrp = 0`). Data problems get fixed in code, with an
> audit note; never by quietly editing the copy of the source.

✅ Expected with a plain `--apply` (no extra flag):
- `price: 0 → 165` — tagged `[via KNOWN_MRP_OVERRIDES]` in the report
- `sp: 0 → 157` with source `discount 5% of 165 (override)`

There is **no** `--apply-mrp-overrides` flag any more. It existed only while 165
was still an assumption; keeping it would make the migration's result depend on
how it was invoked.

## How to test

### 1. Offline simulator first (no DB, safe anywhere)

```
cd haper-backend
node scripts/migrations/simulate-bhagwan-bazar-mrp-sp.js --sample=15
```

Needs `/tmp/items.jsonl` and `/tmp/stores.jsonl` (bsondump of a prod/dev export,
one extended-JSON doc per line); override with `--items=` / `--stores=`.

✅ Expected against the 2026-08-10 prod export:

```
loaded   : 167 Bhagwan Bazar item doc(s) for 167 CSV row(s)
MRP (price)  updates : 4          (BI552142 0→350, BI882147 0→400, BI672150 0→500,
                                   BI512871 0→165 via KNOWN_MRP_OVERRIDES)
sellingPrice updates : 167
TOTAL field writes   : 171
TOTAL doc writes     : 167
rows whose sheet MRP was blank or 0 → no MRP taken from sheet : 1   (BI512871)
KNOWN_MRP_OVERRIDES that kicked in                        : 1   (BI512871 → 165)
❗ ANOMALY — sp above MRP, NOT written                     : 0
rows with NO sp source                                    : 0
CSV iIds with items but none at Bhagwan Bazar             : 0
invariant OK: no update writes a zero/negative price      : 0
idempotency check → remaining MRP 0 / sp 0  ✅
```

Split of the 167 selling prices: **15 direct** `Selling Price` values, **152**
computed from `Discount % to MRP`. 125 of the computed ones had paise and were
rounded to a whole rupee.

❌ Fails if: any row reports "no items doc", the anomaly count is non-zero, any
`to` value has decimals, or the idempotency check does not come back 0/0.

### 2. Dry run against the real DB

```
cd haper-backend
node scripts/migrations/backfill-bhagwan-bazar-mrp-sp.js
```

✅ The banner must show **DRY RUN**, the **DB HOST** and **DB NAME** it resolved,
and a ⚠️ line if either matches `/prod/i`. Read those two lines before anything
else. It must resolve the store **by name** (`Haper - Bhagwan Bazar`) and abort
loudly if it finds 0 or more than 1 match — never a hardcoded store id.
The counts should match the simulator (allowing for real drift since the export).

❌ Fails if it writes anything, or if it prints a store id without having matched
exactly one store by name.

### 3. Apply

```
node scripts/migrations/backfill-bhagwan-bazar-mrp-sp.js --apply
```

Prompts for a typed `yes` (skip with `--yes`), writes one `$set` per item doc in
batches of 500, then **re-reads and re-diffs**:

✅ `Verification re-diff: 0 remaining difference(s) ✅` and exit code 0.
❌ Any non-zero remainder exits 1 — investigate, do not re-run blindly.

### 4. Idempotency / re-runnability

```
node scripts/migrations/backfill-bhagwan-bazar-mrp-sp.js        # after the apply
```

✅ `Nothing to do — Bhagwan Bazar already matches the sheet.` Every write is an
absolute `$set` of the target value and only differing docs are selected, so a
half-finished run can simply be re-run — it resumes and never double-applies.

## Edge cases covered

| Case | Expected |
|---|---|
| Sheet `mrp` blank or 0 | no MRP taken from the sheet; stored price kept; listed in the report |
| Sheet `mrp` blank/0 **and** a confirmed `KNOWN_MRP_OVERRIDES` entry exists | the confirmed MRP is written to `price` and drives the sp maths; PROVENANCE line printed (BI512871: `price 0 → 165`, `sp 0 → 157`) |
| Sheet `mrp` > 0 and equal to stored price | no write (no-op skipped) |
| Both `Selling Price` and `Discount %` filled | direct `Selling Price` wins |
| Neither filled | row's sellingPrice untouched, listed under "NO sp source" |
| Computed sp > effectiveMrp | **not written**, flagged as an anomaly |
| Discount given but no usable MRP anywhere | sp skipped, listed separately |
| Direct sp with no MRP to check against | written, but listed as "unverifiable" |
| Discount outside 0–100, or non-numeric cell | listed under "unparseable", nothing written |
| iId not stocked at Bhagwan Bazar | reported, nothing written |
| Duplicate iId in the sheet | first row wins, the rest are reported as skipped lines |
| Re-run after apply | 0 changes |

## App-side sanity check after applying

Open the Bhagwan Bazar catalog in admin and in the customer app:
✅ these 167 items now show a price and become buyable (an item with
`sellingPrice = 0` was effectively unsellable).
✅ the discount badge (MRP struck through vs selling price) reads sensibly — no
item should be left with `sellingPrice > 0` but `price = 0`. Spot-check BI512871
(Kissan Crunchy Peanut Butter - 350 g): it must read **MRP ₹165 / ₹157**.
