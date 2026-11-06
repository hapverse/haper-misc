# Test: Retailer (wholesale) program — pack lines on orders, order edits, reopen, real GST on retailer lines

**Plan:** `haper-backend/docs/plans/retailer-wholesale.md` (rev 2, §3.4.2-§3.4.3, §3.7, §6 steps 16-17).
**Backend files:** `packages/user/src/routes/order/controller.js` (`prepareOrderItemsAndInventory`, both checkout paths),
`packages/shared/utils/order-edit.utils.js` (admin edit + picker short-pick/OOS), `packages/admin/src/routes/order/reopen.service.js`,
`packages/admin/src/routes/order/controller.js` (edit-order conflict answer).
**Branch:** `dev` (direct-to-dev). **Needs:** backend deploy (user + admin + picking services share `order-edit.utils`). No client change, no migration.
**Related guides:** `test-retailer-wholesale-packs-sell.md` (selling/returning a pack at the stock level), `test-retailer-wholesale-checkout.md` (COD switch, snapshot).

## What this is (a real example)

A "pack" is a wholesale box, e.g. **Maggi 70 g - Pack of 100**. It has no stock of its own: selling 2 packs takes 200 single Maggi packets from the base item's lots (a "lot" = one delivery of stock with its own cost and expiry).

On the order the line is written **in packs**, so the bill and invoice read "2 × Pack of 100 @ ₹1,150":

| Field on the order line | Example | Meaning |
|---|---|---|
| `quantity` | `2` | packs |
| `salePrice` | `1150` | per pack |
| `costPrice` | `1025` | per pack = cost of the 200 base units sold ÷ 2, rounded to paise |
| `batchAllocations` | `[{B-EARLY,100,₹10},{B-LATE,100,₹10.5}]` | in **base units** (Σ = packs × 100) |
| `packOf` | `{baseItemId, baseIId, units:100}` | only on pack lines |
| `hsn` | `"1902"` | the item's HSN tax code, only when the item has one |
| `wholesaleOnly` | `true` | only on wholesale lines |
| `gstRate` | `5` | **retailer orders only**: the item's real GST %. Ordinary customers' orders keep today's stored `0`. |

"Retailer order" = the order has a `retailerSnapshot` (buyer was an APPROVED retailer ordering at a store with wholesale ON, or the order has a wholesale line), for **every** line on it, retail or wholesale. The B2B invoice computes tax from these lines.

## Setup (dev)

1. A batch-tracked store with `wholesaleEnabled` ON. Base item "Maggi 70 g" with HSN `1902`, GST 5%, and 3 lots: 100 @ ₹10 (earliest expiry), 100 @ ₹10.50, 50 @ ₹11. Its pack "Pack of 100" assigned to the store at ₹1,150.
2. Customer A = approved retailer with COD ON. Customer B = ordinary customer.
3. Admin → Inventory → base item → Batches tab shows the lot quantities (use it to check every step).

## Steps

### Checkout
- [ ] ✅ A buys 2 packs (COD). In admin order JSON (or DB, read-only): the pack line has `quantity 2`, `salePrice 1150`, `costPrice 1025`, allocations 100 + 100 base units, `packOf.units 100`, `hsn "1902"`, `wholesaleOnly true`, `gstRate 5`. Base lots now 0 / 0 / 50; pack shows 0 available.
- [ ] ✅ A buys 30 singles + 2 packs in one cart: both lines exact, base dropped by 230.
- [ ] ✅ A buys only singles: line has `gstRate 5` and `hsn`.
- [ ] ✅ B buys singles: line has `gstRate 0` (unchanged), no `retailerSnapshot`. (An approved retailer buying only singles at a wholesale-OFF store gets the same.)
- [ ] ✅ Scheduled checkout of 1 pack: same line shape.
- [ ] ❌ The customer app response never contains `costPrice` / `batchAllocations`.

### Returns (each must put the exact base units back into the ORIGINAL lots, no `RST-` lot)
- [ ] ✅ Customer cancels the 2-pack order → lots 100 / 100 / 50 again, pack shows 2.
- [ ] ✅ Online order where Razorpay order creation fails → stock back.
- [ ] ✅ Unpaid online order released by the cron (run twice) → stock back once.
- [ ] ✅ Admin cancel; then cancel again → second time moves nothing.
- [ ] ✅ Refund success on a paid pack order → stock back.

### Admin order edit
- [ ] ✅ 3 packs → 1: lots get exactly 2 × 100 back (from the LAST lot first); the line keeps `packOf`, `hsn`, `gstRate`, the original `costPrice`; trail = 100 base units.
- [ ] ✅ Remove the pack line: all its base units back; the other lines keep cost/HSN/GST.
- [ ] ✅ Edit only the singles line, then cancel: the pack line still has `packOf`/`hsn` after the edit, and the cancel restores every lot (this is the "cost wipe on edit" regression).
- [ ] ✅ 1 pack → 2 on a retailer COD order: another 100 base units sold, trail 200, cost unchanged.
- [ ] ✅ Add a pack line to a retailer COD order: the new line has `packOf`, `hsn`, `costPrice` = cost of the lots it took per pack (e.g. 150 @ ₹10 + 50 @ ₹10.5 → ₹1,012.50), not the pack's displayed average. Cancel → lots exact.
- [ ] ✅ Paid order, 3 packs → 1 with a refund reason: refund = 2 × ₹1,150, 200 base units back.
- [ ] ❌ Raising/adding a wholesale line on a non-retailer order → 409 `RETAILER_WHOLESALE_NOT_ALLOWED` (unchanged rule).
- [ ] ❌ Two writers collide on stock during an edit → 409 `ORDER_CHANGED` ("This order changed while you were working on it…"), nothing saved. (Before: a 400 with database text.)

### Reopen (cancelled → OPEN)
- [ ] ✅ Reopen a cancelled 2-pack order: 200 base units sold again, line keeps `packOf`/`hsn`/`gstRate`/`costPrice`; cancel again → lots exact.
- [ ] ✅ An old pack line that lost its `packOf` gets it back on reopen, so its next cancel works.
- [ ] ❌ A line whose `packOf` points at a different base item than the pack now uses → 409 `PACK_BASE_CHANGED`, nothing sold, order stays cancelled.

### Picker
- [ ] ✅ Short-pick 3 packs → 2: order line 2 packs, trail 200 base units, `packOf`/`hsn` kept, no stock moved (the missing box is not on the shelf). A later cancel returns exactly 200 to the original lots.
- [ ] ✅ Out of stock on the pack line: line removed, no error, the other lines keep their snapshot.

### Profit
- [ ] ✅ A delivered order with 2 packs: the daily profit snapshot's cost = `costPrice × 2` = the lots' cost (within ₹0.01 because per-pack cost is rounded to paise).

## Edge cases / known limits
- Per-pack cost is rounded half-up to paise once; COGS can differ from the raw lot total by under ₹0.005 per pack (accepted in the plan).
- A short-picked pack's units stay off the books until the next count (`looseUnitsFound` on new picker builds fixes the count).
- An admin edit that RAISES an existing non-pack line, or ADDS a non-pack line, still costs it at the item's average (`costPrice`), not the lot cost (unchanged on purpose; follow-up).
- `hsn` is also written on ordinary customers' lines when the item has one (additive key, plan §3.7). `gstRate` is not.

## Automated tests (in-memory Mongo)
- `packages/user/__tests__/pack-order-lines.test.js`
- `packages/admin/__tests__/pack-order-edit.test.js`
- `packages/picking/__tests__/pack-orderline-restock.test.js`
- `packages/cron/__tests__/pack-order-profit.test.js`
- Golden baselines unchanged: `packages/user/__tests__/retailer-checkout-baseline.test.js`.

## Update 2026-10-31 (review fixes)
- `hsn` on an ordinary customer's line is **stored** but removed from customer order responses (place-order, order detail, order list). Only orders with `retailerSnapshot` show it to the customer. Check: place a normal order for an item with HSN `1101` → DB line has `hsn`, app JSON does not.
- The real `gstRate` still follows the snapshot, and the snapshot is now stamped only in stores with wholesale ON (see `test-retailer-wholesale-checkout.md`, update 2026-10-31). An approved retailer ordering in a wholesale-OFF store gets `gstRate` 0 like everyone else.
- A pack row is treated as wholesale at checkout even if its `wholesaleOnly` flag was lost (a non-retailer is refused it like an out-of-stock item).
- Reopening a cancelled order with wholesale/pack lines now needs the retailer to still be approved (and COD ON for cash orders).
