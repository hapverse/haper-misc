# Inventory — End-to-End Test Guide (from an empty system)

A single **sequential** walkthrough for the tester. You start with **nothing** — no
warehouse, no store, no catalogue — and build it up in order. Each step says **who**
does it, **what to do**, and **what to expect**. The `(CH-n)` tags map a step to the
inventory-v2 change it exercises; you can ignore them while testing.

Everything is done in the **admin panel**. **Customer / picker / delivery apps are
NOT affected** by these admin changes — there's nothing to check in those apps.

**Golden rule of stock movement:** store stock only changes on a **Stock-In/Adjust**,
on a **transfer Receive**, or on a **sale**. Creating or dispatching a transfer does
**not** change store stock — only **Receive** does.

---

## 0. Prerequisites (read once)

1. **Backend** = branch `feat/inventory-v2` (haper-backend), deployed + migrated on
   **dev (`dapi.haper.in`)**. The admin app's `VITE_API_URL` must point at it.
   - ⚠️ **Two behaviours need a fresh redeploy of `feat/inventory-v2`** to show on dev:
     **(CH-1)** the category **On/Off state** shown on load, and **(CH-7)** the server
     **rejecting a store created without an active serving warehouse**. If those two
     seem to "do nothing", the backend just needs redeploying. Everything else works
     on the current dev backend.
2. **Admin** = branch `feat/inventory-v2-admin` (haper-admin, PR #67 into `dev`).
   Pull / run / deploy it, then log in.
3. **Log in as a SUPER ADMIN.** You'll create everything else (warehouse, store,
   store admin, catalogue) from here. A few steps are repeated as a **store admin**
   to check the per-store views.
4. The **top store-switcher** sets the active store. **"All Stores"** (super admin
   only) is the cross-store view some reports use.

> **Batch tracking flags (ops):** the warehouse/store *batch* features (real dated
> lots, recall tracing, FEFO) fully light up only once ops turn on
> `warehouse.batchesEnabled` / `store.config.batchesEnabled`. The batch **fields and
> columns are visible regardless**; with the flag off, stock behaves as one combined
> "legacy" lot. Ask the dev/ops person to enable the flags on your test warehouse +
> store if you want to see real per-batch behaviour.

---

## Role capabilities at a glance

| Capability | Super admin | Store admin | Warehouse mgr/staff |
|---|---|---|---|
| Categories / sub-categories **CRUD** (CH-1) | ✅ | ❌ (per-store on/off only) | ❌ |
| Per-store category **On/Off** (CH-1) | ✅ (in a store) | ✅ | ❌ |
| **Product Master** + Assign (CH-6) | ✅ | ❌ | ❌ |
| Item per-store fields (price/stock/barcode) | ✅ | ✅ | — |
| Item catalogue fields (name/brand/GST…) (CH-6) | ✅ (edits all stores) | ❌ (read-only) | — |
| Warehouses + stock view, suppliers, goods receipt | ✅ | ❌ | ✅ |
| Create/dispatch/cancel transfer | ✅ | ❌ | ✅ |
| **Receive** transfer (into store) | ✅ | ✅ | ❌ |
| Replenishment: request | ✅ | ✅ | ❌ |
| Replenishment: approve/reject/fulfil (CH-4) | ✅ | ❌ | ✅ |
| **Batch Recall** trace / Hold-Recall (CH-3) | ✅ | trace only | ✅ |
| Stores + Store Admins + serving warehouse (CH-7) | ✅ | ❌ | ❌ |
| Reports: Profits, **Product COGS** (CH-5) | ✅ | ❌ (revenue-gated) | ❌ |

---

# The sequential walkthrough

## 1. Create a warehouse  *(super admin)*

Stores can't be created without a warehouse (CH-7), so build this first.

1. Sidebar → **Warehouses** → **+ New warehouse**.
2. Name (e.g. `Patna WH`), **Region** = `Bihar`, optional code/address.
3. Save.

✅ Appears in the left list; clicking it shows an empty stock panel.
❌ A second warehouse with the **same name** → red "already exists" error.

### 1b. (Optional) Create a warehouse staff account — to test role separation
Sidebar → **Warehouse Staff** → **+ New staff** → pick role (Warehouse Manager =
full warehouse control; Warehouse Staff = receive + transfers) + the warehouse +
name/email/password. Log in as them later → they see only the warehouse screens.

---

## 2. Create a supplier  *(super admin)*

Sidebar → **Suppliers** → **+ New supplier** → name (e.g. `ACME Distributors`),
optional contact/GSTIN → Save. ✅ Appears in the list.

---

## 3. Receive goods into the warehouse — with a batch no.  *(super admin)*  (CH-3)

This puts stock into the warehouse.

1. Sidebar → **Warehouses** → select the warehouse → **+ Receive goods**.
2. (Optional) supplier + invoice number.
3. Add a line:
   - **SKU/Barcode** — a code you'll also set as the store item's barcode, e.g. `PB001`.
   - **Name** (e.g. `Peanut Butter 500g`), **Batch no.** (leave blank = auto, or type
     the supplier's, e.g. `LOT-A`), **Cost / unit**, **Expiry**, **Qty** (e.g. `100`).
4. **Receive**.

✅ Warehouse stock shows `PB001 … Available 100`.
✅ Receive the **same SKU + same batch no.** again (e.g. 50) → quantity becomes **150**
   (merged into the lot, no duplicate).
✅ Stock table columns: **Available / Reserved / In-transit / Free-to-promise** (CH-4)
   — at this point Reserved = In-transit = 0, Free-to-promise = Available. Hover the
   **Cost/unit** header → "weighted average of open lots"; **Expiry** → "earliest open
   lot" (CH-3).
✅ Sidebar → **Stock Ledger** → a `PURCHASE_IN` row with a **Batch** column.

> **Link rule (for transfers later):** the warehouse **SKU** must equal the **barcode**
> of the store item you'll transfer to. Keep `PB001` handy.

---

## 4. Build the shared catalogue  *(super admin)*

Categories, sub-categories and products are now **one shared list for the whole
company** — not per store.

### 4a. Categories + sub-categories  (CH-1)
1. Sidebar → **Categories**.
2. **+ Add Category** → name (e.g. `Grocery`), icon → Save.
   ✅ It's a **single create** — there is **no "store / add-to-all-stores" picker**
   (categories are global now).
3. **+ Add Sub-Category** → name (e.g. `Spreads`), pick **parent category** `Grocery`
   → Save.
4. ✅ As super admin you can **Rename / Delete / activate** categories & sub-categories.
✅ Each category row shows a per-store **item count** (0 for now — nothing stocked yet).

### 4b. Product Master  (CH-6)
1. Sidebar → **Product Master** → **+ New product**.
2. Fill: **Name** (`Peanut Butter 500g`), **Unit** (`unit(s)`), brand, **Category** =
   `Grocery`, **Sub-category** = `Spreads`, GST, barcode = `PB001`, image URL(s) → Create.
   ✅ It appears in the product list with a generated product id (`iId`).
3. (Fan-out check) Edit the product's name/brand and Save → ✅ toast "synced N store
   item(s)" (N = how many stores already carry it; 0 right now).

> Products may already exist on dev (migrated from existing items). Either create a
> fresh one as above, or just use an existing product for the next steps.

---

## 5. Create a store — serving warehouse is REQUIRED  *(super admin)*  (CH-7)

1. Sidebar → **Stores** → **+ Add New Store**.
2. Fill name/phone/email/address/map link/lat/long/GSTIN.
3. **Inventory supply → Serving warehouse** = your warehouse. **This is required.**
   - The **Owner** field is **optional** (leave it blank — see the note below).
   - **Region** is now just a fallback label.
4. Save.

✅ Saves with a serving warehouse chosen.
❌ Try to save with **no serving warehouse** → blocked (and once the CH-7 backend is
   redeployed, the server also rejects it).

> **No chicken-and-egg:** a store does **not** need a store admin to be created, so
> always make the **store first**, then its admin (next step). The Owner field being
> optional is what breaks the old "store needs admin / admin needs store" loop.

---

## 6. Create the store's admin  *(super admin)*

1. Sidebar → **Store Admins** → **+ New** → name/email/password → **Assigned Store** =
   the store you just made → Create.
2. ✅ If **no stores existed yet**, the store dropdown is **disabled** with a hint
   ("create a store first") — confirming the correct order.
3. Log in as this store admin in a separate browser/profile for the per-store checks
   (steps 9, and the item per-store view in step 8).

---

## 7. Put products into the store (onboarding)  *(super admin)*  (CH-6)

A new store starts with **zero items**. You add them from the Product Master.

1. Sidebar → **Product Master** → find `Peanut Butter 500g` → **Assign**.
2. Choose **All stores** *or* **Pick stores** → select the new store. Set a **Price /
   Selling price / Low-stock qty** → **Assign**.
3. ✅ A result line shows **assigned / skipped / failed** (e.g. "Assigned 1, skipped 0").
4. Sidebar → **Items** (with the new store selected in the switcher) → ✅ the item
   appears at **quantity 0**, with the catalogue details copied from the master and the
   **Grocery → Spreads** category.
5. ✅ Re-run Assign for the same product/store → it's **skipped** (idempotent).

---

## 8. Stock the store

You can add stock two ways — test both.

### 8a. Manual Stock-In / Adjust-down  *(super admin or store admin)*  (CH-2)
1. Sidebar → **Items** → the item → **Stock adjust**.
2. **Stock In (add):** enter a quantity (e.g. `20`); optionally a **Batch no.**,
   **Cost/unit** (super admin only) and **Expiry** → Save.
   ✅ Quantity rises (0 → 20); a toast shows the new total.
3. **Adjust down (remove):** switch to *Adjust down*, enter a quantity.
   ✅ Entering **more than current stock** disables the button with a warning. A normal
   reduction lowers the quantity. (If stock changed underneath you and the server
   rejects it, you get a clear **"exceeds available stock"** toast.)

### 8b. Bring stock from the warehouse (transfer)  *(super admin)*  (CH-3, CH-4)
First make the link: **Items → the item → set Barcode = `PB001`** (same as the warehouse SKU).
1. Store-switcher = the store. Sidebar → **Transfers** → **+ New transfer**.
2. **Source warehouse** = your warehouse → search the item → set **Qty** `30` → **Create transfer**.
   ✅ Status **CREATED**; no stock moved yet.
3. **Dispatch** the transfer.
   ✅ Warehouse **Available** drops by 30; **store item quantity is unchanged** (golden rule).
   ✅ Expand the transfer → each line shows **Batches (shipped)** (the lots that went out) (CH-3).
4. **Receive** the transfer.
   ✅ Store item quantity rises by 30; the lot's real cost + expiry flow into the store.
5. **Stock Ledger** → a `TRANSFER_OUT` (warehouse, −30) and `TRANSFER_IN` (store, +30),
   both with the **Batch** column populated.

---

## 9. Per-store category On/Off  *(store admin)*  (CH-1)

Log in as the **store admin** from step 6.

1. Sidebar → **Categories**.
   ✅ **No** Create / Edit / Delete buttons (head office owns the catalogue).
   ✅ Each category shows an **On / Off** switch + a short hint + the store's item count.
2. Turn `Grocery` **Off** → ✅ customers of this store stop seeing it (and its items).
   Turn it back **On** → it reappears. The category itself is never deleted.
   - ⚠️ The switch reflecting the *saved* state on reload needs the CH-1 backend
     redeploy; *setting* it works regardless.

---

## 10. Replenishment — request → approve → fulfil → receive  (CH-4)

**Request  *(store admin)*:**
1. Store-switcher = the store. Sidebar → **Replenishment** → **+ Request stock** →
   search the item → **Requested qty** `40` → **Raise request**. ✅ Status **PENDING**.

**Approve  *(super admin / warehouse)*:**
2. Open the request → **Approve**. The modal shows per line: **Avail**, **Reserved**,
   and **Free** (= Avail − Reserved).
   ❌ Set an approve qty **above Free** → the server **rejects it** with a clear message
   and the modal stays open (CH-4).
   ✅ Approve **within Free** → status **APPROVED**; back on **Warehouses → stock** the
   item's **Reserved** rises by the approved qty and **Free-to-promise** drops.
3. **Fulfil → transfer** → a linked transfer (CREATED) is created.

**Move it:**
4. Sidebar → **Transfers** → that transfer → **Dispatch** (warehouse Reserved →
   **In-transit**) → **Receive** (In-transit → store stock).
   ✅ The request flips to **FULFILLED**; store quantity rises.

✅ **Status legends:** on Replenishment / Transfers / Warehouse stock, open the
   collapsible **"What do these mean?"** — every status (PENDING/APPROVED/…/**EXPIRED**,
   CREATED/DISPATCHED/RECEIVED/CANCELLED, Available/Reserved/In-transit, batch
   AVAILABLE/HOLD/RECALL) has a plain-English explanation.

> **EXPIRED (CH-4):** if an approved request isn't shipped within the window, a nightly
> job auto-releases the reservation and marks it **EXPIRED** (re-raisable). To see it
> without waiting, ask dev to run the `inventory-reservation-expiry` cron manually.

---

## 11. Batch Recall  *(super admin / warehouse)*  (CH-3)

1. Sidebar → **Batch Recall** → type the batch no. from step 3 (e.g. `LOT-A`) → **Trace**.
   ✅ It lists every **warehouse** and **store** holding that lot, with quantities + status.
2. With warehouse-manage rights, each row has **Hold / Recall / Release** buttons → set
   one to **Recall** → ✅ its status pill turns red; the lot is blocked from sale/dispatch.
   A legend explains AVAILABLE / HOLD / RECALL.
   - (Real cross-location results require the batch flags enabled — see Prerequisites.)

---

## 12. Reports  *(super admin)*  (CH-5)

After a few **sales** exist in the store (place test orders, or use POS → New Sale):

1. Sidebar → **Profits**.
   ✅ The **margin %** is computed over **cost-known revenue** (it no longer shows a fake
   0% for items whose cost is unknown). When some revenue has no known cost, you see
   **"₹X revenue has unknown cost — excluded from margin"**.
2. Sidebar → **Product COGS**.
   ✅ A per-product table: units, revenue, **COGS**, gross profit, **margin %**, and
   **cost-unknown units** (highlighted). With a store selected → that store; switch to
   **All Stores** → the same product is **merged across stores**.
3. Sidebar → **Most Sold** → in **All Stores** mode there's a **"Merge same product
   across stores"** toggle.

---

## 13. Role-separation checks

**Store admin** should see:
- ✅ Categories with **On/Off only** (no CRUD); **no** Product Master / Warehouses /
  Suppliers / Store Admins / Profits / Product COGS in the sidebar.
- ✅ Items: can edit price/stock/barcode/location; catalogue fields (name/brand/category/
  GST/…) are **read-only/greyed** with an explainer (CH-6).
- ✅ Transfers: only **Receive**; Replenishment: **Request** + **Cancel** (no Approve/Fulfil).

**Super admin** should see all of the above as editable; editing a product's catalogue
fields warns it **updates every store**.

---

## 14. Negative / edge cases to confirm

- **Store create with no serving warehouse** → blocked (CH-7).
- **Approve beyond free-to-promise** → server 400, modal stays open (CH-4).
- **Adjust-down beyond stock** → button disabled / "exceeds available stock" (CH-2).
- **Insufficient warehouse stock on Dispatch** → 400, warehouse stock untouched.
- **Cancel a dispatched transfer** → warehouse stock returned; In-transit cleared; status CANCELLED.
- **Transfer line with no barcode** → rejected ("enroll a barcode first").
- **Edit a category as a store admin** → no edit controls (only On/Off).
- **Edit catalogue fields on an item as a store admin** → read-only (CH-6).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every warehouse/product call 404s | Backend `feat/inventory-v2` not deployed to the dev API |
| Category On/Off doesn't "stick" on reload | CH-1 backend not **redeployed** yet (Prerequisites) |
| Store saves even with no serving warehouse | CH-7 backend not **redeployed** yet (the UI still requires it) |
| Batch Recall finds nothing / shows one "legacy" lot | Batch flags not enabled on that warehouse/store (ops) |
| "No serving warehouse" on Approve/Replenishment | Store's serving warehouse not set (step 5) |
| "…has no barcode/SKU" on transfer create | Store item missing a barcode = warehouse SKU (step 8b) |
| 403 on a warehouse/product-master action | Logged in as store admin (those are super/warehouse-only) |
| Store stock didn't change after Dispatch | Correct — store stock only rises on **Receive** |

---

## Appendix — auto-replenishment (optional)

The system can **auto-draft** PENDING replenishment requests for low stock (hourly
`auto-replenishment` cron) for warehouse-enabled stores with a resolvable serving
warehouse; it only drafts — the warehouse still approves/fulfils. Items at/below
`lowQty` (with a barcode) get a `source = AUTO` request. To test: set an item's
`lowQty` above its quantity, ensure the store has a serving warehouse + the item has a
barcode, then wait for the hourly run (or ask dev to trigger the cron) → a PENDING
**AUTO** request appears under Replenishment. Re-running won't duplicate an open request.

## Appendix — seed a warehouse manager via DB (fallback)

Prefer the **Warehouse Staff** page (§1b). DB fallback (point at an existing warehouse `_id`):

```js
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
