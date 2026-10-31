# Test: Retailer (wholesale) program — selling and returning same-stock packs

**Plan:** `haper-backend/docs/plans/retailer-wholesale.md` (rev 2, Phase 1C step 15, §3.4.2, §3.4.3, §3.4.6, §3.4.7, review fixes R-B1 / R-S1 / R-S4). Builds on `test-retailer-wholesale-packs.md` (pack create / assign / quantity).
**Backend files:** `packages/shared/repositories/item.repository.js` (pack-aware `sellFEFO` + `restockOrderLine`, retry passthrough, pack-row refusals, base delete/inactivate resync, clone resync, ops readers skip packs), `packages/shared/repositories/category.repository.js` (category tile "from ₹" price).
**Branch:** `dev` (direct-to-dev workflow).
**Status:** the order-controller lane (checkout writes `packOf` + `hsn` on the order line, order edit carries `packOf` forward) and the operations lane (picker OOS / short-pick redirect, transfer / POS / gift refusals) are built. Keep `wholesaleEnabled` OFF on every store until the new picker build (the hard gate) is out; see `runbook-wholesale-rollout.md`.

## What this is (a real example)

"Masala Noodles 70g" has 250 singles in a batch-tracked store, in three lots (a lot = one delivery with its own cost and expiry):

| Lot | Units | Cost per unit | Expires |
|---|---|---|---|
| B-EARLY | 100 | ₹10.00 | Feb 2027 |
| B-LATE | 100 | ₹10.50 | May 2027 |
| B-NODATE | 50 | ₹11.00 | none |

A shopkeeper buys **2 × "Pack of 100"**. The pack has no stock of its own, so the sale takes **200 singles** from the lots, soonest-expiring first (FEFO = first expiry, first out): all of B-EARLY, all of B-LATE. The order line stores:

- `quantity: 2` (packs), `salePrice` per pack,
- `costPrice` = cost of ONE pack = (100 × 10 + 100 × 10.50) ÷ 2 = **₹1025**, so profit = (salePrice − 1025) × 2 with no change to the profit report,
- `batchAllocations` in SINGLES (100 from B-EARLY, 100 from B-LATE): they always add up to packs × units,
- `packOf: { baseItemId, baseIId, units: 100 }`, the line's own record of what one pack is.

Cancelling that order puts the 200 singles back into B-EARLY and B-LATE (the same lots, same costs), and the pack again shows 2.

All names and numbers are fictional.

## Deploy / what is needed
1. Backend (admin + user + delivery + picking + cron share this code). Index script from `test-retailer-wholesale-packs.md` step 0 first.
2. Nothing changes for stores without packs: a normal item's sale, cost and return are exactly as before.

## Steps (dev = dapi.haper.in / damin.haper.in, batch-tracked test store, a test retailer account)

### A. Buy a pack (after the order-controller lane is on dev)
1. Retailer checks out 2 × the pack.
   - ✅ Order placed. Admin batch view of the single: B-EARLY 0, B-LATE 0, B-NODATE 50. The pack row shows 0 (50 ÷ 100).
   - ✅ Order line: `quantity 2`, `costPrice 1025`, `batchAllocations` total 200, `packOf.units 100`.
   - ✅ The pack row itself never gets a lot.
2. Cost with an uneven split: lots 5 × ₹3.33 and 4 × ₹3.36, "Pack of 3", buy 2 packs → 6 singles cost ₹20.01 → ✅ `costPrice 10.01` (₹10.005 rounded half-up to paise). Profit may differ from the raw lots by at most ₹0.005 per pack (accepted in the plan).
3. ❌ Buy 3 packs with only 250 singles → "Out of stock", nothing taken from any lot.
4. ❌ Single set INACTIVE (or deleted) in the store → the pack shows 0 and checkout refuses it as out of stock, even though the single's lots are still there.
5. ❌ Cart with 2 packs + 60 singles of the same noodles (needs 260, have 250) → whole checkout refused, nothing taken.
6. Two buyers at once (pack of 2 and 100 singles, only 250 in stock) → ✅ at most what is on the shelf is sold; the single never goes below 0; the pack shows floor(left ÷ 100).
7. Busy-store retry: if two checkouts touch the same lot at the same moment, the loser is retried automatically by the database transaction (no "400" to the customer, no duplicate order).

### B. Return / cancel a pack
1. Cancel the order from A.1 (user cancel, admin cancel, rider undelivered, payment failure or unpaid release) → ✅ B-EARLY 100, B-LATE 100, B-NODATE 50 again; single 250; pack 2.
2. Admin edit: reduce the line from 2 packs to 1 → ✅ 100 singles back into B-LATE (last lot first); the line keeps 100 from B-EARLY in its trail.
3. Picker short-pick 1 of 2 packs (`restock:false`) → ✅ no lot changes (the pack was not on the shelf), and the line's trail now totals 100 singles (1 pack × 100), not 199.
4. A pack line whose trail is empty (sold before the store had lots) → ✅ its 100 singles go to a new `RST-<orderId>` lot at ₹10.40 each (the per-pack cost ₹1040 ÷ 100).
5. ❌ A pack line that lost its `packOf` (or has a broken one) → the cancel / edit fails with a 500 "pack line is missing its pack snapshot; nothing was restocked" and nothing moves. This is deliberate: a guess could put stock on the pack row. Normal pack lines always carry `packOf` (checkout writes it, order edits carry it forward), so this only fires on a damaged line.

### C. Pack rows cannot be stocked directly (admin)
1. ❌ Stock-in / adjust (+ or −) on the PACK row → 409 "This is a wholesale pack. It has no stock of its own: adjust the base item instead."
2. ✅ Admin item edit of the pack row with a new quantity, cost price or expiry → **200**, those values are ignored (they always follow the single) and the reply lists them in `ignoredDerivedFields`, e.g. `["costPrice"]`. Other fields in the same save (price, shelf) are saved.
3. ✅ Admin item edit of the pack row that only changes the price (the form re-sends the current quantity / cost / expiry) → saved; quantity / cost / expiry unchanged. Also works when a single was sold after the form was opened (the pack's cost moved, so the re-sent cost is stale): the price still saves, no 409.
4. ✅ The single itself is edited, stocked and adjusted exactly as before.

### D. Single deleted / switched off / store cloned
1. Admin deletes the single in a store (it only turns INACTIVE) → ✅ its packs show 0 at once; lots untouched.
2. Single switched OFF via status, then ON again → ✅ packs 0, then back to floor(single ÷ units).
3. Create a store "from" this store (clone) → ✅ the pack row is copied with `packOf`, quantity 0, cost = cloned single's cost × units (a stale cost on the source pack is not copied over).

### E. Ops numbers do not double-count
1. Low-stock list / auto-replenishment → ✅ only the single appears, never its pack.
2. Total stock value, catalogue summary out-of-stock / low-stock / expiring counts and stock / selling value → ✅ the pack is counted as a catalogue row (total / active) but not as stock (250 × ₹10.40 = ₹2600, not ₹2600 + 2 × ₹1040).
3. Expiring-items list and count → ✅ the single only (the pack carries the single's expiry).
4. Admin → Items list: tap the "Out of stock" / "Low stock" / "Expiring" tile (or pick that stock filter, or "Missing barcode") → ✅ the list total equals the tile number; packs are not in these lists (a 0-stock pack never shows under "Out of stock", a barcodeless pack never fills "Missing barcode"). With no stock filter the pack is still listed as a normal row.

### F. Category tile price (retailer home)
1. Snacks has a retail cookie tin at ₹2000 in stock and a noodle pack at ₹1150 → ✅ the retailer's Snacks tile shows "from ₹2000" (a pack price never drives "from" while a retail item is in stock, same as the product card).
2. Tin goes out of stock → ✅ retailer tile "from ₹1150"; a normal customer's tile has no price for those items (the pack is hidden from them).
3. ✅ Normal customers' tiles are unchanged.

## Automated tests
- `packages/user/__tests__/pack-stock-conservation.test.js` (51, of which 24 new): sell FEFO across lots + per-pack cost + snapshot, half-up rounding, non-pack return shape unchanged, refusals (short / inactive / missing base / part pack), parallel no-oversell, lot-guard miss and a real server WriteConflict both retried by `withTransaction` with one order written, labelled error unwrapped vs plain 400, legacy store sell + restock; restock full / partial / `move:false` / RST remainder / fail-closed; pack-row refusals on every direct writer, `updateItem` drops derived fields (incl. a stale cost after a base sale); base delete / inactivate / clone resync; low stock / stock value / expiring / summary exclusions, list totals equal the tiles; category tile price.
- Golden non-pack behaviour: `discount-fefo-cost-basis`, `restock-callers-user` (user), `restock-*`, `store-batch-*`, `order-cogs-capture`, `order-edit-cost-preservation` (admin).

## Update: stores WITHOUT batch tracking keep packs in step (second review loop)
Setup: a store with batch tracking OFF; single noodles qty 230, "Pack of 100" assigned → pack shows 2.
1. Picker short-pick / out-of-stock on the single with "5 loose units found" (sets the single to 5) → ✅ the pack shows 0 at once (before: it kept showing 2 until the nightly resync, so customers could add a pack that checkout then refused).
2. ✅ Same for every other stock change on the single in that store: customer buys 31 singles (→ 199, pack 1), order cancel / refund restock of a singles line, admin stock-in, stock adjust + / −, transfer receive → the pack always shows floor(single ÷ 100) right after.
3. ❌ A failed "take stock" (not enough on the shelf) → single and pack both unchanged.
4. ✅ If the surrounding order/transaction fails, the pack change is rolled back with the single's.
5. ✅ A single with no packs behaves exactly as before.
6. Admin Items → edit the single and Save with quantity 450 → ✅ the pack shows 4 at once (before: it stayed at 2 until the next sale or the nightly resync). Change only its cost price to ₹12 → ✅ pack cost ₹1200. Change only its expiry → ✅ the pack shows the same expiry.
7. ❌ Edit the pack row itself with a quantity / cost / expiry → those three are ignored (they always follow the single); a selling-price edit on the pack still saves.

### Expiring tile vs list (admin Items)
1. An item with no expiry date on file (field missing or empty) → ✅ it is NOT counted in the "Expiring" tile and not in the "Expiring" list (before: the tile counted it, the list did not, so tile 1 / list 0).

### Automated
- `packages/user/__tests__/pack-stock-conservation.test.js` now 59: + admin form save of the single (`updateItem` with quantity, cost, expiry, each alone and as form strings) re-derives the pack; a batches-off pack-row edit still drops the derived fields; + batches-off store: `updateQuantity` (in a txn, without one, rolled back), `incrementQuantity`, `decrementIfAvailable` (incl. refused), singles `sellFEFO`, `applyStockIn`, `findOneAndUpdateAtomicQty` ±, singles-line `restockOrderLine` all re-derive the pack; expiring tile == list with a missing / null expiry.
- Picking (owned by the ops lane): `packages/picking/__tests__/pack-picking.test.js` should add a batches-off short-pick assertion that the pack row follows the base.

## Update: pack resync after a saved edit (third review loop)
Setup: single noodles in any store, "Pack of 100" assigned and showing stock.
1. Admin Items → set the single to Inactive (or drop its stock to 50) and Save → ✅ the pack shows 0 at once, even right after the save (the pack is re-read from the primary database copy, not a lagging replica that still has the old ACTIVE / high-stock single).
2. Admin → delete the single from the store → ✅ the pack shows 0 at once.
3. ❌ If the pack refresh itself fails after the single was saved (edit, delete, picker short-pick without an order, store clone) → ✅ the admin still sees "saved" (the single DID change), low-stock alerts still re-run, and a `[pack-sync]` line is logged with item ids only. The pack may show its old number until the nightly 3:15 AM reconcile; checkout re-checks the single, so it can never oversell.
4. ✅ Inside an order / transaction a failed pack refresh still rolls the whole change back (single unchanged).

### Automated
- `pack-stock-conservation.test.js` now 64: + sessionless resync failure → `updateItem` / `updateQuantity` / `delete` still succeed and the evaluation runs; + clone still reports its copied rows; + in-transaction resync failure aborts; + sessionless `syncPackRows` reads (base, pack→base, lot roll-up) are all `read("primary")`, in-transaction reads stay on the session.
