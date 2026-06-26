# Client follow-ups — change tracker

Every backend change that *might* need a matching change in a client app goes here,
with a checklist for **each** client so nothing is missed.

**Clients:** `admin` (ops console) · `web` (customer site) · `android` · `ios` ·
`delivery` (rider app) · `picker` (picker app).

**Status key:** ✅ done · ⏳ to do · ❓ verify (probably nothing) · — not affected

## How to use (new session)
> **GATE (decided 2026-06-26):** client work begins **only after the ENTIRE backend is done** (all inventory-v2
> phases). Until then this is a **forward-planning list** — keep adding `CH-N` blocks as backend changes ship, but
> do NOT start client edits yet. **Client order = the user decides later.**

1. Read this file.
2. To work, say e.g. **"let's do the admin client changes"** (or name any client / change).
   The session picks the pending (⏳ / ❓) items for that client, implements them
   one by one, and flips the status here when done.
3. Backend-first: only start client work after the backend change is merged-ready
   (see `haper-misc/inventory-v2-design.md`).
4. **Android/iOS rule:** any NEW field in an item/order/category JSON must be
   nullable or always-sent, or old app versions can crash (see memory
   `android_gson_kotlin_defaults`).

---

## CH-1 · Global categories + per-store enable/disable
**Backend:** `feat/inventory-v2` (haper-backend) — committed + pushed; PR into `dev` pending.
**Plain summary:** categories/sub-categories are now ONE shared list for all stores
(not a copy per store). A store's categories appear automatically based on what it
stocks. Only head office (super admin) can create / rename / delete a category; a
store admin can only turn a category **on/off** for their own store.

| Client | What to do | Status |
|---|---|---|
| **admin** | • Drop the "store / add-to-all-stores" picker when creating a category or sub-category — they're global now, so it's one create.<br>• Show **Create / Rename / Delete** for category & sub-category **only to super admin**; hide for store admin & manager (backend now returns 403 for them).<br>• Add a per-store **on/off toggle** on each category for store admins → calls `PATCH /admin/category/:id/store-state` with `{ "enabled": true|false }`.<br>• Category list can show all global categories + this store's item count + the on/off state.<br>• Item add/edit: the category dropdown is just the global list (no per-store filtering). | ⏳ to do |
| **web** | No code change expected — the customer category & sub-category responses are the **same shape**; categories now show up automatically when the store stocks an item. Just verify browsing + store-switch still work. | ❓ verify |
| **android** | No new fields were added to the category JSON → no Gson crash risk, no change expected. Verify category browse. | ❓ verify |
| **ios** | Same as android — no change expected; verify. | ❓ verify |
| **delivery** | Not affected (riders don't use categories). | — |
| **picker** | Not affected (works on items/tasks, not category management). | — |

**Backend endpoints for clients (CH-1):**
- **NEW** `PATCH /admin/category/:categoryId/store-state` — body `{ enabled: boolean }`,
  needs `x-store-id` — store admin/manager turns a category on/off for the current store.
- Category create / update / delete / activate — now **super-admin only** (others get 403).
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
| **admin** | • Stock-In / Stock-Adjust modal (`PATCH /admin/item/:id/quantity`) **may** add 3 optional fields: `batchNo`, `costPrice`, `expiresAt` (so a received lot records its real cost/expiry). All optional — sending just `quantity` still works.<br>• A **negative** `quantity` now means "adjust down" and is **rejected (400) if it exceeds stock** (previously it could go negative) — surface that error.<br>• Response shape is now `{ acknowledged, matchedCount, modifiedCount, data:{ quantity } }` — read `data.quantity` for the new total if needed.<br>• (Optional, ops) a per-store "batch tracking" toggle if you want to flip `config.batchesEnabled` from the UI; otherwise it's set by ops during rollout. | ⏳ to do |
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
| **admin** | • Goods-receipt (`POST /admin/procurement/receive`): surface a per-line **batch-no** field (auto / supplier-printed / manual) alongside the existing cost + expiry (re-receiving the same `batchNo` merges).<br>• Warehouse stock view: `costPrice` is now weighted-avg, `expiresAt` is the earliest open lot — labels/tooltips can say so. Optionally a per-row "view batches" drill-down.<br>• Transfer detail: each line now carries `batchAllocations: [{batchNo, qty, costPrice, expiresAt}]` (the lots shipped) — show if useful.<br>• Stock-movement/ledger views now have real `batchNo` + `iId` fields (was free-text note).<br>• **Recall** UI: trace a batch via `GET /admin/procurement/batch/:batchNo` (lists warehouses + stores holding it) and quarantine/re-instate a lot via `PATCH /admin/procurement/batch/status` (HOLD / RECALL / AVAILABLE). **Backend route now built.**<br>• (Optional, ops) per-warehouse "batch tracking" toggle for `warehouse.batchesEnabled`. | ⏳ to do |
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
| **admin** | • Warehouse stock view: show **Available / Reserved / In-transit** columns + **Free-to-promise (Available − Reserved)** (new fields `reservedQty`, `inTransitQty` on warehouse-stock rows).<br>• Replenishment **approve** screen: it now **enforces** free-to-promise — `POST /admin/replenishment/:id/approve` returns **400** if the approved qty exceeds it (previously always succeeded). Show free-to-promise per line and handle the 400 gracefully.<br>• Replenishment status legend gains **EXPIRED** (auto-released stale approval; can be re-raised).<br>• **Status legends everywhere** (standing UX rule): Available/Reserved/In-transit, Free-to-promise, batch AVAILABLE/HOLD/RECALL, replenishment PENDING/APPROVED/PARTIALLY_APPROVED/FULFILLED/REJECTED/CANCELLED/**EXPIRED**, transfer CREATED/DISPATCHED/RECEIVED/CANCELLED.<br>• The old `GET /admin/replenishment/committed` hint still works but is superseded by `reservedQty` — can switch the screen to the real bucket. | ⏳ to do |
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

## Future changes
Phase 2 (batches/FEFO + warehouse batches + reservations) is logged above (CH-2/3/4) — all
**admin-only**, customer apps unaffected (no new customer JSON fields yet). The **android/iOS Gson
rule first bites in Phase 3**, which adds `iId` + `batchAllocations` to **order** lines (must be
nullable / always-emitted). For each later backend change (Phase 3 per-batch COGS + reporting,
Phase 4 product master — or anything else), add a new `CH-N` block above with the same 6-client
checklist. Design source: `haper-misc/inventory-v2-design.md` (§7 = client scope).
