# Centralized Inventory (Phase 1) — End-to-End Test Guide

This guide walks through testing the warehouse supply layer from the **admin panel**,
in order, with what to add, when, and what each role can do.

Flow being tested:

```
Supplier ──▶ Warehouse ──▶ (transfer) ──▶ Store ──▶ Customer
            goods receipt   dispatch/receive   existing sale
```

Everything sits **underneath** the existing per-store `items.quantity`. Customer /
picker / delivery apps are unchanged. Store stock only changes on **goods receipt
→ transfer receipt** (and existing sales), never when a transfer is merely created
or dispatched.

---

## 0. Prerequisites (one-time)

1. **Deploy the feature branch backend** (`feat/centralized-inventory-phase1`) to the dev
   server, and point the admin app's `VITE_API_URL` at that API.
   - If the new screens 404 on every call, the backend branch isn't deployed yet.
2. **Pull the admin feature branch** (`feat/centralized-inventory-phase1`) and run/deploy it.
3. Log in as a **super admin** for the warehouse-side setup (warehouse/supplier/goods
   receipt/transfers/approvals). Use a **store admin** to test the store-side actions.

> **Note on warehouse roles:** `warehouse_manager` / `warehouse_staff` can now be
> created from the admin panel — **Sidebar → Warehouse Staff** (super admin only).
> You can also just use a **super admin** for all warehouse-side actions during
> testing. (A DB-seed alternative is in the appendix, but the UI is the real path.)

---

## Role capabilities at a glance

| Capability | Super admin | Store admin | Warehouse manager/staff |
|---|---|---|---|
| Warehouses (CRUD) + stock view | ✅ | ❌ (nav hidden) | ✅ (their warehouse) |
| Suppliers (CRUD) | ✅ | ❌ | ✅ |
| Goods receipt (stock in to warehouse) | ✅ | ❌ | ✅ |
| Create / dispatch / cancel transfer | ✅ | ❌ | ✅ |
| **Receive** transfer (into store) | ✅ | ✅ | ❌ |
| Raise replenishment request | ✅ | ✅ | ❌ |
| Approve / reject / fulfil replenishment | ✅ | ❌ | ✅ |
| Stock Ledger | ✅ (all) | ✅ (own store) | ✅ (their warehouse) |
| Manual "Stock In" on an item (Items page) | ✅ | ✅ | — |
| Manage warehouse staff (Warehouse Staff page) | ✅ | ❌ | ❌ |

The **top store-switcher** sets the **target store** for creating transfers and raising
replenishment requests. Pick the store there first.

---

## 1. Create a warehouse  *(super admin)*

1. Sidebar → **Warehouses** → **+ New warehouse**.
2. Fill: **Name** (e.g. `Patna WH`), **Region** = `Bihar` (important — used for
   replenishment routing), optional Code/address/phone.
3. Save.

✅ Expect: warehouse appears in the left list. Click it → empty stock panel on the right.
❌ Try creating a second warehouse with the **same name** → red "already exists" error.

---

## 1b. (Optional) Create warehouse staff  *(super admin)*

If you want to test **role separation** (a warehouse manager who only sees the
warehouse screens), create one now — no DB poking needed.

1. Sidebar → **Warehouse Staff** → **+ New staff**.
2. Pick **Role** (Warehouse Manager = full warehouse control; Warehouse Staff =
   receive + transfers only), pick the **Warehouse**, set name/email/password.
3. Save. The role's permissions are assigned automatically.
4. Log in as that account → ✅ sees only **Warehouses / Suppliers / Transfers /
   Replenishment (approvals) / Ledger** for their warehouse; cannot see stores,
   orders, etc. (Deactivate/reactivate from the same page.)

---

## 2. Create a supplier  *(super admin)*

1. Sidebar → **Suppliers** → **+ New supplier**.
2. Fill **Name** (e.g. `ACME Distributors`), optional contact/mobile/GSTIN.
3. Save. ✅ Appears in the list.

---

## 3. Receive goods into the warehouse  *(super admin)*

This is procurement — it puts stock into the warehouse.

1. Sidebar → **Warehouses** → select your warehouse → **+ Receive goods**.
2. (Optional) Invoice number.
3. Add a line:
   - **SKU/Barcode** → use a value you will also set as a store item's barcode, e.g. `PB001`.
   - **Name** (e.g. `Peanut Butter 500g`), **Cost**, **Qty** (e.g. `100`).
4. **Receive**.

✅ Expect: warehouse stock table shows `PB001 … Available 100`.
✅ Receive the **same SKU again** (e.g. 50) → quantity becomes **150** (no duplicate row).
✅ Sidebar → **Stock Ledger** → a `PURCHASE_IN` row, `+100` then `+50`.

> **Key rule:** the warehouse SKU must equal the **barcode** of the store item you'll
> transfer to (that's how the two locations are linked). Set that up in step 4.

---

## 4. Prepare a store item with a barcode  *(super admin or store admin)*

A transfer line needs a store item whose **barcode = the warehouse SKU**.

1. Pick the target store in the **store-switcher**.
2. Sidebar → **Items** → edit (or create) an item, e.g. `Peanut Butter 500g`.
3. Set its **Barcode** = `PB001` (same as the warehouse SKU). Note its current quantity (e.g. `5`).

---

## 5. Configure the store for supply  *(super admin)*

1. Sidebar → **Stores** → edit your store → **Inventory supply** section:
   - **Region / State** = `Bihar` (must match the warehouse region for auto-routing), OR
   - **Serving warehouse** = pick your warehouse directly.
   - (Optional) tick **Warehouse supply enabled**.
2. Save.

This is what lets a replenishment request find its warehouse automatically.

---

## 6. Transfer: create → dispatch → receive  *(the core test)*

**Create (super admin):**
1. Store-switcher = target store. Sidebar → **Transfers** → **+ New transfer**.
2. **Source warehouse** = your warehouse.
3. Search the store item (`Peanut Butter`) → it's added as a line → set **Qty** = `20`.
4. **Create transfer**. ✅ Status = **CREATED**. No stock has moved yet.

**Dispatch (super admin):**
5. On the transfer row → **Dispatch**.
   - ✅ Warehouse stock drops `150 → 130` (Warehouses → stock).
   - ✅ **Store item quantity is UNCHANGED** (still `5` in Items) — *this is the rule #7 check*.
   - ✅ Status = **DISPATCHED**.

**Receive (super admin or store admin):**
6. On the transfer row → **Receive**.
   - ✅ Store item quantity rises `5 → 25` (Items).
   - ✅ Status = **RECEIVED**.
7. Sidebar → **Stock Ledger** → a `TRANSFER_OUT` (−20, warehouse) and `TRANSFER_IN` (+20, store).

---

## 7. Replenishment: request → approve → fulfil → receive

**Request (store admin or super admin):**
1. Store-switcher = the store. Sidebar → **Replenishment** → **+ Request stock**.
2. Search the item → set **Requested qty** (e.g. `30`) → **Raise request**.
   - ✅ Status = **PENDING**. (If you get "no serving warehouse", finish step 5 first.)

**Approve + fulfil (super admin):**
3. On the request row → **Approve** → status **APPROVED**.
4. → **Fulfil → transfer** → a new transfer (CREATED) is created and linked.

**Move the stock:**
5. Sidebar → **Transfers** → find that transfer → **Dispatch** → then **Receive**.
   - ✅ The replenishment request flips to **FULFILLED**.
   - ✅ Store item quantity rises by the approved qty.

---

## 7b. Automatic replenishment (cron)

The system can **auto-draft** replenishment requests for low stock — you don't
have to click "Request stock" manually. It only **drafts** a PENDING request;
the warehouse still reviews/approves/fulfils (it never ships stock on its own).

**How it works**
- An **hourly cron** (`auto-replenishment`, runs at :30 IST) scans every
  **warehouse-enabled** store.
- For each store it finds items at/below their **low-stock threshold**
  (`quantity ≤ lowQty`, with `lowQty > 0`).
- It resolves the store's **serving warehouse** (by `servingWarehouseId`, else
  region match) and creates **one** request with `source = AUTO`, `status =
  PENDING`.
- **Requested qty** per item = `reorderQty` if set → else top-up to `maxStock`
  (`maxStock − quantity`) → else enough to clear the threshold.
- **Idempotent:** items already on an open request (PENDING/APPROVED/
  PARTIALLY_APPROVED) are skipped, so it won't pile up duplicates each hour.
- **Skipped:** stores not warehouse-enabled, stores with no serving warehouse,
  and items **without a barcode** (a SKU is required to match warehouse stock).

> Note: low-stock **alerts** (push/email + 9 AM digest) are a *separate* system
> that only notifies. Auto-replenishment is what actually drafts the request.

**How to test**
1. Pick a store, **Stores → edit → Inventory supply**: tick **Warehouse supply
   enabled** and set **Region** (or a serving warehouse) — see step 5 above.
2. Make sure an item in that store has a **barcode** and set its **lowQty** above
   its current **quantity** (e.g. quantity 2, lowQty 10). Optionally set
   `reorderQty`/`maxStock` (edit item).
3. Wait for the hourly run, **or** trigger it manually to test immediately:
   - On the server: `node -e "require('./packages/cron/src/jobs/auto-replenishment')()"`
     from `haper-backend` (uses the same env/DB as the cron service), or
   - temporarily change the schedule in `packages/cron/src/scheduler.js` to
     `'* * * * *'` (every minute) on the dev box.
4. Go to **Replenishment** → a new **PENDING** request with **source AUTO**
   should appear for that store. Approve → Fulfil → Dispatch → Receive as usual.
5. Re-run the cron → ✅ no duplicate request for the same item.

---

## 8. Manual "Stock In" now writes to the ledger  *(super admin or store admin)*

1. Sidebar → **Items** → an item → adjust quantity ("Stock In"), e.g. +15.
2. Sidebar → **Stock Ledger** → a `MANUAL_ADJUST` row with the delta and resulting balance.

---

## 9. Negative / edge cases to confirm

- **Insufficient warehouse stock:** create a transfer for more than the warehouse has →
  **Dispatch** → ✅ 400 error, warehouse stock untouched.
- **Cancel a dispatched transfer:** Transfers → a DISPATCHED transfer → **Cancel** →
  ✅ warehouse stock is returned; status **CANCELLED**.
- **Item without a barcode:** try to add an item with no barcode to a transfer →
  ✅ rejected ("enroll a barcode first").
- **Reject / cancel replenishment:** reject a PENDING request (warehouse side) or cancel
  your own PENDING request (store side).

---

## 10. Role separation checks

Log in as a **store admin** and confirm:
- ✅ Sidebar does **not** show *Warehouses* or *Suppliers*.
- ✅ *Transfers* shows only the **Receive** action (no New/Dispatch/Cancel).
- ✅ *Replenishment* shows **Request stock** + **Cancel** (no Approve/Fulfil).
- ✅ *Stock Ledger* shows only this store's movements.

Log in as **super admin** and confirm all actions are available and the ledger can be
filtered across warehouses/stores.

---

## 11. Supply health & data-quality checks  *(super admin / warehouse roles)*

These four low-risk safeguards surface multi-store supply problems that were
previously silent. (Stop-gaps ahead of the bigger catalog/warehouse-master rework.)

1. **Routing health (no serving warehouse).** Sidebar → **Warehouses**. If any
   `warehouse supply enabled` store can't resolve a serving warehouse, a yellow
   banner lists them ("⚠ N warehouse-enabled stores can't reach a warehouse").
   - Test: turn on warehouse supply for a store but give it a region no warehouse
     matches (and no serving warehouse) → it appears in the banner. Set a serving
     warehouse (or matching region) → banner clears. Backend: `GET /admin/warehouse/routing-health`.

2. **Region match is case-insensitive.** Auto-replenishment routing now matches
   region trimmed + case-insensitively, so a store region `"bihar"` resolves a
   warehouse region `"Bihar"`. (Previously a casing mismatch silently skipped the store.)

3. **Missing-barcode report.** Sidebar → **Items** → **Missing Barcode** toggle →
   lists items with no barcode. These **cannot be replenished** from the warehouse
   (no SKU to match), so they need a barcode enrolled. Backend filter:
   `GET /admin/item/catalog?missingBarcode=true`.

4. **Free-to-promise on approve.** Replenishment → **Approve** a request → the modal
   now shows **Avail**, **Committed** (already approved on other open requests, not yet
   dispatched), and **Free** = Avail − Committed, with a warning if you approve beyond
   Free. "Fill to free" caps each line at free-to-promise. Backend:
   `GET /admin/replenishment/committed?warehouseId=…`.
   - Test: approve request A for 20 of SKU X (don't fulfil) → open request B for SKU X →
     its **Committed** shows 20 and **Free** = Avail − 20. Fulfil A → B's Committed drops.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every warehouse call 404s | Backend feature branch not deployed to the dev API |
| "No serving warehouse — provide warehouseId" on Approve | Store's region/serving warehouse not set (step 5) |
| "…has no barcode/SKU — enroll one" on transfer create | Store item missing a barcode (step 4) |
| Dispatch returns 400 "Insufficient warehouse stock" | Receive goods first / qty too high (expected for the edge test) |
| 403 on a warehouse action | Logged in as store admin (warehouse actions are super/warehouse-role only) |
| Store stock didn't change after Dispatch | Correct — store stock only rises on **Receive** (rule #7) |

---

## Appendix — (alternative) seed a warehouse manager via DB

Prefer the **Warehouse Staff** page (§1b) — it's the supported path. This DB
snippet is only a fallback (e.g. scripting/bulk seed), pointing at an existing
warehouse `_id`:

```js
// password will be hashed by the schema pre-save hook only via the app;
// for a quick test, create through the app's admin creation flow if available,
// or copy an existing admin doc and set:
db.admins.updateOne(
  { email: "wh.manager@example.com" },
  { $set: {
      roles: ["warehouse_manager"],
      warehouseId: ObjectId("<WAREHOUSE_ID>"),
      permissions: [
        "warehouse.manage", "warehouse.manage_suppliers", "warehouse.receive_goods",
        "warehouse.manage_transfers", "warehouse.approve_replenishment", "warehouse.view_ledger"
      ],
      status: 1
  } },
  { upsert: false }
);
```

A `warehouse_manager` logs into the same admin panel and sees only the warehouse-side
screens (Warehouses, Suppliers, Transfers, Replenishment approvals, Ledger) for **their**
warehouse.
