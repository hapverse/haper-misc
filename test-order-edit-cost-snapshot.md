# Test: Editing an order no longer destroys its cost/profit data (live money bug)

**Area:** Admin panel → **Orders → Edit Order**, and the **Picker app** (mark item out-of-stock /
short pick). All three go through one shared function.
**Backend:** `packages/shared/utils/order-edit.utils.js` (`applyItemEdit`).
**Call sites:** `packages/admin/src/routes/order/controller.js:314` ·
`packages/picking/src/routes/task/controller.js:374` (short pick) and `:578` (out of stock).
**Endpoint:** `PATCH /admin/order/edit-order/:orderId` (+ the two picker task endpoints).
**Deploy needed:** backend **redeploy only**. **No DB migration. No env var. No app release.**
**Tests (green):** `packages/admin/__tests__/order-edit-cost-preservation.test.js` (3 cases, new) ·
`packages/admin/__tests__/order-edit-discount-snapshot.test.js` (2 cases, must stay green).
Suite totals for this slice: **admin 1457 passed (89 suites) · picking 76 passed (6 suites).**

---

## What went wrong (real example)

A customer orders **1 bottle of oil** and **3 packets of biscuits**. At checkout the system writes
down, on each line of the order, what that stock actually **cost us** — oil ₹170, biscuits ₹42.50 —
plus which storeroom batch it came from, the GST rate, and the product's cross-store code. This is a
**photograph taken at sale time**. The Profits page reads that photograph, not today's prices.

Now the store admin edits the order — say the customer calls and wants **2 bottles instead of 1**.

Before this fix, saving that edit **erased the cost photograph on every line of the order**, not just
the line that was changed:

| Field on each order line | Before the edit | After saving the edit (the bug) |
|---|---|---|
| `costPrice` (what we paid) | ₹170 / ₹42.50 | **0** |
| `batchAllocations` (which batch it came from) | 1-2 batch rows | **empty** |
| `gstRate` (tax rate frozen on the invoice) | 5% / 12% | **0** |
| `iId` (product code) | `BI862140` | **blank** |

Because cost became **0**, that order looks like it cost us nothing to fulfil — so its **profit looks
like the entire sale amount**. The biscuits line was never even touched by the edit and it was
wiped too.

**This was live.** It fired on every admin order edit *and* every time a picker marked something
out-of-stock or short-picked — which is the common, everyday case. So the Profits page has been
over-stating margin on every edited order.

### Why it happened

`applyItemEdit()` rebuilds the order's item list from scratch using an **explicit list of fields to
keep**. That list had `itemId, name, quantity, salePrice` and the discount fields — but **not** the
four cost fields. Anything not on the list is dropped, and the database then fills the blank with its
default (`0`, `[]`, `""`). The same file already carried cost forward correctly for **free gift**
lines, so gift lines were safe while paid lines were not.

This is the **same class of bug** as the discount-snapshot one fixed earlier in this same function.

---

## What changed

1. The rebuild now **carries forward** `costPrice`, `batchAllocations`, `gstRate` and `iId` from the
   line's sale-time snapshot, exactly like `salePrice` and the discount fields already were.
2. **Carried, never recalculated.** The edit does **not** re-price the cost against today's item
   master. If we bought that oil at ₹170 in August, the August order keeps saying ₹170 even if the
   price is ₹190 today.
3. A **newly added** line (an item that was not on the order before) has no snapshot to carry, so its
   cost is seeded from the item master at that moment. Previously it would have been saved as cost 0
   and silently dropped out of margin.
4. **Free gift lines** now also carry `iId`, `gstRate` and `batchAllocations` — that branch was
   forwarding only `costPrice`.

### One deliberate limitation (worth knowing before you test)

For the line whose **quantity actually changed**, `batchAllocations` is **kept as it was** and not
re-calculated. The real stock ledger *is* moved correctly, but it does not report back which batches
it took. So after a quantity change, that one line's batch list can show a unit count that no longer
matches the new quantity.

Concrete: oil goes 1 → 2, the batch row still says `qty: 1`. The **cost price is right**, the
**profit number is right**, only the batch breakdown on that one line is incomplete. This is a
deliberate follow-up, not an oversight — fixing it properly is an inventory-accounting change.
It is still far better than the old behaviour, which deleted the batch list entirely.

---

## How to test

Do this on **dev** (`damin.haper.in`) after the backend redeploy.

### ✅ 1. Edit an order — untouched lines keep their cost

1. Place a test order with **two different items** (both must have a cost price set in the catalog).
2. Admin → **Orders** → open it → **Edit Order**.
3. Change **only the first item's quantity** (e.g. 1 → 2). Leave the second alone. Save.
4. Open **Profits** (or check the order record) for that order.

**Expected:** profit for the order is still sensible — cost is deducted, not zero. The second item's
cost, GST rate and product code are unchanged.
**❌ Bug behaviour:** profit equals the full sale value, as if the goods were free.

### ✅ 2. Add an item to an existing order

1. Edit the same order and **add a third item**. Save.

**Expected:** the two original lines keep their original cost. The new line picks up the current
catalog cost — **not** 0.

### ✅ 3. Remove an item from an order

1. Edit and **remove** one line. Save.

**Expected:** the surviving line keeps its cost, batch list, GST rate and product code exactly.

### ✅ 4. Picker: mark an item out of stock

1. Place an order, let it reach the picker app, **mark one item out of stock**.

**Expected:** the customer is refunded for that item as before **and** the remaining items keep their
cost data. This is the most common path — it happens without any admin involvement.

### ✅ 5. Picker: short pick

1. On a line with quantity 3, pick only 2 and confirm the short pick.

**Expected:** order value drops correctly, and cost data on all lines survives.

### ✅ 6. Free gift order

1. Place an order that qualifies for a **free gift**, then edit it (change any quantity, keeping it
   above the gift threshold).

**Expected:** the gift line is still attached, still ₹0 to the customer, and still carries its cost
(a free gift costs us money — it must show in COGS).

---

## Edge cases

| Case | Expected |
|---|---|
| Same item appears twice on one order | Lines are merged; the merged line keeps the **first** line's cost, matching how salePrice and discounts already merge |
| Edit an order that was created **before** this fix, with cost already zeroed | Cost stays 0 — **this fix stops new damage, it does not repair old orders** (see below) |
| Store with batch tracking **off** | `batchAllocations` is empty both before and after — nothing to carry, no change |
| Quantity changed on a line | `costPrice` correct; that line's batch breakdown may not add up to the new quantity (known limitation above) |
| Line removed entirely | Line disappears; no orphan cost data left behind |

---

## Not covered by this fix (follow-ups)

1. **Already-damaged historical orders.** Any order edited before this deploy still has cost 0 and no
   batch trail. Reported profit for those days is over-stated. Repairing them needs a separate
   backfill decision — the sale-time cost is genuinely lost and would have to be estimated from the
   item master or the goods-receipt history. **Not** attempted here.
2. **Exact batch re-allocation on a quantity change** (the known limitation above).
