# Test: Retailer (wholesale) program — pack operations (picking, ops jobs, refusals, index script)

**Plan:** `haper-backend/docs/plans/retailer-wholesale.md` (rev 2, §3.4.4-§3.4.6, §4.2, §6 steps 18-20). Builds on `test-retailer-wholesale-packs.md` (pack create/assign) and `test-retailer-wholesale-packs-sell.md` (sell/restock).
**Backend files:**
- Picking: `packages/shared/utils/pick-task.utils.js` (`buildLines`), `packages/shared/models/pick-tasks.schema.js`, `packages/picking/src/routes/task/{controller,validator}.js`
- Ops: `packages/cron/src/jobs/auto-replenishment.js`, `packages/cron/src/jobs/inventory-batch-reconcile.js`, `packages/shared/repositories/inventory-group.repository.js` (feeds the evaluator, daily digest and stock alerts)
- Refusals: `packages/admin/src/routes/items/controller.js`, `.../transfer/controller.js`, `.../replenishment/controller.js`, `.../pos/controller.js`
- Script: `scripts/migrations/build-wholesale-indexes.js` (+ README step 17)

**Branch:** `dev` (direct-to-dev workflow).
**Needs before going live:** the order-edit lane carries `packOf` into the line it hands to the restock, so a short pick or OOS on a pack line runs the real restock end to end (a damaged pack line with no snapshot at all is refused with 500 and nothing changes, on purpose). Keep `wholesaleEnabled` OFF until the new picker build (P1 gate) is in.

## What this is (a real example)

"Glucose Biscuit 70 g" sits on shelf **R2-S4**, barcode `8900012345` (fictional). The store also sells **"Pack of 10"** of it to retailers. The pack has no shelf and no stock of its own: 40 singles on the shelf means the pack shows 4.

An order has **3 × Pack of 10** and **4 singles** of the same biscuit. The picker sees two lines:

| Line | Shows | Scan | Takes from |
|---|---|---|---|
| Pack of 10 × 3 | "= 10 pcs" each (new app) | `8900012345` (the base barcode) | shelf R2-S4 |
| Glucose Biscuit × 4 | as today | `8900012345` | shelf R2-S4 |

## Pick-line fields the picker app reads

Every task line keeps today's fields unchanged (`requiredQty` and `pickedQty` are in **packs** for a pack line). Three new nullable fields:

| Field | Pack line | Any other line / old tasks |
|---|---|---|
| `unitsPerPack` | e.g. `10` | `null` (or absent on tasks created before this deploy) |
| `baseItemId` | the base item's id | `null` / absent |
| `baseName` | e.g. "Glucose Biscuit 70 g" | `null` / absent |

On a pack line `barcode` = the pack's own carton barcode if it has one, otherwise the base barcode; `location` = the base shelf; `image` = pack image, else the base image.

Optional request field **`looseUnitsFound`** (whole number, 0 or more) on `POST /picking/task/:id/line/:itemId/pick` (short pick only) and `.../oos`: how many loose singles of the base are still on the shelf after picking. Old apps don't send it.

## Walkthrough

### A. Pick line snapshot
1. ✅ Place the example order (pack + singles of the same base) in a picking-enabled store. Open the task (`GET /picking/task/:id`). Pack line: `requiredQty: 3`, `unitsPerPack: 10`, `baseName` set, `barcode` = base barcode, `location` = `R2-S4`.
2. ✅ The singles line: same as before, the three new fields `null`.
3. ✅ Give the pack a carton barcode (`8900012399`) and place a new order: the pack line's `barcode` is the carton code.
4. ✅ An order with no packs: task lines look exactly as before (plus the three `null` fields).

### B. Short pick on a pack line (only 2 of 3 packs found)
5. ✅ Old app (no `looseUnitsFound`): order line drops to 2 packs, customer refunded/adjusted for 1 pack, **the base** goes to 0 on the books, the pack row is never written directly (its number follows the base).
6. ✅ New app sends `looseUnitsFound: 7` while the 4-singles line is still unpicked: base becomes **3** (7 loose minus the 4 already sold to the singles line still on the shelf).
7. ✅ Same, but the singles line was picked first: base becomes **7**.
7a. ✅ Another customer's order in the same store owes **5 singles** of the base and is not picked yet. Short-pick with `looseUnitsFound: 7` → base becomes **2** (those 5 loose are already sold). Floor is 0: if the other order owes a whole pack of 10, base becomes 0. The other order is decided by its **order status**, not by whether it has a pick task: waiting for payment, OPEN, or PICKING all count.
7a-1. ✅ The other order is a **scheduled** order not yet released (OPEN, no pick task yet) → still owes its 5 → base **2**.
7a-2. ✅ The other order is a prepaid order **still waiting for payment** (no pick task yet) → still owes its 5 → base **2**.
7a-3. ✅ The other order is in PICKING and its picker already bagged part of it (6 singles with 3 picked, 2 packs of 2 with 1 picked) → it owes only 3 + 2 = 5; `looseUnitsFound: 9` → base **4**.
7a-4. ✅ The other order was picked, then reopened by an admin (its old task is finished, the order is OPEN again) → it owes all its units again → base **2** for 7 found / 5 owed.
7b. ✅ Orders that do NOT count: cancelled, payment failed, packed, assigned or closed orders, orders in another store, and the order being picked itself (its own unpicked lines are counted once, from its task).
7c. ✅ `looseUnitsFound: 12` while another order owes 5 → allowed (only 7 are free), base becomes **7**.
8. ❌ `looseUnitsFound: 10` (or more free pieces) for a pack of 10 → **400** "enough for another pack… pick that pack instead"; nothing changes. Same refusal when the task line lost its pack fields but the order line still has the pack snapshot.
9. ❌ `looseUnitsFound: -1`, `2.5` or `"x"` → **400**.
10. ✅ Batch-tracked store: after step 6 the base lots add up to the new count and the pack row shows `floor(base / 10)`.
10a. ✅ Batch store, 3 packs sold from one lot (trail 30 base units), short-pick 2 with `looseUnitsFound: 5` → order line 2 packs, trail **20** base units, base **5**, pack shows **0**.

### C. Out of stock on a pack line
11. ✅ New app sends `looseUnitsFound: 8` with 2 singles of the base unpicked → line removed, base set to **6**; the pack row id is never passed to a stock write.
11a. ✅ Another order still owes 5 singles of the base → those are subtracted too (`looseUnitsFound: 9` with 1 own single + 5 owed → base **3**).
12. ✅ Old app (no field) → base set to 0 (today's rule).
12a. ✅ OOS on the order's only line (a pack), nothing owed elsewhere → order **cancelled**, base = `looseUnitsFound`, pack shows 0.
13. ❌ `looseUnitsFound` ≥ one pack plus the unpicked singles → **400**; nothing changes.
14. ✅ OOS on a normal (single) line ignores `looseUnitsFound` and zeroes that item, as today.

### D. Ops jobs skip packs
15. ✅ Auto-replenishment (cron): a pack with a carton barcode, quantity 0 and `lowQty > 0` gets **no** replenishment line; its low base still does.
16. ✅ Stock alerts / inventory groups: a strict group holding a healthy base and its 0-quantity pack stays **HEALTHY**; the 9 AM digest lists the base only, never the pack. The group screen's item list and counts leave the pack out too.
17. ✅ Nightly `inventory-batch-reconcile`: hand-set a pack row to a wrong quantity (dev DB, by the user) → after the job it equals `floor(base / units)`. A pack whose base is INACTIVE or not in the store → 0. The log line `[batch-reconcile] pack resync healed N pack row(s)` appears only when something changed. Base drift reporting is unchanged and never lists packs. The pass loops store by store (each lookup can use `idx_items_pack_base`). Known limit: it reads the base and then writes the pack outside a transaction, so a sale landing in between can leave the pack showing the older number until the next roll-up; display only, the base is never touched.

### E. Refusals (all answer 409 with `errorType: "PACK"`, `reason: "PACK_HAS_NO_OWN_STOCK"` unless noted)
18. ❌ Admin → Items → edit the pack and change low-stock level, max stock or reorder qty → **409** (packs are never reordered; set these on the base).
   - ✅ Change cost, quantity or expiry instead → **200**, the change is ignored (those always follow the base) and the reply lists it in `ignoredDerivedFields`.
19. ✅ Admin → Items → edit the pack and change only the price (the form re-sends every field) → **200**, price saved, stock fields untouched. Also when the base sold while the form was open (the pack's cost moved, so the re-sent cost is stale): still **200**, `ignoredDerivedFields: ["costPrice", …]`.
20. ❌ Stock In / adjust (`PATCH /admin/item/:packId/quantity`, + or −) → **409**, no ledger row.
21. ❌ Create a warehouse → store transfer, a store return, or a replenishment request with the pack → **409**; nothing created. The base item still works.
22. ❌ POS counter sale with the pack, or with any wholesale-only item → **409** `errorType: "RETAILER"`, `reason: "RETAILER_WHOLESALE_NOT_ALLOWED"`; no stock moves, no order. Normal items still sell.

### F. Index script (USER-RUN, never by an agent)
23. Dev first: `node scripts/migrations/build-wholesale-indexes.js` (dry run) prints DB HOST / DB NAME, then `MISSING items.idx_items_pack_base …` and `MISSING products.idx_products_pack_base …`, and builds nothing.
24. `node scripts/migrations/build-wholesale-indexes.js --apply` → `built …` for both, then `done, all 2 indexes verified`. Re-run → `Nothing to do`.
25. ❌ A prod-looking host/db aborts unless `--confirm-db=<exact db name>`.
26. ❌ An index with the same key but other options → `CONFLICT`, exit 1, nothing built.
27. After the build, confirm with `explain` that the pack roll-up (`items` `updateMany({storeId, "packOf.baseIId"})`) uses `idx_items_pack_base`. ❌ Do this BEFORE deploying the backend, not just before `wholesaleEnabled`: the pack resync runs on every base stock write in every store, including each checkout line.

## Automated tests (in-memory Mongo only)
- `packages/picking/__tests__/pack-picking.test.js`
- `packages/cron/__tests__/pack-ops-exclusions.test.js`
- `packages/admin/__tests__/pack-ops-refusals.test.js`
- `packages/admin/__tests__/build-wholesale-indexes.test.js`

## Picker short-pick resyncs pack rows (non-batch store)
- Base 230, pack of 100 shows 2. Short-pick the pack line with looseUnitsFound 5: base = 5, pack row = 0 (not the stale 2). ✅
- Raise the base to 450 through `ItemRepository.updateQuantity`: pack row = 4. ✅
- Covered by `packages/picking/__tests__/pack-picking.test.js`; fails if non-batch `updateQuantity` skips `syncLegacyPacks`. ❌ if pack row stays stale.
