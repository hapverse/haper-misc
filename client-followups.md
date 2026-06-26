# Client follow-ups — change tracker

Every backend change that *might* need a matching change in a client app goes here,
with a checklist for **each** client so nothing is missed.

**Clients:** `admin` (ops console) · `web` (customer site) · `android` · `ios` ·
`delivery` (rider app) · `picker` (picker app).

**Status key:** ✅ done · ⏳ to do · ❓ verify (probably nothing) · — not affected

## How to use (new session)
> **GATE PASSED:** the ENTIRE inventory-v2 backend (Phases 0–4) is **done, on `feat/inventory-v2`,
> and DEPLOYED + MIGRATED on dev (`dapi.haper.in`)** — so every endpoint below is **live on dev to
> build and test against.** Prod is still pristine (the user runs prod later). Client work can begin.
> **Order chosen by the user: `admin` first → `android` next → web/ios/picker/delivery later.**

1. Read this whole file (it's self-sufficient — every change, every client, every endpoint is here).
2. Say **"let's do the admin client changes"**. Work the ⏳ items for that client **one at a time**,
   test against `dapi.haper.in`, flip the status to ✅ here as each lands.
3. **Repos:** `haper-admin` (React ops console, on `dev`) · `haper-web` · `haper-android` (Kotlin) ·
   `haper-ios` (Swift) · `haper-picker` · `haper-delivery`. Branch off **`dev`**, PR into **`dev`** (NEVER `main`).
4. **Android/iOS rule:** any NEW field in an item/order/category JSON must be nullable or always-sent,
   or old app versions can crash (memory `android_gson_kotlin_defaults`). Only **CH-5** adds a
   customer-facing field (order line) — everything else is admin-only.

### Discovering exact request/response shapes (so you never need to ask)
- The dev backend is live at `dapi.haper.in` — **call the endpoint and read the JSON** to see the real shape.
- Or read the route + validator + controller in **haper-backend** (`packages/admin/src/routes/<area>/`):
  `router.js` = path + permission, `validator.js` = the exact request body it accepts, `controller.js` = the response.
- Per-change detail + the shipped behaviour: `haper-misc/inventory-v2-design.md` **§11.9–§11.13**.

## Admin build order (recommended)
Do the standalone catalogue/data changes first, then the master that ties them together:
1. **CH-1** global categories (super-admin CRUD + per-store on/off toggle) — foundational.
2. **CH-2** Stock-In batch fields (small, isolated).
3. **CH-3** goods-receipt batch-no + warehouse-stock view (wavg cost/min-expiry) + recall.
4. **CH-4** reservation columns (Available/Reserved/In-transit + free-to-promise) + EXPIRED + **status legends everywhere**.
5. **CH-5** product-COGS / margin report + cross-store toggle + margin = profit/costKnownRevenue.
6. **CH-6** Product Master screen + assign (onboarding) + route catalogue editing to the master (biggest).
7. **CH-7** required serving-warehouse on store create (optional; has a small backend prerequisite).

## Already built — DON'T rebuild (just enhance)
The earlier centralized-inventory feature already shipped these admin screens; the CH blocks **add fields onto them**, they don't build them from scratch:
- Warehouse CRUD + **warehouse-stock list view**, **routing-health** page, **Missing-Barcode filter**.
- **Goods-receipt** form, **stock-transfer** create/dispatch/receive, **replenishment** request/approve/fulfil screens.
- Stock-alert / inventory-group screens.
> If a base screen is missing in `haper-admin`, build the minimal version first, then layer the CH change on top.

---

## CH-1 · Global categories + per-store enable/disable
**Backend:** `feat/inventory-v2` (haper-backend) — committed + pushed; PR into `dev` pending.
**Plain summary:** categories/sub-categories are now ONE shared list for all stores
(not a copy per store). A store's categories appear automatically based on what it
stocks. Only head office (super admin) can create / rename / delete a category; a
store admin can only turn a category **on/off** for their own store.

| Client | What to do | Status |
|---|---|---|
| **admin** | • Drop the "store / add-to-all-stores" picker when creating a category or sub-category — they're global now, so it's one create.<br>• Show **Create / Rename / Delete** for category & sub-category **only to super admin**; hide for store admin & manager (backend now returns 403 for them).<br>• Add a per-store **on/off toggle** on each category for store admins → calls `PATCH /admin/category/:id/store-state` with `{ "enabled": true|false }`.<br>• Category list can show all global categories + this store's item count + the on/off state.<br>• Item add/edit: the category dropdown is just the global list (no per-store filtering). | ✅ done |
| **web** | No code change expected — the customer category & sub-category responses are the **same shape**; categories now show up automatically when the store stocks an item. Just verify browsing + store-switch still work. | ❓ verify |
| **android** | No new fields were added to the category JSON → no Gson crash risk, no change expected. Verify category browse. | ❓ verify |
| **ios** | Same as android — no change expected; verify. | ❓ verify |
| **delivery** | Not affected (riders don't use categories). | — |
| **picker** | Not affected (works on items/tasks, not category management). | — |

**Backend endpoints for clients (CH-1):**
- **NEW** `PATCH /admin/category/:categoryId/store-state` — body `{ enabled: boolean }`,
  needs `x-store-id` — store admin/manager turns a category on/off for the current store.
- Category create / update / delete / activate — now **super-admin only** (others get 403).
- `GET /admin/category/catalog` now returns **`enabledForStore`** per row (added this session so the
  admin toggle can show current on/off honestly; absent/true when there's no store context) alongside
  the existing `itemCount` (per-store) + `subCategoryCount` (global). Note: the catalog validator makes
  `page` **required** and 403s on a missing/invalid query, so the admin always sends `?page=1`.
- Customer `GET /user/home/category` and `/user/home/sub-category/:categoryId` — **same shape**;
  results are membership-based now (a category shows only if the store stocks an item in it).

---

## CH-2 · Store batch ledger / FEFO (inventory-v2 Phase 2A)
**Backend:** `feat/inventory-v2` (haper-backend `bafb1cb`) — committed; PR into `dev` pending.
**Plain summary:** a store's stock is now tracked as dated **batches** (each with its own
cost + expiry) behind a per-store flag (`config.batchesEnabled`, default OFF). Sales
consume the **soonest-to-expire** batch first (FEFO). The app/admin still see ONE number
per item (`quantity`) — batches are internal. **Customer apps see no new fields** (item
JSON is unchanged; `costPrice` stays admin-only). Day-one numbers are identical to today.

| Client | What to do | Status |
|---|---|---|
| **admin** | • Stock-In / Stock-Adjust modal (`PATCH /admin/item/:id/quantity`) **may** add 3 optional fields: `batchNo`, `costPrice`, `expiresAt` (so a received lot records its real cost/expiry). All optional — sending just `quantity` still works.<br>• A **negative** `quantity` now means "adjust down" and is **rejected (400) if it exceeds stock** (previously it could go negative) — surface that error.<br>• Response shape is now `{ acknowledged, matchedCount, modifiedCount, data:{ quantity } }` — read `data.quantity` for the new total if needed.<br>• (Optional, ops) a per-store "batch tracking" toggle if you want to flip `config.batchesEnabled` from the UI; otherwise it's set by ops during rollout. | ✅ done (batch toggle deferred to ops) |
| **web** | No change — item/cart/order JSON unchanged. Verify normal browse/checkout. | ❓ verify |
| **android** | No new item/order JSON fields → no Gson risk. Verify. | ❓ verify |
| **ios** | Same — no change expected; verify. | ❓ verify |
| **delivery** | Not affected. | — |
| **picker** | Not affected — pick-confirm still returns the new `quantity`; out-of-stock still zeroes the item (now batch-aware internally, same response). | ❓ verify |

**Backend endpoints for clients (CH-2):**
- `PATCH /admin/item/:itemId/quantity` — now also accepts optional `batchNo` (string), `costPrice` (number), `expiresAt` (ISO date); `quantity` may be negative (guarded). Response shape noted above.

---

## CH-3 · Warehouse batches + goods-receipt + transfer batch flow + recall (inventory-v2 Phase 2B)
**Backend:** `feat/inventory-v2` (haper-backend `dfe50d7`) — committed; PR into `dev` pending.
**Plain summary:** the warehouse also tracks dated batches now (behind `warehouse.batchesEnabled`,
default OFF). A goods-receipt creates a real batch (with `batchNo`); a transfer dispatch picks
the soonest-expiry lots and **carries their real cost + expiry into the receiving store** (instead
of guessing an average). Warehouse cost is now a **weighted average** and expiry the **earliest open
lot** (fixes the old last-cost-overwrite + false near-expiry). Recall is a batch **HOLD/RECALL** flag
+ a "which stores got batch X" lookup. All admin/warehouse-side — **no customer-app impact.**

| Client | What to do | Status |
|---|---|---|
| **admin** | • Goods-receipt (`POST /admin/procurement/receive`): surface a per-line **batch-no** field (auto / supplier-printed / manual) alongside the existing cost + expiry (re-receiving the same `batchNo` merges).<br>• Warehouse stock view: `costPrice` is now weighted-avg, `expiresAt` is the earliest open lot — labels/tooltips can say so. Optionally a per-row "view batches" drill-down.<br>• Transfer detail: each line now carries `batchAllocations: [{batchNo, qty, costPrice, expiresAt}]` (the lots shipped) — show if useful.<br>• Stock-movement/ledger views now have real `batchNo` + `iId` fields (was free-text note).<br>• **Recall** UI: trace a batch via `GET /admin/procurement/batch/:batchNo` (lists warehouses + stores holding it) and quarantine/re-instate a lot via `PATCH /admin/procurement/batch/status` (HOLD / RECALL / AVAILABLE). **Backend route now built.**<br>• (Optional, ops) per-warehouse "batch tracking" toggle for `warehouse.batchesEnabled`. | ✅ done (warehouse batch-flag toggle deferred to ops) |
| **web** | Not affected (warehouse/transfer are internal). | — |
| **android** | Not affected — `batchAllocations` is on the warehouse→store **transfer** line, not the customer order. No Gson risk. | — |
| **ios** | Same — not affected. | — |
| **delivery** | Not affected. | — |
| **picker** | Not affected. | — |

**Backend notes (CH-3):**
- `POST /admin/procurement/receive` — `items[].batchNumber` / `costPrice` / `expiresAt` already accepted; now they create/merge a real `warehouse_batch`.
- Transfer responses: `items[].batchAllocations[]` (new, default `[]`). `stock-movements`: new `batchNo` + `iId`.
- **Recall endpoints (built):** `GET /admin/procurement/batch/:batchNo` (trace) and `PATCH /admin/procurement/batch/status` (body `{ location: "warehouse"|"store", batchNo, status, warehouseId?, sku?, itemId? }`). Warehouse roles only (`view_ledger` to trace, `warehouse.manage` to set).

---

## CH-4 · Reservation buckets + free-to-promise + auto-expiry (inventory-v2 Phase 2C)
**Backend:** `feat/inventory-v2` (haper-backend `a95116c`) — committed; PR into `dev` pending.
**Plain summary:** warehouse stock now has two extra counters — **Reserved** (approved, not yet shipped)
and **In-transit** (shipped, not yet received). **Free-to-promise = Available − Reserved** is now
**enforced on the server**: approving more than is free is **rejected**. A reservation that sits
approved-but-unshipped for >7 days is auto-released and the request marked **EXPIRED**. Admin/warehouse-side only.

| Client | What to do | Status |
|---|---|---|
| **admin** | • Warehouse stock view: show **Available / Reserved / In-transit** columns + **Free-to-promise (Available − Reserved)** (new fields `reservedQty`, `inTransitQty` on warehouse-stock rows).<br>• Replenishment **approve** screen: it now **enforces** free-to-promise — `POST /admin/replenishment/:id/approve` returns **400** if the approved qty exceeds it (previously always succeeded). Show free-to-promise per line and handle the 400 gracefully.<br>• Replenishment status legend gains **EXPIRED** (auto-released stale approval; can be re-raised).<br>• **Status legends everywhere** (standing UX rule): Available/Reserved/In-transit, Free-to-promise, batch AVAILABLE/HOLD/RECALL, replenishment PENDING/APPROVED/PARTIALLY_APPROVED/FULFILLED/REJECTED/CANCELLED/**EXPIRED**, transfer CREATED/DISPATCHED/RECEIVED/CANCELLED.<br>• The old `GET /admin/replenishment/committed` hint still works but is superseded by `reservedQty` — can switch the screen to the real bucket. | ✅ done (switched approve to real reservedQty) |
| **web** | Not affected. | — |
| **android** | Not affected. | — |
| **ios** | Not affected. | — |
| **delivery** | Not affected. | — |
| **picker** | Not affected. | — |

**Backend notes (CH-4):**
- Warehouse-stock rows: new `reservedQty`, `inTransitQty` (additive; `availableQty` unchanged). Free-to-promise = `availableQty − reservedQty`.
- `POST /admin/replenishment/:id/approve` — now **400** on over-commit (reserves atomically).
- New replenishment status `EXPIRED`; nightly auto-expiry cron releases stale reservations.

---

## CH-5 · Per-batch COGS on order lines + cross-store reporting (inventory-v2 Phase 3)
**Backend:** `feat/inventory-v2` (haper-backend `420eae8` 3A, `329ccc2` 3B, + 3C) — committed; PR into `dev` pending.
**Plain summary:** each **order line** now records the TRUE cost of the stock sold (the FEFO lots
consumed) via two new fields — `iId` (the cross-store product id) and `batchAllocations`
(`[{batchNo, qty, costPrice}]`). Profit/margin now reads that real cost and **never fakes a 0% margin**
for a no-cost line (it flags it instead). Reports can roll the **same product up across all stores**.
**This is the FIRST change that touches the customer-facing ORDER JSON** → the Android/iOS decoding rule applies.

| Client | What to do | Status |
|---|---|---|
| **admin** | • New report `GET /admin/analytics/product-cogs` (revenue-gated): margin/COGS **by product** — `unitsSold`, `revenue`, `cogs`, `grossProfit`, `marginPct`, `costUnknownUnits`. Add a screen/table; support a **per-store ↔ all-stores** toggle (`?crossStore=true`, or super admin with no store).<br>• Best-sellers (`/analytics/item-frequency`) gains the same `?crossStore=true` toggle (merge a product across stores).<br>• Profit dashboard: a new `costKnownRevenue` is returned — compute **margin% = profit / costKnownRevenue** (NOT profit / revenue), and surface `revenue − costKnownRevenue` as **"₹X revenue has unknown cost"** instead of showing 0% margin.<br>• (Optional) order detail can show the per-line `batchAllocations` (which lots, at what cost) for COGS drill-down. | ✅ done (order-line batchAllocations drill-down deferred — optional) |
| **web** | Order history/detail JSON now has extra line fields (`iId`, `batchAllocations`). The site doesn't need them — just **verify it ignores unknown fields** (JS does by default). No change expected. | ❓ verify |
| **android** | **CRITICAL (Gson):** old orders have NO `iId`/`batchAllocations` → if you DECLARE them as non-null Kotlin fields, Gson decodes missing → null → crash (see `android_gson_kotlin_defaults`). The app **doesn't need these COGS fields** → simplest + safest is to **NOT add them to the Order model** (Gson silently ignores unknown JSON keys). If you ever do add them, make them **nullable** (`iId: String?`, `batchAllocations: List<…>? = null`). Verify order history/detail still parse. | ⏳ verify/guard |
| **ios** | Same as android (Codable): don't add the new line fields, or make them optional. Verify order parsing. | ⏳ verify/guard |
| **delivery** | Order lines it receives now carry the new internal fields — rider app doesn't read them; same "ignore / don't add as non-null" rule. Verify order parse. | ❓ verify |
| **picker** | Same — picker reads order items; the new COGS fields are internal. Verify pick-list/order parse. | ❓ verify |

**Backend notes (CH-5):**
- Order line: `iId` (string, default ""), `batchAllocations: [{batchNo, qty, costPrice}]` (default []) — both always emitted.
- Profit responses (`/analytics/profit`): new `costKnownRevenue` on each bucket. Snapshot schema adds it (default 0).
- New `GET /admin/analytics/product-cogs` (revenue-gated) + `?crossStore=true` on `/analytics/item-frequency`.
- **Admin nuance (verified in controller):** `product-cogs` resolves the store from `?storeId` OR the `x-store-id` header, and forces `crossStore` whenever there's NO store — so its per-store↔all-stores is driven by the **top store switcher**, a separate checkbox would be a no-op (the admin uses the switcher + a mode banner). `item-frequency`'s `crossStore` is an **independent** flag (does NOT auto-merge when no store), so it gets a real "merge across stores" toggle shown only in all-stores mode. `product-cogs` rows also include `costKnownRevenue`; `marginPct` is `null` when no cost was known.

---

## CH-6 · Product master + central catalogue editing + onboarding (inventory-v2 Phase 4)
**Backend:** `feat/inventory-v2` (haper-backend `10ee6b8` 4A, `47b05c4` 4B, `faa0280` 4C) — committed; PR into `dev` pending.
**Plain summary:** there's now ONE shared **product master** per product (keyed by `iId`). The catalogue/display
fields (name, brand, images, unit, weight, description, tags, GST, category) live on the master; each store's
item is a **projection** that copies them. **Edit the master once → it fans out to every store.** Onboarding a
store to a product is now "assign it" (creates a qty-0 item). All admin-side — **customer apps unaffected.**

| Client | What to do | Status |
|---|---|---|
| **admin** | • New **Product Master** screen (`/admin/product`): list/detail + **super-admin** create/edit/discontinue. Editing display fields here fans out to all stores.<br>• **Assign** UI: `POST /admin/product/:id/assign` `{ storeIds: [...] \| "ALL", price, sellingPrice, lowQty }` — multi-store picker (+ ALL) to onboard a product as qty-0 projections (reports assigned/skipped). This **replaces** clone-based onboarding.<br>• **Item edit form must change:** for a materialised item, **display fields are read-only for store admins** (the backend 403s a genuine display change by a non-super-admin) and editing them as super-admin **changes every store**. Move name/brand/images/unit/weight/description/tags/GST/category editing to the **product master**; the per-store item form keeps only price/sellingPrice/costPrice/lowQty/maxStock/reorderQty/location/status/popular/barcode/stock. (`categoryId` is now optional on item edit.)<br>• Surface "this is shared — edit the product" affordance on the item form. | ⏳ to do |
| **web** | Not affected — customer item/cart/order JSON shape unchanged (items still carry their denormalised display fields). Verify browse/checkout. | ❓ verify |
| **android** | Not affected — no item/order JSON shape change (display fields still on the item, just sourced from the master). No Gson risk. Verify. | ❓ verify |
| **ios** | Same — not affected; verify. | ❓ verify |
| **delivery** | Not affected. | — |
| **picker** | Not affected. | — |

**Backend notes (CH-6):**
- `GET/POST/PATCH /admin/product` (super-admin CRUD), `POST /admin/product/:id/assign`, `PATCH /admin/product/:id/status`.
- Item edit (`PUT /admin/item/:id`): a genuine display-field change on a materialised item → routed to master (super-admin) or **403** (store admin); per-store fields unchanged. `categoryId` now optional.
- `items.brand`/`items.weight` no longer required at the schema (default ""); the add validator still requires what it did.

---

## CH-7 · Required serving-warehouse on store create (inventory-v2 P9) — OPTIONAL, has a backend prerequisite
**Backend:** ⚠️ **NOT built yet** — `store.servingWarehouseId` is still `default: null` (region is the fallback;
`/admin/warehouse/routing-health` flags stores with no resolvable warehouse). The design (P9) wants every store to
have an explicit serving warehouse so supply routing always resolves. This is a **2-part task** (small backend + admin).
**Plain summary:** when creating a store, the admin must pick the warehouse that supplies it. Any **active** warehouse
is allowed (cross-region / cross-state is fine — region becomes just a label/fallback).

| Client | What to do | Status |
|---|---|---|
| **backend (do FIRST)** | Enforce a valid **active** `servingWarehouseId` on the **store-create** endpoint (haper-backend `packages/admin/src/routes/store/` — validator/controller, **not** the Mongoose schema, so model-level `generateStore()` in tests stays valid). Optionally require it on edit too. Reject/clear a `servingWarehouseId` pointing at an inactive/missing warehouse. Add a test. | ⏳ to do |
| **admin** | StoreModal (create/edit): add a **required "Serving warehouse"** dropdown listing **active** warehouses (`GET /admin/warehouse`); block submit until one is chosen; show the current serving warehouse on the store detail. Region field stays but is no longer how routing is decided. Pair with the routing-health page (already exists). | ⏳ to do |
| **web / android / ios / delivery / picker** | Not affected (serving-warehouse is internal supply routing). | — |

**Decide:** P9 is a robustness nicety, not required for correctness (region fallback + routing-health already cover gaps).
Skip it if you don't need hard enforcement yet; the rest of CH-1…6 is independent of it.

---

## Future changes
**This file is COMPLETE for inventory-v2** — CH-1…6 cover every shipped backend change (Phases 0–4) with a
per-client checklist + exact endpoints, and CH-7 covers the one optional P9 item (with its backend prerequisite).
**Customer-app surface across the whole project:** only **CH-5** adds fields to a customer-facing model (the order
line) — guard the Android/iOS decoders (don't declare `iId`/`batchAllocations` non-null). Everything else is
admin-only, and the apps already read the per-store `items` display fields unchanged.

For any FUTURE backend change beyond inventory-v2, add a new `CH-N` block above with the same per-client checklist.
Design source: `haper-misc/inventory-v2-design.md` (§7 = client scope; §11.9–§11.13 = what each phase shipped).
