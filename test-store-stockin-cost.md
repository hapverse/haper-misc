# Test guide — item cost when a batches-OFF store receives stock

## Scenario
A store with **batches turned off** (config `batchesEnabled: false`, e.g. Haper Mart)
receives stock through a warehouse transfer or the admin **Stock-In**. Before the
fix only the quantity went up and the item's cost stayed at 0. Now the incoming
cost is folded into the item's cost:

- item cost 0 (unknown) -> item cost becomes the incoming cost
- item already has a cost -> weighted average, rounded to 2 decimals (half-up)

Example: transfer of Amul Butter 100g, 3 units at cost 57.70, item cost was 0 -> item cost 57.70.

**Code:** `packages/shared/repositories/item.repository.js` (`applyStockIn`, `weightedCostStockInPipeline`);
callers: `packages/admin/src/routes/transfer/controller.js` (receive) and `packages/admin/src/routes/items/controller.js` (Stock-In).

**Tests:** `packages/admin/__tests__/stock-in-flag-off-cost.test.js` (in-memory Mongo).
Run: `cd haper-backend/packages/admin && NODE_ENV=test /usr/local/bin/node ../../node_modules/.bin/jest __tests__/stock-in-flag-off-cost --coverage=false`

## Manual steps (admin, dev)
Use a store with batches off and an item whose cost shows 0.

1. Note the item's cost and quantity (e.g. Amul Butter 100g: cost 0, qty 3).
2. Create a warehouse -> store transfer for 3 units of it and dispatch it (the warehouse lot must carry a cost, e.g. 57.70).
3. Receive the transfer in the store.
   - ✅ Item quantity is 3 higher.
   - ✅ Item cost is now 57.70 (was 0).
   - ❌ Cost still 0 -> fix not deployed, or the warehouse lot has no cost.
4. Item with an existing cost: item has 2 units at 50, receive 3 units at 60.
   - ✅ Cost becomes 56.00, quantity 5.
5. Admin Stock-In on a batches-off store: add 10 units with cost 40 to a cost-0 item.
   - ✅ Cost 40, quantity +10.
6. Admin Stock-In with the cost field left blank on an item that has a cost.
   - ✅ Cost unchanged, quantity +N.
7. Batches-ON store (regression): Stock-In with a batch number and cost.
   - ✅ A batch is created/updated as before; item cost follows the batch roll-up.

## Edge cases
- Cost 0 on the item means "unknown": it is never averaged in (2 units at 0 + 3 at 60 -> 60, not 36).
- Incoming cost missing, 0, negative or not a number -> cost untouched, quantity still goes up.
- Quantity 0 / not a number -> no cost change.
- Negative current stock counts as 0 in the average (-5 at 40 + 5 at 60 -> 60).
- Rounding is half-up: 0.125 -> 0.13, 7.30789 -> 7.31.
- Several receipts at once on the same item: no lost quantity, cost is consistent.
- A transfer line with several warehouse lots blends lot by lot.

## Enabling batch tracking on a store (config `batchesEnabled` OFF -> ON)

### Scenario
Turning batches ON via admin store config (`PUT /store/:storeId`) now re-syncs stale
`LEGACY` seed batches. Item quantity is the truth at that moment:

- stock-lot totals are made equal to the item's quantity
- LEGACY lot cost:
  - if other (named) lots hold open stock, the LEGACY lot KEEPS ITS OWN cost (only its quantity is re-synced)
  - if LEGACY is the only open lot: item cost (if > 0, rounded to 2 decimals), else the lot's own cost (if > 0), else last received transfer cost, else warehouse cost, else unknown (0)
- named (real) lots are never changed automatically
- if seeding fails with a non-duplicate error, the PUT fails and `batchesEnabled` stays OFF
- the PUT response has a new optional field `batchSeed: { seeded, unresolved: { count, itemIds (max 10) } }`; it is `null` when the request does not enable batches

Before the fix old lots were skipped, so the first sale after enabling rolled the item back
to old numbers and could drop its cost to 0.

Migration scripts: `scripts/migrations/seed-store-batches.js` now seeds only stores with batches
enabled; `scripts/migrations/seed-launch-setup.js` seeds a store before switching it on.

### Manual steps (admin, dev)
Use a batches-OFF test store with an item at quantity 11, cost 50 (e.g. Test Rice 1kg).

1. Enable batch tracking in the store config and save.
   - ✅ Save succeeds; the item's batches show total 11 at cost 50.
   - ❌ Total is any other number, or cost is 0 -> fix not deployed.
2. Place a sale of 1 unit of the item.
   - ✅ Quantity 10, cost still 50.
   - ❌ Quantity jumps to a different number (e.g. 18) or cost changes/goes to 0.
3. OFF -> ON again: switch batches OFF, receive/adjust stock so the item is quantity 14 at cost 50, switch ON.
   - ✅ Batches total 14 at cost 50; next sale of 1 gives 13.
4. Item whose LEGACY lot cost is 0 (item cost 0, but a past transfer received at 42.00).
   - ✅ After enabling, lot cost is 42.00 (falls back to last received transfer cost, then warehouse cost).
   - ✅ With no cost anywhere, cost stays 0 (unknown) and nothing breaks.
5. Unresolved case: switch a store OFF then ON where a named lot (e.g. "B-101") holds more stock than the item quantity (lot 20, item quantity 12).
   - ✅ Save succeeds; response `batchSeed.unresolved.count` is 1 and lists the item id (max 10 ids shown).
   - ✅ Named lot "B-101" is untouched.
   - Admin action: open each listed item, compare lot totals with the real shelf count, and fix the lots manually (stock adjust). Do not rely on the sale rollback until fixed.
6. Re-save config on a store already ON (no change to the switch).
   - ✅ Nothing changes: quantities, lots and costs identical; `batchSeed` is `null`.
7. Save config without touching batches on an OFF store.
   - ✅ `batchSeed` is `null`; batches stay OFF.
8. No-activity toggle: store is ON with a LEGACY lot of 10 units at cost 40 and a named batch of 10 units at cost 60 (item shows 20 at cost 50). Switch batches OFF and back ON with no sales in between.
   - ✅ Both lots unchanged (LEGACY 10 at 40, named 10 at 60); item cost after the first sale is the same as it would have been without the toggle.
   - ❌ LEGACY cost changes to 50, or the item cost jumps.

### Edge cases
- Item quantity 0 -> LEGACY lot total 0, no error.
- The LEGACY lot is adjusted so the TOTAL of all open lots equals the item quantity, i.e. LEGACY ends at (item quantity minus the named lots' open quantity). Example: item quantity 12, named lot B-1 has 4, LEGACY has 5 -> LEGACY becomes 8, B-1 stays 4. (If LEGACY is the only lot, it simply becomes the item quantity.)
- If that would go below 0, LEGACY is set to 0 and the item is reported in `batchSeed.unresolved`.
- A LEGACY lot on HOLD or RECALL is not touched and is reported as unresolved.
- Named lots fall SHORT of the item quantity -> a NEW LEGACY lot is created for the missing units at the item's cost. Expected: the item's average cost can shift slightly if the named lots' average differs from the item cost; admins may see the item cost settle after the first sale.
- Seeding fails (e.g. DB error) -> PUT returns an error and batches remain OFF; retry after the cause is fixed.
- Duplicate-seed errors (already seeded) are not treated as failures.
- More than 10 unresolved items -> `count` shows the full number, `itemIds` only the first 10.
- Unicode / long item names have no effect on seeding (it works by item id).

## Deploy
Backend deploy only (no admin/app change). The admin ignores the new `batchSeed` field.

Items that already have cost 0 from earlier receipts are NOT changed by the deploy.
Repair them separately with the user-run script
`haper-backend/scripts/migrations/repair-store-item-cost-from-transfers.js`
(run the dry-run first and review the plan; node 24).

## Related
A lot recorded at the wrong cost (and the orders sold from it): see `test-bad-lot-cost-repair.md`.
Cancel / refund / edit restocks now return units to the lot they were sold from, at that lot's cost: see `test-inventory.md` section 17.
