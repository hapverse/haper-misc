# Warehouse Manager — Admin App Test Findings

**Tester persona:** a real warehouse manager logging into the **admin panel** to run a
day's work — receive goods, keep stock straight, approve store requests, send stock out,
and handle recalls.

**Scope:** admin app only (`haper-admin`). I walked every screen the `warehouse_manager`
role can reach and checked the matching backend behaviour. **No code was changed** — this
is a list of gaps and suggested changes, ordered by how much they hurt.

**What a warehouse manager actually gets to see** (sidebar): Dashboard, Replenishment,
Transfers, Stock Ledger, Batch Recall, Warehouses, Suppliers. Everything else (Items,
Categories, Orders, Analytics, Stores, etc.) is hidden — correct.

**Role facts (verified in backend):** a warehouse manager has `warehouse.manage`,
`manage_suppliers`, `receive_goods`, `manage_transfers`, `approve_replenishment`,
`view_ledger`. They have **no assigned store** — `/admin/me` returns `stores: []` for them.
That one fact causes several of the problems below.

---

## 🔴 Blockers — these stop normal work

### 1. The home screen is a fake "Store Admin" sales dashboard
**What I did:** logged in. Landed on the Dashboard (`/`).
**What happened:** I see a "Store performance cockpit" — revenue, orders, average order
value, delivery-boy leaderboard, fulfilment funnel, payment mix. The header even labels me
**"Store Admin · Assigned Store."**
**The catch:** every number is **made up**. The dashboard calls 6 analytics endpoints
(`/admin/analytics`, `/revenue`, `/order-analytics`, `/user-signups`, `/d-boy/summary`,
`/analytics/advanced`) and a warehouse manager is **403 on all of them** (no analytics or
delivery permissions). The page silently catches those errors and falls back to **mock
data** ([Dashboard.tsx:89-93](../haper-admin/src/pages/Dashboard.tsx#L89-L93), mock from
`getMockAdminInsights`). The "Store Admin" label comes from
[Dashboard.tsx:54-59](../haper-admin/src/pages/Dashboard.tsx#L54-L59).
**Why it's bad:** my landing page tells me nothing about my job and shows numbers that
aren't real. A new manager could easily believe them.
**What a person expects:** a warehouse home that opens on *my* work — e.g. "5 store
requests waiting for approval," "3 transfers ready to dispatch," "8 SKUs low," "4 lots
expiring in 30 days," "today's receipts," "total stock value." None of that exists today.
**Suggestion:** give warehouse roles a dedicated warehouse dashboard (or at least redirect
them to Replenishment/Warehouses on login instead of the store cockpit).

### 2. I cannot create a transfer to push stock to a store
**What I did:** Transfers → **+ New transfer** (the button is shown to me). Picked a source
warehouse, searched an item, set a quantity, hit **Create transfer**.
**What happened:** error toast — *"Select a target store from the top store switcher."*
But **there is no store switcher** on my screen. The switcher only renders when I have
stores ([AdminLayout.tsx:121](../haper-admin/src/components/layout/AdminLayout.tsx#L121)),
and I have none, so `activeStoreId` is always `null`
([TransfersPage.tsx:233](../haper-admin/src/pages/Warehouse/TransfersPage.tsx#L233)). The
backend also **requires `storeId`** on create. **Dead end — every time.**
**Result:** the only way I can move stock to a store is reactively, via Replenishment →
Fulfil (where the store is taken from the request). I **cannot** proactively push stock
(new launch, seasonal pre-stock, rebalancing) — which is exactly what a warehouse manager
needs to do.
**Bonus problem:** the item search in that modal hits `/admin/item/catalog` with **no store
filter** for me, so it returns the *same item across all stores* with nothing to tell them
apart ([useItemSearch.ts](../haper-admin/src/pages/Warehouse/useItemSearch.ts)).
**What a person expects:** a target-store **dropdown inside the New-transfer modal** (since
I serve many stores), then pick items for that store.

### 3. There is no way to write off or correct warehouse stock
**What I did:** opened my warehouse stock. Found units that were damaged / expired, and a
shelf count that didn't match the system.
**What happened:** the only action on warehouse stock is **+ Receive goods** (which *adds*).
There is **no Adjust / Write-off / Damage / Stock-take** button anywhere
([WarehousesPage.tsx:162](../haper-admin/src/pages/Warehouse/WarehousesPage.tsx#L162)).
Backend confirms it: warehouse stock can only change via *receive*, *transfer
dispatch/cancel*, or *batch Hold/Recall* — and **Hold/Recall only blocks a lot, it does not
remove the quantity**. A `DAMAGE` movement type exists in the code but nothing at the
warehouse level ever creates it.
**Why it's bad:** broken/expired stock sits in "Available" forever and inflates my on-hand,
my stock value, and free-to-promise. There's no honest way to reconcile a physical count.
**What a person expects:** an "Adjust warehouse stock" action with a reason
(damage / expiry / count correction) that lowers on-hand and writes a ledger row.

---

## 🟠 Medium — works, but frustrating or misleading

### 4. Stores show as long database IDs, not names
Because my `stores` list is empty, the name lookup falls back to the raw ObjectId
([TransfersPage.tsx:39](../haper-admin/src/pages/Warehouse/TransfersPage.tsx#L39),
[RecallPage.tsx:37](../haper-admin/src/pages/Warehouse/RecallPage.tsx#L37)). So:
- The **pick slip** prints the destination store as `665f1a2b...` instead of "Patna Store."
- **Batch Recall → In stores** lists store IDs, not names.
Also, the **Transfers table has no destination-store column at all** — handling many stores,
I can't tell who a transfer is for without opening the pick slip (which shows an ID).
**Suggestion:** resolve store names for warehouse roles (the warehouse already serves known
stores) and add a **Store** column to the transfers list.

### 5. I can see warehouse reorder points but can't set them
The stock detail shows *"Reorder policy: low 0 · max — · reorder —"*
([WarehousesPage.tsx:318](../haper-admin/src/pages/Warehouse/WarehousesPage.tsx#L318)) but
there is **no edit control**. The backend has `PATCH /:warehouseId/stock/:sku/policy`, but
the admin app never calls it (not even defined in
[inventory.ts](../haper-admin/src/api/inventory.ts)).
**Why it matters:** the "Low stock" filter and the auto-replenishment low-stock detection
lean on these thresholds, and they're stuck at the default (low 0) with no UI to change
them. I can't tell the system "warn me when Peanut Butter drops below 50."

### 6. Rejecting / part-approving a request tells the store nothing
**Reject** is a single click with **no reason** field
([ReplenishmentPage.tsx:87](../haper-admin/src/pages/Warehouse/ReplenishmentPage.tsx#L87)),
and a partial approval sends no note. The store admin just sees "REJECTED" or a smaller
number with no "why" (out of stock? wrong SKU? supplier delay?).
**Suggestion:** optional reason on reject / partial approval, shown to the store.

### 7. The approve screen can show blank availability
The Approve modal loads warehouse stock with the default page size (200) and matches by SKU
([ReplenishmentPage.tsx:156](../haper-admin/src/pages/Warehouse/ReplenishmentPage.tsx#L156)).
If my warehouse has more than 200 SKUs and the requested one isn't on the first page,
**Avail / Reserved / Free all show "—"** and I'm approving blind.
**Suggestion:** fetch availability for exactly the requested SKUs.

---

## 🟡 Role separation — I hit these the moment I create a Warehouse Staff account

(The test guide §1b says to make a `warehouse_staff` user to check role separation. As their
manager, I'd expect them to be able to do their two jobs: receive goods and move transfers.)

### 8. Warehouse Staff can't receive goods or see warehouses at all
The warehouse **list** and **stock** endpoints require `warehouse.manage`, which staff
**don't have** (`GET /admin/warehouse` and `/:id/stock` → `requirePermission(WAREHOUSE.MANAGE)`).
So a staff member who opens **Warehouses** gets a 403 toast and an empty list — and since
**Receive goods** is only reachable *after* selecting a warehouse from that list, they
**can't receive goods either**, even though they have `receive_goods`. Suppliers list has
the same problem (`manage_suppliers` required). Net: the "receive + transfers" role can't
reach receiving.

### 9. Buttons appear that the staff role isn't allowed to use
The UI shows buttons by **role**, but the backend checks **permission**, so they don't
line up for staff:
- WarehousesPage shows **+ New / Edit / Delete warehouse** to anyone on the page, with no
  permission check — staff would 403 (need `warehouse.manage`).
- ReplenishmentPage enables **Approve / Reject / Fulfil** for any warehouse role
  ([ReplenishmentPage.tsx:32](../haper-admin/src/pages/Warehouse/ReplenishmentPage.tsx#L32)),
  but the backend requires `approve_replenishment`, which staff lack.
These are "button present, action fails" mismatches — confusing for staff.

---

## ⚪ Smaller polish items

10. **Goods receipt accepts ₹0 cost with no warning.** Cost defaults to 0 if left blank
    ([WarehousesPage.tsx:421](../haper-admin/src/pages/Warehouse/WarehousesPage.tsx#L421)).
    Receiving at zero cost silently poisons the weighted-average cost and every downstream
    COGS / margin number. Warn when cost is blank/0.
11. **Goods receipt doesn't validate expiry.** I can type a past expiry date and it's
    accepted — no warning that I'm receiving already-expired stock.
12. **Batch Recall needs the exact batch number typed in.** No browse/autocomplete, and no
    "show all Held / Recalled / expiring lots" view — so a proactive recall depends on me
    already knowing the code.
13. **No export.** A warehouse manager regularly needs a stock CSV for a stock-take or
    audit; there's no export on the warehouse stock table.
14. **The 🔔 bell in the top bar does nothing** (no click handler) — true for all roles, but
    notable since a warehouse manager would want alerts (new request, recall, low stock).
15. **My warehouse is never named in the UI.** I'm scoped to one warehouse on the server,
    but nothing on screen says which one — and I can apparently open/edit other warehouses
    from the Warehouses list while my transfers/requests are scoped to only mine. Worth
    confirming whether warehouse managers should manage warehouses other than their own.

---

## One-line summary
The reactive path works well (a store requests → I approve → fulfil → dispatch, with good
free-to-promise, batch/FEFO, and recall tooling). The gaps are around **(1)** no useful
landing screen, **(2)** no way to *push* a transfer, and **(3)** no way to *write off*
warehouse stock — the three things a warehouse manager reaches for that simply aren't there
today, plus store names showing as raw IDs and a warehouse-staff role that can't reach its
own job.

---

## ✅ Fixes shipped (session 2026-06-27, branch `feat/inventory-v2-admin-gaps`)
On `feat/inventory-v2-admin-gaps` (off `origin/dev`) → **haper-backend PR #90** + **haper-admin PR #68**
(into `dev`, **not merged** — user merges). Verified: backend **129** tests green across the touched
suites + new write-off/SKU-filter tests; admin `tsc -b` clean + **60** vitest + `vite build` ok.

**Blockers**
- **#1 ✅** — warehouse roles now land on a dedicated **Warehouse dashboard** (real counts: store
  requests waiting, transfers to dispatch, in-transit + quick links) instead of the mock store cockpit.
- **#2 ✅** — New-transfer modal has a **Target store** dropdown (stores served by the chosen warehouse,
  via new `GET /admin/warehouse/:id/stores`) + the item search is **scoped to that store**. Proactive push works.
- **#3 ✅** — **Write off / adjust** stock (damage / expiry / count) in the stock detail modal →
  `POST /admin/warehouse/:id/stock/:sku/write-off` (txn, FEFO-aware, always writes a ledger row).

**Medium**
- **#4 ✅** — transfer list now carries **store names** (denormalized) + a **Store column**; pick slip uses the name.
- **#5 ✅** — **editable reorder policy** (low/max/reorder) in the stock detail modal (wires the existing endpoint).
- **#6 ✅** — **reject reason** prompt + **approve note**; the warehouse note is persisted and shown to the store.
- **#7 ✅** — approve screen fetches availability for **exactly the requested SKUs** (`?skus=`), no more blanks past page 1.

**Role separation**
- **#8 ✅** — any warehouse role can now **view** warehouses/stock/suppliers (so staff can receive); mutations stay on `manage`.
- **#9 ✅** — New/Edit/Delete warehouse + Approve/Reject/Fulfil buttons are **permission-gated** (match the backend).

**Polish**
- **#10 ✅** — goods-receipt **warns on ₹0 cost**. **#11 ✅** — warns on **past expiry**. **#13 ✅** — **stock CSV export**.

**Deferred (deliberate)**
- **#12** recall browse/autocomplete + "all held/recalled/expiring" view — needs a new batch-by-status list endpoint;
  follow-up (the trace-by-batchNo + per-SKU lots already exist).
- **#14** top-bar 🔔 bell — cross-role, no notification backend yet; out of scope here.
- **#15** "should a warehouse manager manage *other* warehouses?" — a product decision. Buttons are now permission-gated
  (#9); hard per-warehouse scoping of warehouse CRUD is left for you to decide.
