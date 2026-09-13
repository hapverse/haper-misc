# Plan — Store → Warehouse Returns from the Admin App

> **AUTHORIZATION-BOUNDARY CHANGE.** This plan gives `store_admin` a write capability it does not have today (moving stock out of a store into a company warehouse). It must pass the project's approval gate — **no code is written until the user approves and `rajit-backend-arch` signs off on §3.1–§3.4**. Nothing here has been implemented.

---

## 1. Goal

A store admin can open the Transfers screen in the admin app, pick items off their own shelf, say how many go back, and send them to the warehouse that supplies them. The warehouse then sees that return in its transfer list, scans the items in, and the units land back in warehouse stock. A super admin can do the same for any store. Today this only exists as a super-admin API call and a one-off CSV migration script.

### Acceptance criteria ("done" means)

- [ ] A `store_admin` logged into Store A sees a **"Return to warehouse"** action on `/transfers` and can create a return draft containing only Store A's items.
- [ ] A `store_admin` **cannot** create a return for any store other than their own — the store is never taken from the request body for them.
- [ ] A `store_admin` **cannot** create a forward (warehouse → store) transfer. This is unchanged from today.
- [ ] The destination warehouse is chosen by the server from the store's `servingWarehouseId`; the store admin never picks it.
- [ ] The store admin can **dispatch** their own return (store stock goes down at this moment, FEFO) and **cancel** it (stock comes back, with its original batch cost + expiry).
- [ ] A `store_admin` attempting to dispatch or cancel a **forward** transfer gets a 403.
- [ ] A `warehouse_manager` / `warehouse_staff` can see the incoming return in the list and **receive** it (barcode scan per line, partial receive supported) — warehouse stock rises only on receive.
- [ ] The transfer list visually distinguishes a return from a forward transfer, and can be filtered to one direction.
- [ ] A printed pick slip for a return reads "From store … / To warehouse …", not backwards.
- [ ] Returning more than the shelf holds fails cleanly: warned in the UI before submit, and hard-blocked at dispatch with a message naming the item. No negative stock, ever.
- [ ] Every existing forward-transfer behaviour (create, edit items, dispatch, receive, cancel, discrepancy report, replenishment fulfilment) behaves exactly as it does today.
- [ ] `haper-misc/test-inventory.md` gains a Store Return walkthrough.

---

## 2. Current state (verified by reading the code)

### Backend — the mechanism is complete, the door is locked

| File | State |
|---|---|
| `/Users/office/Documents/haper/haper-backend/packages/shared/models/stock-transfers.schema.js` | `direction` field exists (default `WAREHOUSE_TO_STORE`), documented `.lean()` trap: absent ⇒ forward. `batchAllocations` per line. |
| `/Users/office/Documents/haper/haper-backend/packages/shared/utils/transfer-direction.utils.js` | `isReturnTransfer` / `isForwardTransfer` / `normalizeDirection` / `forwardOnlyQuery`. Complete, reuse as-is. |
| `.../packages/shared/constants/inventory.constant.js` | `transferDirection`, `movementType.RETURN_OUT` / `RETURN_IN` all present. |
| `.../packages/admin/src/routes/transfer/controller.js` | `dispatchReturnFromStore` (L145), `receiveLineToWarehouse` (L184), `cancelReturnToStore` (L226). `dispatch`/`receive`/`cancel` all branch on `isReturnTransfer` and assert the **correct location per direction**. This is real, working, reviewed code. |
| `.../routes/transfer/controller.js:278` | `if (direction === STORE_TO_WAREHOUSE && !isSuperAdminReq(req)) → 403`. The named gate. |
| `.../routes/transfer/router.js:23` | `warehouseOnly = requireRole(SUPER_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_STAFF)` on `POST /`, `/dispatch`, `PATCH /items`, `/cancel`. |
| `.../src/middleware/inventory-context.js` | `resolveStoreId` / `assertStoreAccess` / `resolveWarehouseId` / `assertWarehouseAccess` / `applyListScope`. **This is the established store-scoping pattern to reuse.** |
| `.../src/middleware/permission.js:31` | 🚨 `store_admin` returns `true` for **every** permission check. Permission gates are no-ops for them; `requireRole` is the only real control. |
| `.../routes/replenishment/controller.js:31-60` | The canonical "store role initiates something toward the warehouse" handler: `resolveStoreId` → `assertStoreAccess` → `StoreRepository.getById` → `WarehouseRepository.resolveServingWarehouse(store)`. **Copy this shape.** |
| `scripts/migrations/store-return-transfer.core.js` | Reference for the exact request bodies (`buildCreateBody` L355, `buildReceiveBody` L375). Reference only — not reused, not deleted by this work. |

### The five gates a `store_admin` hits on `POST /admin/transfer` today

The brief names one. There are five, in this order:

1. `router.js:27` `warehouseOnly` → **403**
2. `requirePermission(WAREHOUSE.MANAGE_TRANSFERS)` → *passes* (implicit `*`)
3. `controller.js:269` `resolveWarehouseId(req, body.warehouseId)` → store admin is neither super nor warehouse role, falls to the super branch, has no `req.warehouse` → **400** unless they supply a warehouseId themselves
4. `controller.js:270` `assertWarehouseAccess` → **403**
5. `controller.js:278` the `!isSuper` return gate → **403**

Changing only #5 leaves the endpoint returning 403. This is the single most important correction to the brief's framing.

### Two gaps the brief did not name

- **The store admin can't dispatch what they create.** `POST /:id/dispatch` is `warehouseOnly` at the router. A store admin's return would sit as a `CREATED` draft that only a super admin can push. Same for `/cancel`. The *controller* is already correct (`isReturn ? assertStoreAccess : assertWarehouseAccess`) — only the router gate blocks them.
- **The warehouse can't receive a return.** `POST /:id/receive` is gated on `requirePermission(REPLENISHMENT.RECEIVE_TRANSFER)`. `WAREHOUSE_MANAGER_PRESET` and `WAREHOUSE_STAFF_PRESET` (permission.constant.js:238, 251) contain **no** `REPLENISHMENT.*` permission. So today only a super admin or a store role can receive — the return dead-ends at its last step.

### Admin frontend — direction is entirely invisible

- `/Users/office/Documents/haper/haper-admin/src/types/warehouse.ts:76` — `StockTransfer` has **no `direction` field**.
- `grep -rn "direction" src/` returns only CSS `flex-direction`. The whole app is direction-blind.
- `src/pages/Warehouse/TransfersPage.tsx` — subtitle hardcodes "Move stock from a warehouse to a store"; `canManage = can.role('super_admin','warehouse_manager','warehouse_staff')` (line 31, correctly role-gated to mirror the backend); `createTransfer` (L433) never sends `direction`.
- `src/utils/pickSlipPrint.ts:79-80` — hardcoded `From warehouse:` / `To store:`.
- `src/pages/Warehouse/statusMeta.ts:15-18` — all four status descriptions are forward-only prose.
- `src/App.tsx:216` + `src/hooks/useMenu.ts:158` — `/transfers` is `requireAnyPermission(MANAGE_TRANSFERS, RECEIVE_TRANSFER)`, so a `store_admin` **already reaches the page today** (implicit `*`), sees the list, sees Receive but no create/dispatch/cancel buttons. Good news: no routing or menu change is needed.
- `src/pages/Warehouse/useItemSearch.ts` — `CatalogItem` **already carries `quantity`** (the store's on-hand). The return picker gets its stock cap for free; no new endpoint.

### Tests

- `packages/admin/__tests__/transfer-list-scope.test.js` — the convention to follow: supertest against the real app, in-memory Mongo, real `AdminModel` rows via `testUtils.generateStoreAdmin` / `generateWarehouseManager` / `generateSuperAdmin`, and assertions on returned **rows** (not just status codes).
- `grep -rl STORE_TO_WAREHOUSE packages/*/__tests__` → **zero hits.** The entire return lifecycle has no test coverage today, only the migration-script core tests. Everything in §8 is net-new coverage.
- `haper-admin`: Vitest, baseline = 273 tests with exactly 5 known-failing `OrderDetailsModal` tests.

---

## 3. Proposed design

### 3.1 A NEW dedicated route, not a widened one

**Decision: add `POST /admin/transfer/return`. Leave `POST /admin/transfer` byte-identical.**

Rejected alternative: add `STORE_ADMIN` to `warehouseOnly` on `POST /` and branch inside `create`. That widens the gate protecting *forward* creation and then re-narrows it in the handler — a store admin would momentarily be one missing `if` away from pulling warehouse stock into their own store with no warehouse approval. It also makes "did the forward flow change?" un-provable.

The new route:
- **Body carries no `direction`** — the handler forces `STORE_TO_WAREHOUSE`. A store admin cannot craft a forward transfer through it.
- **Body carries no `warehouseId`** — the destination is derived server-side (§3.3). A store admin cannot aim stock at an arbitrary warehouse.
- Super admin keeps the existing `POST /` + `direction` path unchanged, so the migration script and any existing caller keep working verbatim.

### 3.2 Authorization — reusing the established pattern

Router (`routes/transfer/router.js`):

```
router.post("/return",
  requireRole(R.SUPER_ADMIN, R.STORE_ADMIN),          // the ONLY real control (implicit-* roles)
  requirePermission(P.REPLENISHMENT.RETURN_STOCK),    // new; blocks manager/support, documents intent
  validator.createReturn,
  controller.createReturn);
```

Controller (`createReturn`) — **the exact shape of `replenishment/controller.js` `create`**, which is this codebase's established store-scoped write:

```
const storeId = resolveStoreId(req, req.body.storeId);   // store roles PINNED to req.store; a mismatched body storeId ⇒ 403
assertStoreAccess(req, storeId);                          // belt-and-braces, same as replenishment.create
const store = await StoreRepository.getById(storeId);     // 404 if gone
const warehouse = await resolveReturnWarehouse(store);    // §3.3 — never from the body
// … resolveLineItem per line (unchanged helper) …
StockTransferRepository.create({ warehouseId: warehouse._id, storeId,
  direction: transferDirection.STORE_TO_WAREHOUSE, items: lines, note, createdBy: req.admin._id });
```

`resolveStoreId` is the utility to cite: for a non-super caller it **ignores** any `storeId` in the body unless it matches `req.store._id`, else 403. For a super admin it accepts an explicit `storeId` or the `x-store-id` header. That is precisely the "own store only / super admin anywhere" rule, already reviewed and already used by replenishment.

**New permission constant** in `packages/shared/constants/permission.constant.js`:
```
REPLENISHMENT.RETURN_STOCK = "replenishment.return_stock"
```
Deliberately added to **no preset** in phase 1 (same reasoning the file already documents for `DISCOUNTS` / `COUPONS`): only `super_admin` and `store_admin` hold it, both via implicit `*`. Adding it to `MANAGER_PRESET` later is a one-line additive change. It joins `ALL_PERMISSIONS` automatically.

### 3.3 Destination warehouse resolution — the security-critical detail

```
const resolveReturnWarehouse = async (store) => {
  if (!store.servingWarehouseId) throw new errorUtils(
    "This store has no serving warehouse set — ask a super admin to set one before returning stock.", 400);
  const wh = await WarehouseRepository.getById(store.servingWarehouseId);
  if (!wh || wh.status !== ACTIVE) throw new errorUtils("The store's serving warehouse is not active.", 400);
  return wh;
};
```

**Deliberately NOT `WarehouseRepository.resolveServingWarehouse(store)`.** That helper falls back to a case-insensitive `region` match sorted by `createdAt` when `servingWarehouseId` is null — so a Bihar store with no explicit link would push stock into "whichever Bihar warehouse was created first". Fine for a store *asking* for stock (replenishment); not fine for a store *pushing* stock. Fail closed with an actionable message instead. Flagged as **Q4**.

### 3.4 Widening dispatch / cancel / receive

Three gate edits, each safe because the controller already asserts the correct location per direction:

| Route | Today | Change | Why it's safe |
|---|---|---|---|
| `POST /:id/dispatch` | `warehouseOnly` | `requireRole(SUPER_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_STAFF, STORE_ADMIN)` | Controller L369: `isReturn ? assertStoreAccess : assertWarehouseAccess`. A store_admin on a forward transfer hits `assertWarehouseAccess` → 403. A store_admin on another store's return hits `assertStoreAccess` → 403. |
| `POST /:id/cancel` | `warehouseOnly` | same widened guard | Controller L609: identical branch. |
| `POST /:id/receive` | `requirePermission(RECEIVE_TRANSFER)` | `requireAnyPermission(RECEIVE_TRANSFER, WAREHOUSE.MANAGE_TRANSFERS)` | Controller L424: `isReturn ? assertWarehouseAccess : assertStoreAccess`. A warehouse role newly passing the gate on a *forward* transfer hits `assertStoreAccess` → 403. Forward behaviour unchanged. |

The long NOTE comment at `router.js:13-22` (which currently asserts "creating a return is super-admin only") **must be rewritten** in the same commit, or it becomes actively misleading documentation.

`PATCH /:id/items` is **left alone.** It calls `assertWarehouseAccess` unconditionally with no direction branch, so a store admin can never edit a draft return. Phase-1 behaviour: cancel the draft and create a new one. Listed as **Q5**.

### 3.5 Data flow (stock movement)

```
store_admin                                    warehouse_manager
    │
    │ POST /admin/transfer/return
    │   storeId ← req.store (pinned)
    │   warehouseId ← store.servingWarehouseId (server-derived)
    ▼
 CREATED  ── no stock moves, nothing reserved (returns reserve nothing)
    │
    │ POST /:id/dispatch   (assertStoreAccess)
    │   per line: ItemRepository.sellFEFO(storeItemId, qty)
    │     └─ batch store: FEFO lots out; flat store: {quantity: {$gte: qty}} $inc -qty
    │     └─ ok:false ⇒ throw ⇒ WHOLE txn aborts, no partial dispatch
    │   ledger: recordStore RETURN_OUT (-qty), balanceAfter re-read in-session
    │   lots stamped onto line.batchAllocations
    ▼
 DISPATCHED ── units are "in transit", held on the transfer doc.
    │           Warehouse reserved/inTransit buckets DELIBERATELY untouched
    │           (they mean "committed to leave the warehouse").
    │                                            │ POST /:id/receive (assertWarehouseAccess)
    │                                            │   pre-txn: ensurePlaceholder(warehouseId, sku, {name})
    │                                            │     ← prevents a NAMELESS upserted row for a SKU
    │                                            │       the warehouse has never held
    │                                            │   mandatory barcode scan per arrived line
    │                                            │   per line: returnToBatch (exact cost+expiry) or increment
    │                                            │   ledger: recordWarehouse RETURN_IN (+recv)
    ▼                                            ▼
 CANCELLED (from CREATED: no-op)              RECEIVED
 CANCELLED (from DISPATCHED, store_admin):
   cancelReturnToStore → applyStockIn per lot, source=RETURN
   ledger: MANUAL_ADJUST, reason "return_cancelled_restock"
```

Money note: nothing here touches revenue or profit. Profit/COGS reads the sale-time `orders.items.costPrice` snapshot, never live stock cost, so returning units cannot retroactively move any reported number. No `hemant-payments` involvement.

---

## 4. Data model changes

**None.** No new collection, no new field, no migration, no index.

`stock-transfers` already carries `direction`, `batchAllocations`, and both `warehouseId` + `storeId` on every doc, and is already indexed `{storeId:1, status:1, createdAt:-1}` and `{warehouseId:1, status:1, createdAt:-1}` — both of which serve the list queries a return produces. The only "schema-adjacent" change is one new string in `permission.constant.js`, which is a constant, not persisted state.

`aabha-dba` involvement: **not required.** One optional 10-minute review — confirm the two existing compound indexes cover a `{storeId, direction, status}` filtered list without a new index, given the direction filter is added client-side to an already-indexed query. Low priority.

---

## 5. API contract

### New

```
POST /admin/transfer/return
Auth: Bearer admin JWT
Roles: super_admin | store_admin
Permission: replenishment.return_stock

Request:
{
  "storeId": "<24hex>",         // OPTIONAL. Ignored for store_admin (pinned to req.store);
                                //           required for super_admin unless x-store-id is set.
  "note": "string, max 500",    // optional
  "items": [ { "storeItemId": "<24hex>", "quantity": <int >= 1> } ]   // 1..500
}
// NOTE: no `direction`, no `warehouseId` — both are server-decided.

200 { "msg": "Return created", "data": { "transfer": { ...direction: "STORE_TO_WAREHOUSE", status: "CREATED" } } }
400  storeId missing for super admin / store has no serving warehouse / warehouse inactive /
     item not in this store / item has no barcode / Joi violation
403  store_admin passing another store's storeId; role not allowed
404  store not found
```

### Unchanged in shape, widened in audience

| Endpoint | Change |
|---|---|
| `POST /admin/transfer/:id/dispatch` | `store_admin` may now call it **for their own store's return only**. Request/response shape unchanged. |
| `POST /admin/transfer/:id/cancel` | Same. |
| `POST /admin/transfer/:id/receive` | Warehouse roles now pass the permission gate (for returns; forward still 403s in the handler). Shape unchanged. |
| `GET /admin/transfer?direction=STORE_TO_WAREHOUSE` | Already implemented and validated. No backend change; the FE starts using it. |
| `GET /admin/transfer/:id` | No change. `direction` already on the doc. |

### Explicitly unchanged

`POST /admin/transfer` (forward create + the super-admin return path the migration script uses), `PATCH /admin/transfer/:id/items`, `GET /admin/transfer/discrepancies`, the whole `/admin/replenishment` router.

---

## 6. Step-by-step build order

Each numbered item is one reviewable change. **Phase 0 gates everything.**

### Phase 0 — approvals (no code)

0.1 **User approves this plan.**
0.2 `rajit-backend-arch` signs off specifically on §3.1 (new route vs widened gate), §3.2 (`resolveStoreId` reuse + role-only control for implicit-`*` roles), §3.3 (no region fallback), §3.4 (three gate widenings justified by handler-level asserts).
0.3 `chanchal-designer` produces the visual spec for §6.C.1 and §6.C.2 (see §6.D). **No FE code before sign-off**, per the project's design-first rule.
0.4 `arijit-frontend-arch`: one-pass review of "sibling modal vs third mode on `CreateTransferModal`" (§6.C.2). Expected to be light-touch; escalate only if they want a different component boundary.

### Phase A — backend permission + route (rajit-backend-arch)

**A1.** `packages/shared/constants/permission.constant.js` — add `REPLENISHMENT.RETURN_STOCK = "replenishment.return_stock"`. Add to **no** preset. Confirm it flows into `ALL_PERMISSIONS`.

**A2.** `packages/admin/src/routes/transfer/validator.js` — add `createReturn`: `{ storeId?: objectId, note?: string(max 500), items: [{storeItemId, quantity:int>=1}] (1..500) }`, **`.unknown(false)`** so a stray `direction` or `warehouseId` is a 400, not silently ignored.

**A3.** `packages/admin/src/routes/transfer/controller.js` — add `resolveReturnWarehouse(store)` helper + `createReturn` handler (§3.2/§3.3). **Do not touch `create`.** Reuse the existing `resolveLineItem` helper verbatim.

**A4.** `packages/admin/src/routes/transfer/router.js` — register `POST /return` **before** `/:transferId` sub-routes are irrelevant (it's a POST on a distinct path, but keep it above the `/:transferId/*` block for readability). Import `resolveStoreId`/`assertStoreAccess` where needed.

**A5.** `router.js` — widen `/dispatch` and `/cancel` role guards (§3.4) via a new named `dispatchOrCancelRoles` const; widen `/receive` to `requireAnyPermission`. **Rewrite the NOTE comment at L13-22.**

**A6.** Tests — new `packages/admin/__tests__/transfer-return-store-initiated.test.js` (§8.1). Run `cd packages/admin && NODE_ENV=test npx jest` (in-memory Mongo only).

### Phase B — backend hardening (rajit-backend-arch, same PR or immediately after)

**B1.** Regression test file asserting the forward flow is untouched: store_admin → `POST /` 403; store_admin → dispatch a forward transfer 403; warehouse_manager → receive a forward transfer 403; super_admin → `POST /` with `direction: STORE_TO_WAREHOUSE` still works (the migration script's path).

### Phase C — admin frontend (platform FE engineer, after 0.3 + 0.4)

**C1. Make direction visible (must land before C2).**
- `src/types/warehouse.ts` — `direction?: 'WAREHOUSE_TO_STORE' | 'STORE_TO_WAREHOUSE' | null` on `StockTransfer`. **Optional**, because legacy `.lean()` docs have no key.
- New `src/pages/Warehouse/direction.ts` — FE mirror of the backend util: `isReturnTransfer(t) => t.direction === 'STORE_TO_WAREHOUSE'`, `directionLabel(t)`. **Positive test only** — never `=== 'WAREHOUSE_TO_STORE'`.
- `TransfersPage.tsx` — direction badge/column, a direction filter `<select>` wired to the existing `?direction=` param, direction-aware action gating (`canManage` for forward; a new `canReturn = can.role('super_admin','store_admin')` + own-store check for returns), direction-aware "Store" column header and page subtitle.
- `src/utils/pickSlipPrint.ts` — swap the `From/To` labels when the transfer is a return.
- `src/pages/Warehouse/statusMeta.ts` — either neutral status prose or a `TRANSFER_RETURN_STATUSES` variant.

**C2. The return entry point.**
- `src/api/inventory.ts` — `createReturnTransfer(body: { storeId?, items, note? })` → `POST /admin/transfer/return`. No `withWarehouse(...)` wrapper (there is no warehouse to send).
- New `src/pages/Warehouse/ReturnToWarehouseModal.tsx` — a **sibling** of `CreateTransferModal`, not a third mode on it. `CreateTransferModal` already carries create+edit modes plus a warehouse stock-hint effect; a third branch is where the regression lands. The sibling imports the same `ui.tsx` primitives (`Modal`, `card`, `btn`, `input`, `th`, `td`) and the same `useItemSearch(1, 300, storeId)`, so it is pattern-identical without being coupled.
  - No warehouse picker. Destination shown read-only ("Returning to: <serving warehouse>", resolved from the store list / a small GET, or simply omitted with the server deciding — see **Q3**).
  - Store: fixed to the active store for a `store_admin`; taken from the top store-switcher for a super admin.
  - Qty cap: `CatalogItem.quantity` captured when the line is added — no new fetch. Same fail-open contract as the warehouse `stockMap` (unknown never blocks; the backend `sellFEFO` guard is the real backstop).
- `TransfersPage.tsx` — a second header action `+ Return to warehouse`, gated `can.role('super_admin','store_admin')`.

**C3.** `src/constants/permissions.ts` — add `REPLENISHMENT.RETURN_STOCK` to the FE mirror, and check `PermissionGrid.tsx` renders a label for it. **This mirror has drifted before and hidden entire sections of UI — verify both sides list the same string.**

**C4.** FE tests (§8.2). Verify with `tsc -b` + `eslint` (baseline: 113 problems, no *new* ones) and `vitest` (baseline: 273 tests, exactly 5 known `OrderDetailsModal` failures).

### Phase D — docs

**D1.** `haper-misc/test-inventory.md` — add a "Store return to warehouse" walkthrough: happy path, the 403 matrix, over-return, cancel-after-dispatch restock, partial receive. ✅/❌ steps + what deploy it needs. Required in the same session as the code (project rule).

### Specialist assignment summary

| Work | Owner |
|---|---|
| §3.1–§3.4 authorization sign-off | **rajit-backend-arch** (blocking) |
| Phase A + B (backend + jest) | **rajit-backend-arch** / backend platform engineer |
| Visual spec for the return modal + the direction badge/filter | **chanchal-designer** (blocking C2, and C1's badge) |
| Component-boundary call (sibling vs third mode) | **arijit-frontend-arch** (light) |
| Phase C (admin FE + vitest) | frontend platform engineer |
| Phase D (test guide) | whoever lands Phase C |
| **Not involved** | hemant-payments (no money), stas-realtime (no sockets), rohit-ai, deepanshu-data, aabha-dba (optional index sanity check only) |

---

## 7. Edge cases, risks & backward compatibility

### Backward compatibility — what this touches and how it keeps working

| Existing behaviour | How it stays unchanged |
|---|---|
| `POST /admin/transfer` forward create | **Not edited.** New capability lives on a new path. |
| Super-admin return via `POST /` + `direction` (the migration script's path) | **Not edited** — the `!isSuper` gate at L278 stays. `bulk-return-bhagwan-bazar-to-warehouse.js` keeps running as-is. |
| Warehouse role dispatching a forward transfer | Gate only widens (adds `STORE_ADMIN`); their own path is identical. |
| Store role receiving a forward transfer | `requirePermission` → `requireAnyPermission` is strictly additive; `RECEIVE_TRANSFER` still passes. |
| Warehouse role calling receive on a forward transfer | Newly passes the router gate, then 403s in the handler on `assertStoreAccess` — same net result as today. |
| `PATCH /:id/items` | **Not edited.** |
| `GET /transfer/discrepancies` | Already `direction: WAREHOUSE_TO_STORE` expressed as `$ne STORE_TO_WAREHOUSE` in the repo — returns can never enter the report, and legacy no-direction docs still appear. **No change, verified.** |
| Warehouse `reservedQty` / `inTransitQty` | Returns never touch them (documented at controller L141-143, L522-524). Free-to-promise maths unaffected. |
| Replenishment fulfilment | `receive` skips the request-close for returns (L574). Unchanged. |
| Existing admin permission snapshots | A new permission absent from all presets changes no existing account's `resolveEffectivePermissions` output. |
| Legacy transfers with no `direction` key | Every new check is a **positive** test for `STORE_TO_WAREHOUSE` (BE util + the new FE mirror). Absent ⇒ forward, everywhere. |

### Risks & failure modes

1. **`store_admin` bypasses every permission gate.** The single biggest trap in this codebase's auth model. Any future "restrict this from store admins" must be a `requireRole`, never a permission. Both the router and the FE gate by role here for exactly this reason (the FE already does it at `TransfersPage.tsx:31` — follow that precedent).
2. **Over-return.** Hard-blocked at dispatch: flat stores by `{_id, quantity: {$gte: qty}}`, batch stores by `stockOutFEFO` returning `ok:false`. Either throws inside `session.withTransaction`, aborting the whole dispatch — **no partial dispatch, no orphan ledger rows**. The FE cap is a hint only.
3. **Snapshot drift between create and dispatch.** The shop keeps selling. A draft created for 20 units can fail at dispatch if only 15 remain. Accepted for phase 1: the 400 names the item. Do **not** silently reduce the line (the bulk script's `min(csvDelta, currentQty - target)` drift rule was a batch-script concern; interactively, a clear error beats a silent quantity change). Worth surfacing "current shelf qty" next to each line in the dispatch confirm — **Q6**.
4. **Two staff dispatching the same draft.** Already handled: `transitionStatus(id, CREATED, …)` is a conditional update; the loser gets 409 "Transfer state changed concurrently; retry." No double-decrement.
5. **Cancel-after-dispatch is the reversal path.** `cancelReturnToStore` restores each lot with its original cost + expiry via `applyStockIn(source: RETURN)`. A `RECEIVED` return cannot be cancelled (L611) — correcting a received return requires a fresh forward transfer. State this in the test guide.
6. **A SKU the warehouse has never held.** `ensurePlaceholder` runs pre-transaction (session-unaware) before the upsert, so no nameless warehouse-stock row. Already correct — **just don't move it inside the transaction during refactoring.**
7. **Region-fallback misrouting.** Mitigated by §3.3 refusing the fallback entirely. If a store has `servingWarehouseId: null`, returns are simply unavailable with an actionable message.
8. **Transaction size.** 500-line cap × ~5 writes/line ≈ 2500 writes in one transaction; Atlas's default 60s `transactionLifetimeLimitSeconds` can abort it. The script's own helper warns above 1500. Recommend the FE soft-warns above ~100 lines — **Q7**.
9. **Discontinued/inactive items.** `resolveLineItem` doesn't filter on `status`, so a return of a discontinued item works at the API. Whether `/admin/item/catalog` surfaces inactive items in search decides whether the UI can do it — **Q8**.
10. **Items with no barcode are unreturnable.** `resolveLineItem` throws `Item "X" has no barcode/SKU — enroll one before transferring it.` This is existing, correct behaviour (SKU is the cross-location product identity), but for a store admin it's a new dead end. The UI should show it as a per-line blocker before submit, not a submit-time toast.
11. **Rollback strategy.** Fully reversible and low-blast-radius: revert the router gates + delete the `/return` route → the feature vanishes and the forward flow is untouched (it was never edited). Any returns already created keep working via the super-admin path. No data migration to undo. Nothing here is hard to reverse.
12. **Deploy ordering.** Backend first, then admin FE. The FE change is inert without the backend route; the backend route is inert without a caller. Neither breaks the other in either order.

---

## 8. Test strategy

### 8.1 Backend — `packages/admin/__tests__/transfer-return-store-initiated.test.js` (in-memory Mongo, supertest)

Follow `transfer-list-scope.test.js` conventions: real `AdminModel` rows via `testUtils`, two warehouses × two stores so "own tenant" is provably distinguishable, assertions on the **returned document** (direction, warehouseId, storeId) not just status codes.

**Authorization matrix (the core of this feature):**

| Actor | Action | Expect |
|---|---|---|
| store_admin(A) | `POST /return` no storeId | 200, `direction=STORE_TO_WAREHOUSE`, `storeId=A`, `warehouseId=A.servingWarehouseId` |
| store_admin(A) | `POST /return` `storeId=B` | **403** |
| store_admin(A) | `POST /return` with `warehouseId` in body | **400** (unknown key) |
| store_admin(A) | `POST /return` with `direction: WAREHOUSE_TO_STORE` in body | **400** (unknown key) |
| store_admin(A) | `POST /` (forward create) | **403** — unchanged |
| manager / support | `POST /return` | **403** (no `RETURN_STOCK`) |
| warehouse_manager | `POST /return` | **403** |
| super_admin | `POST /return` `storeId=B` | 200 |
| super_admin | `POST /` `direction=STORE_TO_WAREHOUSE` | 200 — **the legacy path still works** |
| store_admin(A) | dispatch own return | 200, store qty decremented |
| store_admin(A) | dispatch store B's return | **403** |
| store_admin(A) | dispatch a **forward** transfer | **403** |
| store_admin(A) | cancel a **forward** transfer | **403** |
| warehouse_manager(WH1) | receive A's return | 200, warehouse qty incremented |
| warehouse_manager(WH2) | receive A's return (WH1's) | **403** |
| warehouse_manager | receive a **forward** transfer | **403** — unchanged |
| store_admin(A) | `PATCH /:id/items` on own return | **403** (documented phase-1 limitation) |

**Lifecycle / stock integrity:**
- Full round trip on a **flat** (non-batch) store: create → dispatch → receive; assert item qty down, warehouse `availableQty` up, two ledger rows (`RETURN_OUT` −n, `RETURN_IN` +n) with correct `balanceAfter`.
- Full round trip on a **batch-enabled** store: assert `batchAllocations` stamped at dispatch carry cost+expiry into `returnToBatch` at receive.
- Over-return (qty > shelf): dispatch → 400, **item quantity unchanged, transfer still `CREATED`, zero ledger rows** (transaction abort proof).
- Multi-line where line 3 is short: the whole dispatch aborts; lines 1–2 not decremented.
- Cancel from `DISPATCHED`: store qty restored to the original, `MANUAL_ADJUST` ledger row with `reason: "return_cancelled_restock"`.
- Cancel from `CREATED`: no ledger rows, status flips.
- Partial receive (recv < dispatched): warehouse rises by `recv` only.
- Receive without `scannedBarcode` → 400; mismatched barcode → 400; both move zero stock.
- Receive a SKU the warehouse has never held → a warehouse-stock row exists **with a name** (the `ensurePlaceholder` regression).
- Store with `servingWarehouseId: null` → 400 with the actionable message.
- Item with no barcode on a line → 400.

**Non-regression (`transfer-return-backcompat.test.js` or same file):**
- A legacy transfer doc inserted **with no `direction` key** still appears in the default list, in the discrepancy report, and dispatches down the forward path.
- `GET /discrepancies` never contains a `STORE_TO_WAREHOUSE` transfer, even a received-short one.
- `GET /transfer?direction=STORE_TO_WAREHOUSE` returns only returns; no param returns both.

### 8.2 Admin frontend — Vitest

- `TransfersPage.test.tsx` extensions: a return row renders the return badge; a forward row does not; a transfer with `direction` **absent** renders as forward (the `.lean()` mirror); the direction filter sends `?direction=`; a `store_admin` sees `+ Return to warehouse` but **not** `+ New transfer`; a `warehouse_manager` sees the inverse; Dispatch/Cancel render on a return for a store_admin and not on a forward one.
- New `ReturnToWarehouseModal.test.tsx`: qty capped at the item's `quantity` with the "exceeds available" hint; unknown quantity never blocks; zero/fractional qty blocks submit naming the item; empty list blocks; the POST body contains exactly `{items, note?}` with **no** `direction` and **no** `warehouseId`.
- `pickSlipPrint.test.ts`: a return prints "From store / To warehouse".
- `permissions` mirror test: FE `PERMISSIONS.REPLENISHMENT.RETURN_STOCK` matches the BE string exactly.

### 8.3 Manual / e2e (documented in `haper-misc/test-inventory.md`)

Real dev environment (`damin.haper.in`): log in as a Bihar store admin, return 3 items, dispatch, confirm the shelf number dropped, log in as warehouse manager, scan and receive, confirm the warehouse number rose and the ledger shows `RETURN_OUT`/`RETURN_IN`.

---

## 9. Open questions (must be answered before Phase A starts)

**Q1 — Reason field.** Should a return require a **reason** (Excess / Near expiry / Damaged / Wrong item / Other)? The transfer schema has only a free-text `note`, and the codebase's convention elsewhere is a typed reason (`stock_ledger.reason`, order-cancel reasons). Options: (a) reuse `note` free-text, zero schema change; (b) add `returnReason` enum + `note`. **(b) is the only one that makes returns reportable later** ("how much near-expiry stock came back last month?"), but it is a schema addition. My recommendation: **(b)**, nullable with no default, so old docs and old clients are unaffected. Needs your call.

**Q2 — Max quantity / value per return.** Any cap? E.g. refuse a single return above ₹X or above N units without super-admin approval? Today the only limit is 500 lines. A store admin can currently return their *entire* shelf in one action. Do you want an approval step for large returns, or is cancel-if-wrong sufficient?

**Q3 — Show the destination warehouse in the UI?** The server derives it. Showing it read-only ("Returning to: Patna Warehouse") is friendlier but needs the store's `servingWarehouseId` name available to a store admin — a small new read or a field on the existing store payload. Show it, or leave the destination implicit?

**Q4 — Region fallback.** I propose refusing a return when `store.servingWarehouseId` is null (no region-based guess). Confirm — or do you want the same fallback replenishment uses?

**Q5 — Editing a draft return.** Phase 1 says a store admin cancels and recreates rather than editing lines. Acceptable, or is edit needed on day one? (Enabling it means adding a direction branch to `updateItems`, which currently has none.)

**Q6 — Live shelf quantity at dispatch.** Show each line's *current* on-hand in the dispatch confirmation (an extra read) so a store admin sees drift before the 400, or accept the error message?

**Q7 — Practical line cap.** The API allows 500 lines; ~2500 writes in one transaction risks a 60s abort. Soft-warn the UI above ~100 lines and suggest splitting? What number feels right operationally?

**Q8 — Discontinued items.** Can a store return an item that's been discontinued/deactivated in its catalogue? The API allows it; whether the item-search surfaces it decides the UX. Should the return picker include inactive items?

**Q9 — Notifications.** Forward transfers send no notification today (verified — no notify call in the transfer controller). Should creating or dispatching a return alert the warehouse (push / in-app / nothing)? If yes, this becomes a genuinely new integration and needs its own scoping.

**Q10 — Rollout scope.** Enable for every store immediately, or gate behind the existing per-store `config.warehouseEnabled` switch (the flag that already controls whether a store participates in the supply layer at all)? My recommendation: **gate on `config.warehouseEnabled`** — it costs one line, matches how every other supply-layer capability rolls out, and gives you a per-store off switch.

---

**Not approved for implementation until Q1–Q10 are answered and `rajit-backend-arch` has signed off on §3.1–§3.4.**

---
