# Inventory — End-to-End Test Guide (from an empty system)

A single **sequential** walkthrough for the tester. You start with **nothing** — no
warehouse, no store, no catalogue — and build it up in order. Each step says **who**
does it, **what to do**, and **what to expect**. The `(CH-n)` tags map a step to the
inventory-v2 change it exercises; you can ignore them while testing.

Everything here is done in the **admin panel**. The **admin changes don't change the
customer / picker / delivery apps**, so there's nothing to check in those apps *for this
guide*. (The apps' own inventory-v2 items — order decoding stays safe, and the
store-switch cart now resets cleanly — are a separate, minimal checklist in
`client-followups.md`; only the **customer app** has any real change.)

> **Picker app** changes (scan-gate, OOS reasons, in-app scanner + torch, scan-anything,
> undo a pick, partial pick, urgency timer) have their **own** end-to-end guide:
> **`test-picking.md`** — run that on the Android picker app. To exercise it a store needs
> **picking enabled**: top store-switcher → the store → sidebar **Settings → App/Store
> Config → "Picker Workflow" → "Enable picking" → Save Store Settings**.

**Golden rule of stock movement:** store stock only changes on a **Stock-In/Adjust**,
on a **transfer Receive**, or on a **sale**. Creating or dispatching a transfer does
**not** change store stock — only **Receive** does.

---

## 0. Prerequisites (read once)

1. **Backend** = branch `feat/inventory-v2` (haper-backend), **deployed + migrated and
   live on dev (`dapi.haper.in`)** — this now includes the late **CH-1**
   (`enabledForStore`) and **CH-7** (serving-warehouse enforcement) additions **and** the
   B-series + warehouse-cockpit endpoints. The admin app's `VITE_API_URL` must point at it.
   - (If a brand-new behaviour below seems to "do nothing", the dev box may just be a build
     behind — pull / redeploy latest `feat/inventory-v2`.)
2. **Admin** = haper-admin on `dev` with **PR #67** (inventory-v2 admin) **and PR #68**
   (`feat/inventory-v2-admin-gaps`) merged — the **batch-tracking toggle (B1)**, warehouse
   **write-off**, **reorder policy**, **push-transfer**, and the whole **§15 warehouse
   cockpit** are on PR #68. Pull / run / deploy it, then log in.
3. **Log in as a SUPER ADMIN.** You'll create everything else (warehouse, store,
   store admin, catalogue) from here. A few steps are repeated as a **store admin**
   to check the per-store views.
4. The **top store-switcher** sets the active store. **"All Stores"** (super admin
   only) is the cross-store view some reports use.

> **Batch tracking (now self-serve — B1):** the warehouse/store *batch* features (real
> dated lots, recall tracing, FEFO, per-lot cost/expiry) fully light up once **batch
> tracking is ON**. A **super admin** now flips this **from the UI** — no ops/DB step:
> - **Warehouse form** (Warehouses → New/Edit) → **"Batch tracking (FEFO + per-lot
>   cost/expiry)"** checkbox.
> - **Store edit modal** (Stores → Edit) → **"Batch tracking …"** checkbox.
>
> **Enabling seeds existing stock automatically**, so it's safe to turn on at any time
> (the first sale/dispatch won't fail). The batch **fields and columns are visible
> regardless**; with tracking **off**, stock behaves as one combined "legacy" lot.
> Turn it **on** for your test warehouse + store to see real per-batch behaviour.

---

## Role capabilities at a glance

> **What changed this round (warehouse-manager pass):** rows tagged **#n** are new/changed
> warehouse-role capabilities — a real **Warehouse dashboard**, **Stock Health**, **Item Lookup**,
> warehouse **write-off** + **reorder policy**, a working **push-transfer** (target-store picker),
> **reject with a reason**, and **staff** can finally view warehouses + receive. Full walkthrough in **§15**.

| Capability | Super admin | Store admin | Warehouse mgr | Warehouse staff |
|---|---|---|---|---|
| Categories / sub-categories **CRUD** (CH-1) | ✅ | ❌ (on/off only) | ❌ | ❌ |
| Per-store category **On/Off** (CH-1) | ✅ (in a store) | ✅ | ❌ | ❌ |
| **Product Master** + Assign (CH-6) | ✅ | ❌ | ❌ | ❌ |
| Item per-store fields (price/stock/barcode) | ✅ | ✅ | — | — |
| Item catalogue fields (name/brand/GST…) (CH-6) | ✅ (all stores) | ❌ (read-only) | — | — |
| **Warehouse dashboard** (home, real counts) — #1 | ✅ | ❌ | ✅ | ✅ |
| Warehouses + **stock view**, suppliers (view), goods **receipt** — #8 | ✅ | ❌ | ✅ | ✅ |
| Warehouse CRUD + supplier CRUD | ✅ | ❌ | ✅ | ❌ |
| Warehouse **write-off / adjust** + **reorder policy** — #3/#5 | ✅ | ❌ | ✅ | ❌ |
| **Stock Health** (warehouse + served stores, by category/store) | ✅ | ❌ | ✅ | ✅ |
| **Item Lookup** (search served-store catalogue + item details + batches) | ✅ | ❌ | ✅ | ✅ |
| Create (**push**, w/ store picker) / dispatch / cancel transfer — #2 | ✅ | ❌ | ✅ | ✅ |
| **Receive** transfer (into store) | ✅ | ✅ | ❌ | ❌ |
| Replenishment: request | ✅ | ✅ | ❌ | ❌ |
| Replenishment: approve / **reject (w/ reason)** / fulfil — CH-4/#6 | ✅ | ❌ | ✅ | ❌ |
| **Batch Recall** trace / Hold-Recall (CH-3) | ✅ | trace only | ✅ | trace only |
| Stores + Store Admins + serving warehouse (CH-7) | ✅ | ❌ | ❌ | ❌ |
| Reports: Profits, **Product COGS** (CH-5) | ✅ | ❌ (revenue-gated) | ❌ | ❌ |

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

### 1c. (Recommended) Turn on batch tracking — to exercise FEFO / lots / recall  (B1)  *(super admin)*
While editing the warehouse (or on create), tick **"Batch tracking (FEFO + per-lot
cost/expiry)"** → Save. ✅ Enabling **seeds existing stock**, so the response notes how
many lots were seeded and it's safe to flip at any time. Do the same on the **Store edit
modal** later (step 5/8) so store sales are FEFO too. With this **off**, the batch steps
below still work but everything is one combined "legacy" lot.

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
     the supplier's, e.g. `LOT-A`), **Cost / unit (₹) — required, > 0**, **Expiry**,
     **Qty** (e.g. `100`).
4. **Receive**.

✅ Warehouse stock shows `PB001 … Available 100`.
❌ Leave **Cost / unit** blank (or `0`) on any line → **blocked** with "Enter a cost /
   unit (₹) greater than 0 for every line" (FE toast; backend also rejects with **400**).
   Cost is mandatory because it becomes the store's cost price (weighted-average) the
   moment the lot is transferred (CH-3).
✅ Receive the **same SKU + same batch no.** again (e.g. 50) → quantity becomes **150**
   (merged into the lot, no duplicate).
✅ Stock table columns: **Available / Reserved / In-transit / Free-to-promise** (CH-4)
   — at this point Reserved = In-transit = 0, Free-to-promise = Available. Hover the
   **Cost/unit** header → "weighted average of open lots"; **Expiry** → "earliest open
   lot" (CH-3).
✅ Sidebar → **Stock Ledger** → a `PURCHASE_IN` row with a **Batch** column.
✅ **Near-expiry / expired** rows are **colour-flagged** in the stock table (B5).
✅ An **Export CSV** button (top of the stock panel) downloads the current (filtered)
   stock for a stock-take / audit (#13).
✅ Click any stock row → a **detail modal**: facts + **Batches (lots) · soonest-expiry
   first** (B5 — shown when batch tracking is on) + **write-off / adjust** + **reorder
   policy** + movement history (full detail in §15c–§15d).

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
   `Grocery`, **Sub-category** = `Spreads`, GST, barcode = `PB001`, and an **image**
   (B2 — **Upload image** from your device, or paste a URL) → Create.
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
❌ Try to save with **no serving warehouse** → blocked in the form, and the **server also
   rejects it** (CH-7 enforcement, live on dev).

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

### 7b. (Alternative) Add a one-off item directly — All-Stores store picker  (B3)
Onboarding normally goes through **Assign** (above). To add a **brand-new single item**:
Sidebar → **Items** → **Add New Item** *(super admin)*.
- ✅ If you're in **All Stores** mode (no store in the top switcher), the form shows a
  **required store picker** — pick the target store. Saving **without** one shows
  "Pick a store to add this item to…" and is blocked (no `x-store-id` to target).
- ✅ With a store already selected in the switcher, there's no picker — it's added to
  that store. The new item also creates/links its **product master** behind the scenes.

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
   - ✅ The switch shows its **saved** state on reload (CH-1 `enabledForStore`, live on dev).

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
   - (Real cross-location results require **batch tracking on** for that warehouse/store
     — flip it from the Warehouse form / Store modal, step 1c / Prerequisites.)

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

**Warehouse manager** should see (no store switcher): **Dashboard** (warehouse cockpit),
**Stock Health**, **Item Lookup**, **Warehouses** (stock + write-off + reorder policy),
**Suppliers**, **Transfers** (create/dispatch/cancel), **Replenishment** (approve/reject/fulfil),
**Stock Ledger**, **Batch Recall** — and **nothing** store-side (no Items/Categories/Product
Master/Orders/Analytics/Stores). **Warehouse staff**: the same minus the manage-only actions —
they can **view** warehouses/stock + **receive** + do transfers, but get **no** warehouse
CRUD, **no** Approve/Reject/Fulfil, **no** write-off, and Batch Recall is **trace-only** (full §15).

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
- **Warehouse write-off above on-hand** → 400, stock untouched (#3).
- **Stock Health / Item Lookup into a non-served store** → 403 (scoped to served stores).
- **Goods-receipt line with ₹0 / blank cost** → **blocked** (mandatory, FE toast + backend 400).
- **Goods-receipt line with a past expiry** → warning before save (#11).
- **Warehouse staff** opening New/Edit/Delete warehouse, Approve/Reject/Fulfil, or Write-off →
  the buttons aren't shown (permission-gated, not just role) (#9).
- **Turn on batch tracking on a warehouse/store that already has stock** (B1) → it **seeds the
  existing stock into lots** and the **next sale/dispatch still works** (no "insufficient
  quantity"); re-saving with it already on is a no-op (idempotent).

---

## 15. Warehouse-manager cockpit (new this round)

> Needs the latest **`feat/inventory-v2`** (backend) + **`feat/inventory-v2-admin`** (admin)
> deployed on dev. Seed a warehouse manager via the **Warehouse Staff** page (§1b) or the DB
> fallback (last appendix), assign them the warehouse from §1, and log in as them in a separate
> browser/profile. They have **no store switcher** (a warehouse isn't tied to one store) — their
> screens are scoped to **their warehouse + the stores it serves**.

### 15a. Warehouse home  (#1)
On login a warehouse role lands on a **Warehouse dashboard** (not the store sales "cockpit").
✅ Real counts from their own data: **requests waiting** to approve, **transfers to dispatch**,
**in-transit**, **low-stock + expiring** lots, **recent receipts** — with quick links. The top
strip reads **WAREHOUSE · &lt;their warehouse name&gt;**. (Before: warehouse roles saw a mock
"Store Admin" sales dashboard with fake numbers.)

### 15b. Create a push transfer — target-store picker  (#2)
Sidebar → **Transfers** → **+ New transfer**.
✅ A **Target store** dropdown lists the stores this warehouse serves; pick one → the item search
is **scoped to that store** → set qty → **Create transfer** → Dispatch as usual. (Before, a
warehouse manager couldn't create a transfer at all — there was no store to target.)
✅ The **Transfers list** and the printed **pick slip** now show the destination **store name**
(and warehouse name), not just an id (#4).
> ⚠️ **Known pending:** that in-modal item search still calls the store catalog endpoint
> (`items.view`), so a **pure warehouse manager may get a 403** there until it's repointed at the
> Item-Lookup endpoint (§15f). Super admin works today; the fix is a small follow-up.

### 15c. Write off / adjust warehouse stock  (#3)  *(manager only)*
Warehouses → select the warehouse → click a stock row → **Write off / adjust** → qty + reason
(**Damage / Expiry / Count correction / Other**).
✅ On-hand drops; a **ledger row** is written (DAMAGE, or MANUAL_ADJUST for a count); on a
batch-enabled warehouse it consumes the **soonest-expiry lot first**.
❌ More than on-hand → 400, untouched. ❌ Warehouse **staff** don't see the action (needs manage).

### 15d. Editable reorder policy  (#5)
Same stock detail → set **low / max / reorder** → Save. Drives the Low-stock filter,
auto-replenishment, and the Stock-Health buckets.

### 15e. Stock Health  *(sidebar → Stock Health)*
✅ **My warehouse stock (SKUs)** summary + **Stores I supply — overall**, then **By store** and
**By category → sub-category**, bucketed **Out / Low / Expiring / Expired / Overstock / Healthy**.
✅ Click a store row → its **at-risk items** (worst first) with barcode, qty, low/max, expiry.
> **Overstock** only flags items with a **real max** (`maxStock > 0`). If items have no max
> (0/blank), Overstock = 0 and they count as **Healthy** — that's correct, not "all overstocked".
Super admin sees the same with a **warehouse picker**.

### 15f. Item Lookup  *(sidebar → Item Lookup)*  — search / filter / details
A read-only catalogue browser over the served stores.
✅ **Search** by name or barcode; **filter** by **store**, **category**, and **sub-category** (the
dropdowns list every category/sub-category present, with item counts).
✅ Click a row → full detail: **Common** (name, brand, category, unit, weight, GST, product id) +
**per-store** (store, barcode, on-hand, low/max, price, selling, avg cost, location, status, expiry)
+ **Batches** (batch no, qty left, cost, expiry, status).
❌ A store the warehouse doesn't serve never appears (server **403** if forced).

### 15g. Reject a request with a reason  (#6)
Replenishment → a PENDING request → **Reject** → you're prompted for a **reason** (and an approve
note on a partial approval); the requesting store sees that warehouse note on the request.

### 15h. Goods-receipt: mandatory cost + expiry warning  (#10/#11)
On **Receive goods**, **Cost / unit (₹) is required and must be > 0** — a blank/₹0 line is
**blocked** (FE toast + backend 400), because that cost becomes the store's cost price
(weighted-average) on transfer. A **past-dated expiry** still shows a warning before save
(already-expired stock) but does not block.

### 15i. Staff vs manager  (#8/#9)
- **Warehouse staff** can now **view Warehouses + stock** and **Receive goods** (previously a 403
  blocked the whole flow) and do transfers — but get **no** warehouse CRUD, **no**
  Approve/Reject/Fulfil, **no** Write-off (buttons hidden, gated by permission), Batch Recall
  **trace-only**.
- **Warehouse manager** has the full set above.

### 15j. Warehouse manager sees ALL their options (permission floor + discoverability)
The manager's capabilities now come from the **role**, not a snapshot saved when the
account was created — so an older account that pre-dates a permission (e.g.
`warehouse.receive_goods`) gets it automatically on next login, **no DB change**
(backend `resolveEffectivePermissions`, haper-backend #98).

After deploying the latest dev backend **and** admin, **fully log out and log back in** as
the warehouse manager (a plain reload can keep a stale permission cache), then check:
- ✅ Sidebar shows: **Stock Health, Item Lookup, Replenishment, Transfers, Stock Ledger,
  Batch Recall, Receive Goods, Warehouses, Suppliers**.
- ✅ Dashboard shows a **"Receive goods from supplier"** hero button + a **Receive goods**
  chip in *Jump to*.
- ✅ Sidebar → **Receive Goods** (new item, route `/receive-goods`) → opens the warehouse
  stock view with the warehouse auto-selected and the goods-receipt form already open.
  Only **Receive Goods** highlights in the sidebar (not Warehouses too).
- ❌ If any are missing → stale session or stale admin build (see Troubleshooting).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every warehouse/product call 404s | Backend `feat/inventory-v2` not deployed to the dev API |
| Category On/Off doesn't "stick" on reload | dev box is a build behind — pull/redeploy latest `feat/inventory-v2` (CH-1 `enabledForStore` is live there) |
| Store saves even with no serving warehouse | dev box is a build behind — pull/redeploy latest `feat/inventory-v2` (CH-7 enforcement; the form requires it regardless) |
| Batch Recall finds nothing / shows one "legacy" lot | Batch tracking **off** for that warehouse/store — turn it on (super admin) via the Warehouse form / Store modal checkbox (step 1c / Prerequisites) |
| "No serving warehouse" on Approve/Replenishment | Store's serving warehouse not set (step 5) |
| "…has no barcode/SKU" on transfer create | Store item missing a barcode = warehouse SKU (step 8b) |
| 403 on a warehouse/product-master action | Logged in as store admin (those are super/warehouse-only) |
| Store stock didn't change after Dispatch | Correct — store stock only rises on **Receive** |
| Warehouse manager sees a "Store Admin" sales dashboard | Admin not on latest `feat/inventory-v2-admin` (the #1 warehouse dashboard) |
| Stock Health shows **everything Overstock**, Healthy 0 | Backend not redeployed — fixed so Overstock needs `maxStock > 0` (§15e) |
| Stock Health / Item Lookup are empty | This warehouse serves **no stores** (no store's serving-warehouse = this one) |
| Item search 403s inside **New Transfer** (warehouse mgr) | Known pending — uses the `items.view` catalog endpoint (§15b); super admin works |
| Warehouse mgr missing Replenishment/Transfers/Recall/Receive Goods in sidebar; clicking *Jump to* bounces back | Admin build behind — `hasPermission()` used to deny **all** permission-gated UI for warehouse roles (only manager/support were checked). Fixed in admin `1969703`; deploy latest admin + hard refresh (⇧⌘R). Note role-gated items (Stock Health, Item Lookup, Warehouses, Suppliers) showed fine even while this bug was live |
| Order modal shows no "Order Activity" trail | Expected if that order had **no** edits/cancels/refunds/picker short-pick-OOS — it now shows a **"No activity recorded yet"** line. Do an item edit/cancel, or test a picker short-pick, to see rows (or open the **Order Activity** page) |

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
