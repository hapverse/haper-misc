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
The android cells in CH-1/CH-2/CH-6 are **verified decode-safe** (see "Verified SAFE" above) and CH-5 is
**decode-safe but left ⏳** pending the **A2** regression test + the **A1** refunds hardening. Flip them to ✅
when A1/A2 land. CH-3/CH-4 android = `—` (not affected).

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
won't fetch per rules) — findings are from code trace + route-liveness. **Only remaining go-live step = the PROD
migration** (`npm run migrate:apply`, 7 idempotent steps) — dev is fully migrated, prod is run by the user when ready.

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
1. **B1** batch toggle (else the batch feature stays off in real use). 2. **B2** image upload (before onboarding a real catalog). 3. **B3** all-stores item create. 4. Backlog: **B4/B5/B6**. 5. **B7** when going multi-state. (Run the **prod migration** whenever you're ready to take inventory-v2 live in production — dev is already there.)

---

## Future changes
**This file is COMPLETE for inventory-v2** — CH-1…6 cover every shipped backend change (Phases 0–4) with a
per-client checklist + exact endpoints, and CH-7 covers the one optional P9 item (with its backend prerequisite).
**Customer-app surface across the whole project:** only **CH-5** adds fields to a customer-facing model (the order
line) — guard the Android/iOS decoders (don't declare `iId`/`batchAllocations` non-null). Everything else is
admin-only, and the apps already read the per-store `items` display fields unchanged.

For any FUTURE backend change beyond inventory-v2, add a new `CH-N` block above with the same per-client checklist.
Design source: `haper-misc/inventory-v2-design.md` (§7 = client scope; §11.9–§11.13 = what each phase shipped).
