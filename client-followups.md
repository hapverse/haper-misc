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
| **admin** | • New **Product Master** screen (`/admin/product`): list/detail + **super-admin** create/edit/discontinue. Editing display fields here fans out to all stores.<br>• **Assign** UI: `POST /admin/product/:id/assign` `{ storeIds: [...] \| "ALL", price, sellingPrice, lowQty }` — multi-store picker (+ ALL) to onboard a product as qty-0 projections (reports assigned/skipped). This **replaces** clone-based onboarding.<br>• **Item edit form must change:** for a materialised item, **display fields are read-only for store admins** (the backend 403s a genuine display change by a non-super-admin) and editing them as super-admin **changes every store**. Move name/brand/images/unit/weight/description/tags/GST/category editing to the **product master**; the per-store item form keeps only price/sellingPrice/costPrice/lowQty/maxStock/reorderQty/location/status/popular/barcode/stock. (`categoryId` is now optional on item edit.)<br>• Surface "this is shared — edit the product" affordance on the item form. | ✅ done |
| **web** | Not affected — customer item/cart/order JSON shape unchanged (items still carry their denormalised display fields). Verify browse/checkout. | ❓ verify |
| **android** | Not affected — no item/order JSON shape change (display fields still on the item, just sourced from the master). No Gson risk. Verify. | ❓ verify |
| **ios** | Same — not affected; verify. | ❓ verify |
| **delivery** | Not affected. | — |
| **picker** | Not affected. | — |

**Backend notes (CH-6):**
- `GET/POST/PATCH /admin/product` (super-admin CRUD), `POST /admin/product/:id/assign`, `PATCH /admin/product/:id/status`.
- Item edit (`PUT /admin/item/:id`): a genuine display-field change on a materialised item → routed to master (super-admin) or **403** (store admin); per-store fields unchanged. `categoryId` now optional.
- `items.brand`/`items.weight` no longer required at the schema (default ""); the add validator still requires what it did.
- **Admin note:** the product master endpoints are **JSON-only** (`images` is an array of URL strings — there's no multipart upload on `/admin/product`). The admin Product Master form therefore edits images as **URLs** (existing masters already carry their migrated S3 URLs); true file-upload for the master is deferred (add an upload route + multipart later if needed). `unit` must be one of the stored values (`unit(s)`/`ml`/`L`/`kg`/`g`). `PATCH /admin/product/:id` returns `syncedItems` (how many store projections it fanned out to).
- **Single-creation-path follow-up (2026-06-29):** the redundant **Add New Item** button on the Items screen was removed (PR hapverse/haper-admin#73 → `dev`) so products are created **only** via Product Master → Add Product → Assign. The Items screen stays edit-only (per-store price/stock/location/barcode). Backend `POST /admin/item` left intact (no longer reached from the UI) — can be role-locked later. Trade-off accepted: single-store add is now two steps (Add Product → Assign to that store).

---

## CH-7 · Required serving-warehouse on store create (inventory-v2 P9) — ✅ DONE (backend + admin)
**Backend:** ✅ **built on `feat/inventory-v2`** — store-create now requires an **active** `servingWarehouseId`
(400 otherwise); update validates an active one when set (clearing allowed). `/admin/warehouse/routing-health`
still flags any legacy stores without a resolvable warehouse. Region is now a fallback label only.
**Plain summary:** when creating a store, the admin must pick the warehouse that supplies it. Any **active** warehouse
is allowed (cross-region / cross-state is fine — region becomes just a label/fallback).

| Client | What to do | Status |
|---|---|---|
| **backend (do FIRST)** | Enforce a valid **active** `servingWarehouseId` on the **store-create** endpoint (haper-backend `packages/admin/src/routes/store/controller.js` — controller, **not** the Mongoose schema, so model-level `generateStore()` in tests stays valid). On update, a serving warehouse being SET must be active (clearing to null allowed). Added tests. | ✅ done (feat/inventory-v2) |
| **admin** | StoreModal (create/edit): the **Serving warehouse** dropdown (active warehouses, `GET /admin/warehouse`) is now **required on create** (submit blocked + client guard); region relabelled as a fallback only. Edit keeps it optional (reassign/clear). Pairs with the routing-health page (already exists). | ✅ done |
| **web / android / ios / delivery / picker** | Not affected (serving-warehouse is internal supply routing). | — |

**Decide:** P9 is a robustness nicety, not required for correctness (region fallback + routing-health already cover gaps).
Skip it if you don't need hard enforcement yet; the rest of CH-1…6 is independent of it.

---

## Android client — QA findings & open items (session 2026-06-27)
**What this is:** a full customer-flow QA pass of **haper-android** (Kotlin, on `dev`) against the
inventory-v2 backend (`feat/inventory-v2`, live on `dapi.haper.in`). Each screen was traced into the real
backend code to check (a) Gson decode-safety of new/missing JSON fields and (b) store-identity correctness.
**No code was changed this session.** This block is the resume point — come back and work the OPEN items below.
Gson rule throughout: memory `android_gson_kotlin_defaults` (plain `GsonBuilder().setLenient().create()`,
no Kotlin adapter → a missing JSON key decodes to `null` even when the Kotlin field has a default).

### Verified SAFE — no Android change needed (decode-safety confirmed this session)
- **CH-1 categories / CH-2 item-cart-order / CH-6 product-master:** no JSON shape change. `CategoryModel`,
  `SubCategoryModel`, `ItemModel` unchanged; existing `ApiContractTest.kt` cases already cover their decode.
- **CH-5 order-line COGS fields:** the order line `OrderItem` (`OrderModels.kt:181`) declares **neither**
  `iId` nor `batchAllocations`; the names appear nowhere in the app (grep clean). Gson silently drops unknown
  keys, so both new orders (which now emit `iId:""` + `batchAllocations:[]`, schema `orders.schema.js:47-78`)
  and old orders (which omit them) decode fine. **Do NOT add these fields to the model.**
- **Checkout cannot leak across stores:** backend `CartRepository.getById` AND `ItemRepository.getDetail`
  both filter by `storeId` (`item.repository.js:364`), so a foreign-store item can never be sold from the
  wrong store — it throws "Item no longer available" instead. No data-corruption path.
- **CH-3 / CH-4** (warehouse batches, reservations): admin/warehouse-only → Android not affected.

### OPEN items — come back to these (priority order)
| # | Pri | Item | Detail / what to do |
|---|---|---|---|
| **A1** | 🔴 high | **Harden `refunds` against the Gson NPE (real crash risk).** | The server-side `normalizeRefundFields` that the memory says always re-emits `refunds`/`refundedAmount`/`hasPartialRefund` **no longer exists anywhere in haper-backend** (grep-confirmed; the one-time backfill script is also gone). Reads use `.lean()`, so schema defaults are NOT re-applied on read. `OrderDetailScreen.kt:664` does `order.refunds.isNotEmpty()` on a **non-null** `List` (`OrderModels.kt:82`) → any order returned without the key NPE-crashes the detail screen (the original "BH…" bug). **Fix (small):** make the model defensive — `refunds: List<OrderRefund>? = null` + read `order.refunds?.isNotEmpty() == true`. Also verify dev order data still carries the field. Pre-existing (not caused by inventory-v2), but it's the only true crash risk found. |
| **A2** | ✅ rec | **Add CH-5 regression test (permanent guard).** | CH-5 is safe only by *omission* — nothing stops a future edit from adding `iId`/`batchAllocations` as non-null and reviving the crash class. Add ~2 cases to `ApiContractTest.kt`: order **list** + order **detail** whose `items[]` carry `iId` + `batchAllocations:[{batchNo,qty,costPrice}]`, asserting clean decode + the app's real fields (`quantity`/`salePrice`/`itemId`) still read. Test-only, no production change. |
| **A3** | ⚠️ med | **Store-switch cart UX (P15 not fully built).** | Backend cart is **store-LOCKED** (pre-existing guard `cart.storeId !== storeId → null`, on `dev` since 2026-03-21). Android cart has **no `iId`** → it can't be store-portable. Two gaps, both newly visible once Chapra opens: (1) switching stores with items in cart shows an **empty cart with no message** (design P15 wanted "removed — not available at this store"); (2) low-likelihood "poisoned cart" — items added while a foreign cart is hidden pile into the stale cart and then **block checkout** in the original store until removed (no bad order placed, just stuck). **Fix:** on store switch, clear the local cart + tell the user; optionally backend `add` starts a fresh cart when the active store differs. Low urgency while stores are geographically far apart. |

### Housekeeping noticed (not Android code)
- Memory **`android_gson_kotlin_defaults` is partly stale**: it states the backend always re-emits `refunds`
  via `normalizeRefundFields` in the user order controller — that function has since been **deleted**. Update
  the memory so a future session doesn't trust a guard that's gone (ties to **A1**).

### Status of the Android column above
The android cells in CH-1/CH-2/CH-6 are **verified decode-safe** (see "Verified SAFE" above). CH-5 android = ✅.

### ✅ A1 + A2 SHIPPED (android) + iOS CH-5 (session 2026-06-27)
- **A1 ✅ DONE** (haper-android **PR #31**, branch `feat/inventory-v2-android`) — `Order.refunds` +
  `OrderRefund.items` made **nullable**; `OrderDetailScreen` reads them via `.orEmpty()`. Removes the NPE
  crash on orders that omit `refunds` (Gson doesn't apply Kotlin defaults). Verified: `./gradlew
  :app:testDebugUnitTest --tests "*ApiContractTest"` BUILD SUCCESSFUL.
- **A2 ✅ DONE** (same PR) — `ApiContractTest` now decodes order list + detail with CH-5
  `iId`+`batchAllocations` on the line, and an old order with no `refunds` key.
- **A3 ✅ DONE (all clients)** — store-switch cart (P15). **Root fix in backend** `CartRepository.add`
  (haper-backend **PR #93**, branch `feat/inventory-v2-cart`): when the active store differs from the
  cart's store, the stale cart is **dropped and a fresh one started** for the new store — kills the
  "poisoned cart / stuck checkout" edge for every client (+ user cart test, 21 green). Clients:
  **android PR #31** (shared cart already refetches on switch → badge correct; added a one-time per-store
  toast); **iOS PR #15** (`selectStore` now also refreshes the cart + a per-store notice — it wasn't
  refreshing before); **web** = N/A (no store switcher; single nearest-store session).
- **iOS CH-5 ✅ DONE** (haper-ios **PR #15**, branch `feat/inventory-v2-ios`) — **no model change** (Codable
  already ignores unknown keys + decodes refunds defensively `try? … ?? []`); added decode regression tests.
  Verified: `xcodebuild build-for-testing -sdk iphonesimulator` → TEST BUILD SUCCEEDED (sim runtime out of
  date locally, so tests run in CI). iOS CH-5 cell = ✅; CH-1/CH-2/CH-6 ios still ❓ verify (no shape change).
- **web ✅ verified — no code change needed** — CH-5 order rendering ignores the unknown line fields (JS
  drops unknown keys) and refunds are already guarded with `Array.isArray(order.refunds)` /
  `Array.isArray(r.items)` (`pages/OrderDetail.tsx`), so the android A1 risk doesn't exist on web. P15 N/A
  (no store switcher — `setStoreId` only set once to the nearest store). CH-1/2/6 = same JSON shapes.

---

## Admin / operator QA findings — super-admin + store-admin walkthrough (session 2026-06-27)
**What this is:** a real-world operator QA pass of **haper-admin** (`feat/inventory-v2-admin`, **merged to dev
+ deployed at damin.haper.in**) against the backend (`feat/inventory-v2`, **deployed at dapi.haper.in**). Walked
the actual "open a 2nd store (Chapra) → build catalog → stock warehouse → transfer to store → sell → report →
recall" lifecycle, tracing each step into real admin + backend code. **No code changed.** This is the resume point.

**Deployment is LIVE on dev — verified** (credential-free route probes, 2026-06-27): every new route returns
`401` (deployed + auth-gated) — `/admin/product`, `/admin/analytics/product-cogs`, `/admin/category/catalog`,
`/admin/warehouse/routing-health`, `/admin/procurement/batch/:no` — a non-existent route returns `404`, and the
admin SPA at damin.haper.in returns `200`. So CH-1 `enabledForStore` + CH-7 enforcement ARE live (earlier
"not redeployed" caveat is RESOLVED). **Authenticated end-to-end flows were NOT click-tested** (no admin creds;
won't fetch per rules) — findings are from code trace + route-liveness. **Dev is fully migrated and live.**

### Verified WORKING (operator features, code-traced)
CH-1 global categories + per-store toggle · CH-2 stock-in/adjust batch fields + clean over-adjust 400 ·
CH-3 goods-receipt per-line batch (merge on re-receive) + transfer FEFO dispatch/receive carrying real cost/expiry
+ **Recall** trace + HOLD/RECALL/AVAILABLE · CH-4 replenishment approve enforces **free-to-promise** (400 + warning
+ "fill to free") + EXPIRED + **status legends everywhere** · CH-5 **Product-COGS** page (units/revenue/cogs/margin
/cost-unknown) + profit margin = profit ÷ **costKnownRevenue** + best-sellers cross-store toggle · CH-6 Product
Master CRUD + multi-store **Assign** (+ALL) + item display-field gating · CH-7 required serving-warehouse + routing-health.

### OPEN items — operator gaps / new changes needed (priority order)
| # | Pri | Item | Detail / what to do |
|---|---|---|---|
| **B1** | 🔴 high | **No UI to turn batch tracking ON (store + warehouse).** | Batches are gated behind `store.config.batchesEnabled` + `warehouse.batchesEnabled`, both default **OFF**, and `batchesEnabled` appears **nowhere** in `haper-admin/src` (grep-confirmed empty). So an operator types batchNo/cost/expiry into goods-receipt/stock-in and the backend **silently ignores it** (legacy flat-qty path) until someone flips the flag in the DB. The entire Phase-2 batch investment (FEFO, per-lot cost/expiry, true COGS) is inert until then. **Needed:** a "batch tracking" toggle on the Store edit modal (`config.batchesEnabled`) + Warehouse form (`warehouse.batchesEnabled`), with the rollout order enforced (warehouse flag first, seed batches, then store flag — a sale in the gap drifts the legacy batch). Was deliberately "deferred to ops"; for real rollout it's the #1 gap. |
| **B2** | 🔴 high | **Product images are URL-only — no upload.** | `ProductModal.tsx:157` is a `https://…` text box; backend `/admin/product` is JSON-only (no multipart). Onboarding a real catalog (100s of products) means hosting every image elsewhere and pasting URLs one-by-one — unusable for store staff. **Needed:** a multipart upload route on `/admin/product` + a file-upload widget on the master form. |
| **B3** | 🟠 med | **Super-admin "All Stores" mode can't create an item.** (medium confidence — verify on damin) | `ItemModal` sends no `storeIds` and reads no `activeStoreId` — it relies only on the `x-store-id` header. In All-Stores mode that header is absent → backend 400 "Store context required", with no store picker in the add form. **Needed:** a store picker (or "assign after create") in the item add form for super admin, OR require selecting a store first with a clear hint. |
| **B4** | 🟡 low | **No bulk category/sub-category create.** | One modal at a time; a new store's ~20–50 categories + 100+ sub-categories is tedious/error-prone. **Needed (nice-to-have):** CSV/bulk create. |
| **B5** | 🟡 low | **Stock views have no per-batch drill-down or near-expiry flag.** | Warehouse/store stock shows one aggregate `expiresAt`, not "LOT-A Dec vs LOT-B Nov", and no "⚠ expires in 3 days" colour. Blind FEFO/reorder planning once batches are on. **Needed:** per-row "view batches" drill-down + near-expiry colour coding. |
| **B6** | 🟡 note | **Per-store custom item image is overwritten on master edit.** (by design) | Master→item sync is one-way, so a store-uploaded image vanishes when HQ edits the product. Intended (display fields are shared) — but **add a warning** on the master edit form so HQ knows it fans out. |
| **B7** | ⏳ future | **Interstate GST / e-way bill / per-state GSTIN absent.** | Fine now (Bihar WH → Bihar stores). Blocks a Bihar-WH → Jharkhand-store transfer when multi-state. Correctly deferred (design §9) — list for the multi-state expansion. |

### Recommended order
1. **B1** batch toggle (else the batch feature stays off in real use). 2. **B2** image upload (before onboarding a real catalog). 3. **B3** all-stores item create. 4. Backlog: **B4/B5/B6**. 5. **B7** when going multi-state.

### ✅ Status — fixes shipped (session 2026-06-27, branch `feat/inventory-v2-admin-gaps`)
Built on `feat/inventory-v2-admin-gaps` (off `origin/dev`) in **haper-backend PR #90** + **haper-admin PR #68**
(into `dev`, **not merged** — user merges). Verified: backend **282** tests green across all changed areas;
admin `tsc -b` clean + **60** vitest + `vite build` ok.
- **B1 ✅ DONE** — batch-tracking toggle on the Store modal + Warehouse form (super-admin). Backend accepts
  `batchesEnabled` on store/warehouse create+update and **seeds LEGACY batches on enable** (idempotent
  `seedStore`/`seedWarehouse`) so flipping it on can't break the first FEFO sale/dispatch; gate cache reset.
- **B2 ✅ DONE** — `POST /admin/product/upload-image` (reuses the item S3 pipeline) + an **Upload image**
  control in ProductModal (device upload + URL paste).
- **B3 ✅ DONE** — item-add accepts `storeIds` as array **or** comma-string; ItemModal shows a required
  **Add to store** picker in All-Stores mode.
- **B5 ✅ DONE (warehouse)** — `GET /admin/warehouse/:id/stock/:sku/batches` + near-expiry colour on the
  warehouse stock list + a **Batches (lots)** table in the stock detail modal. *(Store-item batch drill-down
  not built — the store items list has no expiry column; follow-up if needed.)*
- **B6 ✅ DONE** — already present (ProductModal/ItemModal warn that catalogue edits fan out to every store). Verified.
- **B4 ⏭️ DEFERRED (by decision)** — category/sub-category icons are `required` **and customer-facing**, so a
  names-only bulk create would ship broken/placeholder icons to the storefront; a clean bulk flow needs an icon
  per row (≈ no savings over single-create). Left for a product decision.
- **B7 ⏳ future** — interstate GST, unchanged (multi-state only).

---

## Warehouse-manager QA findings — warehouse_manager + warehouse_staff walkthrough (session 2026-06-27)
**What this is:** a third operator QA pass of **haper-admin** (on `feat/inventory-v2-admin-gaps`) + its
backend, this time from the **warehouse_manager / warehouse_staff** persona (the personas the A-/B- passes
didn't cover). Walked every screen those roles reach — Dashboard, Replenishment, Transfers, Stock Ledger,
Batch Recall, Warehouses, Suppliers — and traced each into the real admin + backend code. Findings + fixes
recorded here; the standalone scratch file (`warehouse-manager-test-findings.md`) is folded in and removed.

**Key role facts (verified):** a warehouse role has `warehouse.manage` (manager) or the receive/transfer
subset (staff), and **no assigned store** — `/admin/me` returns `stores: []`. That one fact caused several
of the gaps below (no store switcher → no transfer target, store names render as raw ObjectIds, store
dashboard shows mock data).

### Findings → fixes (all shipped this session unless noted)
| # | Pri | Finding | Fix | Commit(s) |
|---|---|---|---|---|
| 1 | 🔴 | Login lands on the **mock "Store Admin" sales cockpit** (warehouse role is 403 on every analytics endpoint → silent fallback to mock data) | Dedicated **Warehouse dashboard** — real counts (requests waiting, to dispatch, in-transit, low/expiring, today's receipts) from endpoints the role already has; `/admin/me` now returns the assigned warehouse for the scope label | admin `545b472`; be `2bd207d` (me-field) |
| 2 | 🔴 | **Can't create a push transfer** — modal needs the store switcher, which warehouse roles don't have (`storeId` never set → dead end) | **Target-store dropdown** in New-transfer (`GET /admin/warehouse/:id/stores`) + item search **scoped to the chosen store** | admin `84a2ddd`; be `5351a04` |
| 3 | 🔴 | **No way to write off / adjust warehouse stock** (damage / expiry / count) — stock only ever goes up | **Write-off / adjust** action in stock detail → `POST /admin/warehouse/:id/stock/:sku/write-off` (txn, FEFO-aware, always writes a ledger row) | be `6224778`; admin `f513aac` |
| 4 | 🟠 | Stores show as **raw ObjectIds** on transfers / pick slip / recall; no Store column | Store names **denormalized** onto the transfer list + a **Store column** + name on the pick slip | admin `84a2ddd`; be `5351a04` |
| 5 | 🟠 | Reorder points (low/max/reorder) are **view-only** (PATCH endpoint existed, UI never called it) | **Editable reorder policy** in stock detail (wires the existing endpoint) | admin `6e3737c` |
| 6 | 🟠 | Reject / partial-approve gives the store **no reason** | **Reject reason** prompt + **approve note**; persisted + shown to the store | be `bf6c396`; admin `27846fd`, `393f019` |
| 7 | 🟠 | Approve screen shows **blank availability** past 200 SKUs (page-1 only) | Approve fetches availability for **exactly the requested SKUs** (`?skus=`) | be `6224778`; admin `f513aac` |
| 8 | 🟡 | **warehouse_staff can't view warehouses/stock/suppliers** (read gated on `manage`) → can't even reach goods-receipt | Read gates relaxed to **any warehouse role**; mutations stay on `manage` | be `2bd207d` |
| 9 | 🟡 | Buttons gated by **role** not **permission** → staff see New/Edit/Delete + Approve/Reject/Fulfil that 403 | Buttons **permission-gated** to match the backend | admin `2399299` |
| 10 | ⚪ | Goods-receipt accepts **₹0 cost** silently (poisons weighted-avg cost / COGS) | **Warns on ₹0 cost** | admin `6e3737c` |
| 11 | ⚪ | Goods-receipt accepts a **past expiry** silently | **Warns on past expiry** | admin `6e3737c` |
| 12 | ⚪ | Batch Recall needs the **exact batch no.** typed — no browse / "all held/recalled/expiring" view | ⏳ **Deferred** — needs a new batch-by-status list endpoint (trace-by-batchNo + per-SKU lots already exist) | — |
| 13 | ⚪ | No **CSV export** of warehouse stock (stock-take / audit) | **Stock CSV export** on the warehouse stock table | admin `545b472` |
| 14 | ⚪ | Top-bar 🔔 **bell is a dead button** | ⏳ **Deferred** — cross-role, no notification backend yet | — |
| 15 | ⚪ | The assigned **warehouse is never named** in the UI; role can open other warehouses | Addressed by #1 (dashboard names the warehouse via the new me-field). Cross-warehouse access review left as a note | be `2bd207d` |

### ✅ Status — fixes shipped (branch `feat/inventory-v2-admin-gaps`)
All blockers + medium + role-separation + the two low-risk polish items are **done** on
`feat/inventory-v2-admin-gaps` (haper-backend + haper-admin, into `dev`, **not merged** — user merges).
**Deferred by decision:** #12 (recall browse), #14 (dead bell). #15 partially (warehouse named on the dashboard).
**Verification:** the touched backend suites are green, incl. a complementary write-off test
(`warehouse-writeoff.test.js`) covering the two paths the parallel `admin-gaps` test misses — the **batch-ledger
FEFO write-off** (txn + FEFO + roll-up) and the **COUNT→MANUAL_ADJUST** reason mapping. Also fixed a
**duplicate `servedStores` object key** (`no-dupe-keys`) that landed in `warehouse/controller.js`. Note: the
full admin suite has an **intermittent isolation flake** in `health.test.js` — one run showed it 401-ing,
a re-run was fully green (37 suites / 715 tests) and it passes **16/16 in isolation**; the failing case is
unrelated to any warehouse-manager change. Pre-existing, worth a separate look.

---

## CH-8 · Customer-visible picking quantity changes (`order.adjustments[]`) — backend + android + ios + web DONE
**Bug:** a picker short-pick / out-of-stock only showed in **Admin → Order Activity**. For a **COD** order
(no refund entry) the customer app showed the new lower quantity with **no indication it had changed** —
the user had no visibility (reported on order **HP50999049**). Push notifications exist but are
fire-and-forget (no in-app inbox), so a missed push left no record.
**Backend:** ✅ on `dev` — new nullable, always-emitted `adjustments[]` on the order
(`itemId, name, originalQty, newQty, reason, note, at`). Written by the picking short-pick + OOS paths
(via `applyItemEdit`'s opt-in `adjustment` param) for **every** payment method — folded into the same
single atomic order write as the refund. Admin edit path unchanged (doesn't pass `adjustment`).
Returned by `getOne`/`getAll` automatically (exclusion projection). Tests in `packages/picking`.
**Plain summary:** the order now carries a durable "what changed during picking" list the customer app reads.

| Client | What to do | Status |
|---|---|---|
| **backend (do FIRST)** | `adjustments[]` on orders schema; record in `shared/utils/order-edit.utils.js` (gated by `adjustment` param); pass it from `packages/picking/.../task/controller.js` short-pick + OOS. Nullable/defaulted = Gson-safe. | ✅ done (dev) |
| **android** | Order model: `adjustments: List<OrderAdjustment>?` (nullable, A1). OrderDetailScreen: "Changes while preparing your order" card (Qty X → Y / Removed + reason), above Wallet refunds. | ✅ done (dev) |
| **ios** | `OrderAdjustment` struct + `adjustments` on `Order` (decode-safe `?? []`); `adjustmentsCard` in OrderDetailView above the refunds card. Builds clean. | ✅ done (dev) |
| **web** | `OrderAdjustment` in `types.ts` + `adjustments?` on `Order`; amber "Changes while preparing your order" section in `pages/OrderDetail.tsx` above Wallet refunds. `tsc` clean. | ✅ done (dev) |
| **admin** | **Not needed** — admin already surfaces these picker changes (richer: before/after, who, when, reason) via the **Order Activity** audit trail: order modal section + `/order-activity` page + order-list history icon (`OrderDetailsModal.tsx`, `OrderActivityPage.tsx`, `orderAudit.ts`). No customer-style card added. | — |
| **picker / delivery** | Not affected (this is a customer-facing surface). | — |

**Decode-safety:** `adjustments` is always emitted (`default: []`) and declared nullable on clients, so old
app builds decode it to null/empty and just don't show the card — no crash (memory `android_gson_kotlin_defaults`).
**Test guide:** `haper-misc/test-picking.md` §O + verification table.

---

## CH-9 · Super-admin notification opens a blank Order Details popup — backend + admin DONE
**Bug (Issue 4):** a super admin gets store push notifications for **every** store. Clicking one deep-links
to `/orders?orderId=<mongoId>` and opens the Order Details modal. If the super admin had switched their UI
into a **different** store (the axios interceptor sends `x-store-id`), `GET /admin/order/:id` was scoped to
that store → the cross-store order returned **null** → the modal showed a **blank shell** (because
`normalizeOrder(null)` spread null into a truthy empty object, bypassing the `!order` guard).
**Plain summary:** a super admin can open any store's order from a notification; a missing order shows an
error, never a blank popup.

| Client | What to do | Status |
|---|---|---|
| **backend (do FIRST)** | `getOrder` + `getOrderAudit` (haper-backend `packages/admin/.../order/controller.js`) now treat **super_admin as global** (not scoped to the selected `x-store-id` store); store/manager/support stay scoped to their own store. Tests in `order-detail-scope.test.js`. | ✅ done (dev) |
| **admin** | `normalizeOrder(null)` now returns **null** (so a missing order can't render as a blank shell); `OrderDetailsModal` clears `order` on a failed/empty fetch → shows its **"Order data could not be loaded."** state instead of blank. (`src/utils/orders.ts`, `src/pages/Orders/OrderDetailsModal.tsx`.) | ✅ done (dev) |
| **web / android / ios / picker / delivery** | Not affected (admin-only surface). | — |

**Related (not fixed here, flag if it bites):** the same `x-store-id` scoping means a super admin **acting** on a
cross-store order (mark-status / assign / edit) can still hit "Order not found" via `markOrderAdmin`/`assignOrder`,
which look up by `req.store`. The **view** is fixed; if cross-store *actions* are needed, switch the super admin's
store context to the order's store first, or extend the same super-admin-global rule to those handlers.

---

## CH-10 · Editing item quantity on a batch store did nothing (showed stock but OOS) — backend + admin DONE
**Bug:** on a store with `config.batchesEnabled=true`, an item's `quantity` is a **derived rollup of its batches**
(`Σ qtyRemaining`, recomputed by the ledger) and orders consume **batches** via FEFO. Editing quantity on the
**item-edit form** (`PUT /admin/item/:id`, plain `$set quantity`) set a number backed by **no sellable batch**
→ the item showed stock but was **OOS at order time**, and the next rollup reset it. Stock must go through
**Stock In** (`PATCH /admin/item/:id/quantity`), which creates a real batch.
**Plain summary:** on batch stores, the edit-form quantity is now ignored (backend) and locked (admin UI); use Stock In.

| Client | What to do | Status |
|---|---|---|
| **backend** | `updateItem` (`packages/admin/.../items/controller.js`) strips `quantity` from the edit when `StoreBatchRepository.isStoreBatchEnabled(storeId)` — non-batch stores unchanged. Tests in `items.test.js`. | ✅ done (dev) |
| **admin** | `ItemModal` fetches the active store's `config.batchesEnabled` and, when on, renders the Quantity field **read-only** with a hint pointing to **Stock In** (`src/pages/Items/ItemModal.tsx`). Best-effort; backend is the authoritative guard. | ✅ done (dev) |
| **web / android / ios / picker / delivery** | Not affected (admin-only surface). | — |

**Batch visibility (answer to the follow-up):** store-level batches are shown **only in the Warehouse section** —
Item Lookup (`/admin/warehouse/:wid/items/:itemId/batches`), Stock Health, and **Batch Recall** (`/recall`) — gated
by `WAREHOUSE.VIEW_LEDGER`. So **super_admin** and **warehouse_manager** can see batches there; a **store_admin**
(Items screens only) currently has **no batch viewer**. A store-facing "batches for this item" panel on the item
detail would close that gap — not built yet.

---

## Future changes
**This file is COMPLETE for inventory-v2** — CH-1…6 cover every shipped backend change (Phases 0–4) with a
per-client checklist + exact endpoints, and CH-7 covers the one optional P9 item (with its backend prerequisite).
**Customer-app surface across the whole project:** only **CH-5** adds fields to a customer-facing model (the order
line) — guard the Android/iOS decoders (don't declare `iId`/`batchAllocations` non-null). Everything else is
admin-only, and the apps already read the per-store `items` display fields unchanged.

For any FUTURE backend change beyond inventory-v2, add a new `CH-N` block above with the same per-client checklist.
Design source: `haper-misc/inventory-v2-design.md` (§7 = client scope; §11.9–§11.13 = what each phase shipped).
