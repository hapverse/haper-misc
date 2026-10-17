# Adrak 50g: order cost ₹37.94 vs warehouse receipt ₹5.00 (2026-10-07)

Read-only investigation. Data source: the local prod dump `prod-dump/haper-prod`. It was re-synced on 2026-10-07 at 23:57 IST, so it now contains the 6 Oct order. No live DB was used.

## Answer
Both screens show the right numbers for the field they read. The ₹37.94 is a bad cost on an OLD store batch:
1. Haper Mart item `68d24325da75c1180b4acc3e` (barcode 2000006914347) had `costPrice` 6 until 2026-09-06. By 2026-09-28 it was **45** on Haper Mart only (the Bhagwan Bazar copy of the same item stayed at 6). No stock movement or admin audit row records that change. The most likely writer is the store item edit form, which allows `costPrice` in `packages/admin/src/routes/items/controller.js:598`. A cost of ₹45 for a ₹15-MRP pack is a data-entry error.
2. On 2026-09-29 12:51 UTC, batches were enabled. Seeding created a LEGACY batch (the catch-all batch for stock that already existed) at the item's own cost, 45 (`store-batch.repository.js:112`). That is correct code fed with wrong data. The batch's expiry was 2027-09-23. From 09-29 to 10-06, 13 orders snapshotted `LEGACY@45`.
3. On 2026-10-04, receipt AR-20261004 (30 pcs @ ₹5) moved warehouse → store as its own batch @ ₹5 (`transfer/controller.js:59`). AR-20261004 has no expiry. FEFO (first-expiry-first-out) puts batches with no expiry last (`store-batch.repository.js:26-29`), so the LEGACY batch, which has an expiry date, is still sold first.
4. On 2026-10-06 at 13:11, the customer cancelled HP532016285. That order had taken 1 unit from `LEGACY@45`. The cancel restock (`user/.../order/controller.js:1353` → `item.repository.js:1288-1306`) put the unit back into LEGACY at the item's blended average, not at the cost of the batch it came from: (4×45 + 30×5)/34 = 9.71. Merging that unit into the batch averaged its cost (`store-batch.repository.js:308-315`): (4×45 + 9.71)/5 = **37.94**. HP590816289 and HP662116291 then each took 1 unit `LEGACY@37.94`.

Current state: LEGACY has 3 units @ 37.94 and AR-20261004 has 30 @ 5. The item roll-up is (3×37.94 + 30×5)/33 = 7.99, which matches `items.costPrice` exactly.

## Classification
Mostly (c) plus bad data. Selling the older, different-cost batch first is expected FEFO behaviour, but that batch's cost (45) was a typo. Not the late-September stale/zero-cost class.
There is also a real code flaw, (a): restocks put units back at the item's average cost instead of the cost of the batch they left. That changes old batch costs on every cancel. Here it happened to move 45 toward 9.71.

## Direction (for the owner)
- Data: correct Haper Mart LEGACY batch `6abbb4664cf9d5cac84ce28b` to the real cost (₹5–6?) through an admin correction path, and decide whether to restate the ~15 order snapshots.
- Code: on cancel or refund, return units to the batches in the line's `batchAllocations` at their stored cost, not to LEGACY at the average. Add a sanity guard (cost > MRP) and an audit row on item-form `costPrice` edits.
