# Test: Retailer (wholesale) program — same-stock packs (stock foundation + admin pack endpoint)

**Plan:** `haper-backend/docs/plans/retailer-wholesale.md` (rev 2, Phase 1C steps 13-14, §3.4.1, §3.4.4, §3.4.6, §3.4.7). Design: `haper-misc/design-retailer-wholesale.md` §10.
**Backend files:** `packages/shared/repositories/store-batch.repository.js` (pack-row sync, refusals, reconcile/seed skip), `packages/shared/repositories/product.repository.js` (pack create, derived fields, fan-out, assign sync), `packages/admin/src/routes/product/*` (`POST /admin/product/:id/packs`, HSN / wholesaleOnly fields, discontinue hook), `packages/shared/utils/variant-rules.utils.js` (size-group rules), schemas `products` / `items` (`packOf`, `wholesaleOnly`, `hsn`).
**Branch:** `dev` (direct-to-dev workflow).
**Not in this part (next lane):** selling a pack at checkout (base decrement of N × units), returning a pack, picking, POS/transfer refusals, low-stock / stock-value exclusions, nightly pack resync, the index build script. That lane is now built (see `test-retailer-wholesale-packs-sell.md` and `test-retailer-wholesale-pack-ops.md`). Keep `wholesaleEnabled` OFF on every store until the new picker build is out.

## What this is (a real example)

A store sells "Masala Noodles 70g" as singles. A shopkeeper wants a box of 100. We do not move 100 noodles into a separate box stock. Instead we create a **pack**: a second product "Masala Noodles 70g - Pack of 100" that points at the single (`packOf: { baseIId: <single's iId>, units: 100 }`). The pack has no stock of its own. Its shown quantity is always worked out from the single:

- 250 singles on the shelf → the pack shows **2** (250 ÷ 100, rounded down).
- Someone buys 51 singles → 199 left → the pack shows **1**, in the same database transaction as the sale.
- The single is switched off (INACTIVE) in a store → the pack shows **0** there.

The pack's brand, category, unit, GST rate and HSN code (the tax classification code printed on GST invoices, e.g. `1902` for noodles) are copied from the single and re-copied every time the single is edited, so the pack can never carry an old GST rate. Weight = single's weight × units (70 g × 100 = 7000 g).

All names and numbers here are fictional.

## Deploy / what is needed

1. Backend (admin + user + cron share the code), only after step 0. No customer sees anything: packs are `wholesaleOnly`, hidden unless the store's `wholesaleEnabled` flag is on and the viewer is an approved retailer (already built in the visibility part).
0. **USER-RUN BEFORE the backend deploy** (the script ships with the next lane): `scripts/migrations/build-wholesale-indexes.js` builds `idx_items_pack_base` and `idx_products_pack_base`. No document has `packOf` yet, so both build instantly and the old code ignores them (harmless). Why first: without them
   - every stock change of ANY item in a batch store (every checkout line, inside the order transaction; stock-in; recall; returns) scans that store's whole item list to look for pack rows (~2,100 items per line on prod), and
   - every product master edit plus the nightly product reconcile scan all products looking for packs (~2,100 x 2,100 reads per night).
   It is still correct without them, just slow, and the checkout one holds the order transaction open longer. ❌ Do not deploy the backend before the script has reported both indexes OK. If it went out first, run it at once and check `db.items.find({ storeId: <id>, "packOf.baseIId": "<iId>" }).explain()` shows `IXSCAN` on `idx_items_pack_base`.
3. Keep `wholesaleEnabled` OFF on every store until the checkout/restock/picking lane and the new picker build are done (P1 gate).

## Steps (admin API, super admin token; dev = damin.haper.in)

Pick a product master that is a single item, is active, and is assigned to a **batch-tracked** store with some stock (example: 250 in stock, cost ₹11, price ₹14).

### A. Create a pack
1. `POST /admin/product/<singleProductId>/packs` body `{ "units": 100, "sellingPrice": 980 }`
   - ✅ 200, `data.created: true`, `data.product.packOf = { baseIId: <single iId>, units: 100 }`, `wholesaleOnly: true`, name `"<single name> - Pack of 100"`, weight = single weight × 100, same brand/category/unit/GST/HSN as the single, `barcode: ""`.
   - ✅ `data.warnings` contains `PACK_BELOW_COST` ("Below cost in <store>: ₹9.8 per piece vs cost ₹11"). It is a warning, not an error: the pack is still created.
   - ✅ No store item row and no warehouse row exist yet for the pack.
   - ✅ One audit row `product.pack.create`.
2. Send the same request again (any name).
   - ✅ 200, `created: false`, the SAME `_id`. No second pack, no second audit row.
   - ✅ The single's `updatedAt` does not change (it does not jump to the top of the admin product list on a retry).
3. Other warnings: `{ "units": 300, "sellingPrice": 4500 }` → ✅ `PACK_PRICIER_THAN_SINGLES` (₹15 per piece vs ₹14 for a single) and `PACK_BASE_STOCK_BELOW_UNITS` (only 250 singles, fewer than one pack of 300: the pack will show as sold out).
4. ❌ cases (nothing created):
   - `units` 1, 2.5, 10001, "abc", missing → 400 "Units must be a whole number from 2 to 10000."
   - Base is itself a pack → 400 (`PACK_BASE_IS_PACK`).
   - Base discontinued → 409 (`PACK_BASE_INACTIVE`).
   - `barcode` equal to the single's barcode → 409 (`PACK_BARCODE_IS_BASE`).
   - Store admin / manager token → 403.

### B. Assign the pack to stores
1. `POST /admin/product/<packId>/assign` body `{ "storeIds": [<storeWithSingle>, <storeWithoutSingle>], "price": 1300, "sellingPrice": 1250 }`
   - ✅ `assigned: 1, skipped: 1, noBase: 1` (the store that does not carry the single is skipped).
   - ✅ The new pack row immediately shows `quantity = floor(single stock / 100)` (2 for 250), `costPrice = single's cost × 100` (₹1100), `wholesaleOnly: true`, `packOf` set. It does NOT show 0.
   - ✅ No lot (store batch) exists for the pack row.
2. Assign again → ✅ `skipped`, and a pack row that showed a wrong number is corrected.

### C. Pack quantity follows the single (batch store)
1. Stock-in 60 of the single → ✅ pack shows 3 (310 ÷ 100).
2. Sell / adjust the single down to 199 → ✅ pack shows 1.
3. Put a lot of the single on HOLD (recall) → ✅ pack drops with it.
4. Set the single INACTIVE in the store → ✅ after the next stock change of the single (or the delete hook in the next lane), the pack shows 0. Its lots are untouched.
5. ❌ Try to stock-in, adjust or restock the PACK row directly → 409 "This is a wholesale pack. It has no stock of its own: adjust the base item instead." (`PACK_HAS_NO_OWN_STOCK`). (Admin item-edit and transfer refusals come with the next lane; this part guards the batch layer underneath.)

### D. Pack master edits
1. `PATCH /admin/product/<packId>` with `{ "name": "Noodles Carton", "gstRate": 28, "brand": "X" }`
   - ✅ 200, name changes; `data.ignoredDerivedFields` lists `gstRate`, `brand`; GST and brand stay the single's.
2. `PATCH` with `{ "packOf": {...} }` → ❌ 400 (the link cannot be changed; to change units, discontinue the pack and create a new one).
3. `PATCH` with `{ "wholesaleOnly": false }` → ❌ 409.
4. Edit the SINGLE: `{ "gstRate": 18, "hsn": "19023010" }` → ✅ the pack master and every pack store row now show 18% and that HSN, in the same save. Send `{ "hsn": "" }` → ✅ HSN removed from the single, the pack and all their store rows.
5. HSN validation: `"12"` or `"12AB"` → ❌ 400 "HSN code must be 4 to 8 digits".

### E. Discontinue
1. `PATCH /admin/product/<singleId>/status` `{ "status": "discontinued" }`
   - ✅ Response has `packsDiscontinued: 1, packItemsDeactivated: <n>`; the pack master is discontinued and every pack store row is INACTIVE. The single's own store rows stay ACTIVE (unchanged behaviour).
   - ✅ Setting the single back to active does NOT revive the pack.
2. Discontinue a PACK → ✅ its store rows go INACTIVE; `POST .../packs` with the same units now creates a fresh pack.
3. A product with no packs → ✅ response is exactly `{ product }` as before.
4. Hard delete (`DELETE /admin/product/<singleId>`) while it has packs (live OR discontinued) → ❌ 409 `reason: "wholesale_packs"`, message "Delete its packs first, or use Discontinue instead."
5. Re-activate a discontinued pack (`PATCH /admin/product/<packId>/status` `{ "status": "active" }`):
   - ❌ while its single is discontinued → 409 `reason: "PACK_BASE_INACTIVE"`; pack stays discontinued.
   - ❌ while another live pack of the same units exists (e.g. the replacement from step 2) → 409 `reason: "PACK_DUPLICATE_LIVE"`. Why: two live "Pack of 100" for one single would make "create pack of 100" return either one.
   - ✅ once the replacement is discontinued and the single is active → 200, pack active again (its store rows stay INACTIVE until switched on per store).
   - ✅ Re-activating a normal product is unchanged.

### F. Size groups
1. Put the single and its pack in one size group (`POST /admin/variant-group`) with the single as default → ✅ 201; members list shows the pack row with `wholesaleOnly: true` and `packOf`; no "looks like a multipack" warning for the pack.
2. Same group with the PACK as default → ❌ 400 block `DEFAULT_NOT_RETAIL` ("Default size must be a retail size").
3. A RETAIL "Pack of 4" member still gets the multipack warning (unchanged).
4. ❌ `PATCH /admin/product/<defaultSizeId>` `{ "wholesaleOnly": true }` on the group's DEFAULT size → 409 `reason: "DEFAULT_NOT_RETAIL"` (the default is the card every customer sees). ✅ The same edit on a non-default member → 200.

### H. Barcode generator leaves packs alone
A pack has no barcode by default (most cartons are scanned as the single's code).
1. `GET /admin/product?missingBarcode=true` → ✅ the single (no barcode) is listed, the pack is NOT.
2. `POST /admin/product/generate-missing-barcodes` → ✅ only the single gets an internal EAN; the pack's barcode stays `""` and it is not assigned to any store.
3. `POST /admin/product/<packId>/generate-barcode` → ❌ 409 `reason: "PACK_BARCODE_MANUAL_ONLY"`.
4. `PATCH /admin/product/<packId>/barcode` `{ "barcode": "<real carton code>" }` → ✅ 200, code saved; `provisioning.status: "skipped"` and the pack is NOT auto-assigned to stores at price 0 (assign it by hand with a price).

### G. Ops jobs (no phantom stock)
1. Admin store save that seeds batches (turning batch tracking on) → ✅ no LEGACY lot is created for any pack row.
2. Nightly inventory-batch reconcile → ✅ pack rows are never listed as drifted.
3. Pack resync with nothing changed → ✅ reports 0 changed and does not touch the row's `updatedAt` (only a real fix counts as "healed").

## Automated tests
- `packages/user/__tests__/pack-stock-conservation.test.js` (51, incl. other lanes' tests): floor/rounding, no-change resync reports 0 and keeps `updatedAt`, repeat create leaves the base's `updatedAt`, same-transaction update + abort, every base lot change, inactive base, refusals, roll-up on a pack id, reconcile/seed skip, idempotent + concurrent create, replace after discontinue, fan-out never strips `packOf`, GST/HSN re-derive (+ abort), assign skip/heal, no warehouse row, retryable lot-guard miss, parallel singles sale.
- `packages/admin/__tests__/product-wholesale-packs.test.js` (24): endpoint, idempotency (base `updatedAt` untouched on repeat), warnings, refusals, role gate, edits, HSN, assign, discontinue hook, pack re-activation guards, delete refusal, size-group rules (incl. wholesale default via product edit), barcode generator / auto-provision skip packs.
