# Inventory v2 — Multi-store + Batch-wise Redesign (Build Blueprint)

> **Status:** committed + pushed on branch `feat/inventory-v2` (cut from `dev`) — PR into `dev` not yet opened.
> **Phase 0 = DONE** (P7 alert storeId guards; integrity-report + costPrice-backfill scripts).
> **Phase 1 (global categories/sub-categories) = CODE DONE & TESTED** — full backend suite green
> (admin 626 / user 259 / cron 9). Done the *proper* way (no name-matching workaround; the Phase-0
> add-to-all stopgap was reverted).
> **Prod migration = PENDING** — `npm run migrate` (dry-run) → `npm run migrate:apply`. See **§11.8** for the runbook.
> **P20 delivery-incentive = SKIPPED** by decision (kept OFF in store config) — see §11.2.
> **Read §11 first** — authoritative log of every decision + live status. **Keep §11.8 updated as progress changes.**
> **Kickoff phrase** (future sessions): **"let's build the inventory setup"** → read THIS doc end-to-end +
> memory `project_inventory_v2_redesign`. **Backend-first — NO client (admin/web/android/ios/picker/delivery)
> changes until the backend phases are done & tested.**

---

## 0. Why this exists

PROD today = **1 store, all items mapped to it**. Adding a 2nd store broke items, categories,
sub-categories, and stock-alerts. We are scaling to **10–20 stores** (multi-state later) with
**batch-wise stocking**, kept **simple for a small org**, and **without breaking the customer
apps** (they read items as a single per-store quantity).

**Root cause:** items / categories / sub-categories / inventory-groups are **per-store COPIES**
with independent `_id`s (same logical entity = N ids). Items embed a per-store
`category:{_id,name}` snapshot. No shared product/category master. Shared read/evaluate paths
(alert evaluator, analytics `$lookup`, Redis cart) query by `groupId`/`itemId` with **no
`storeId` guard** — works only by accident of per-store-unique ids, breaks on any stale id.

Full analysis: workflow `inventory-multistore-replan` produced 7 subsystem maps + **24 ranked
problems (P1–P24)** + this architecture + an adversarial critique whose corrections are folded in below.

---

## 1. Target architecture — 3 layers (introduced incrementally on the EXISTING `items` collection)

1. **SHARED master** — `products` + global `categories` + global `sub-categories` (one row each,
   **no `storeId`**). Product identity = **`iId`** (reuse the existing field — see §4); barcode = scan key.
2. **PER-STORE projection** = today's `items`, evolved. Holds only what varies per store +
   **denormalized display fields** (so the apps never join). `category`/`subCategory` become
   **GLOBAL** ids (valid in every store) — this deletes the whole fragmentation/stamping bug class.
3. **BATCH ledger** — `store_batches` (+ `warehouse_batches`). `items.quantity` stays a **single
   number = SUM(open batches)**, recomputed in the same transaction as any batch change. Apps never see batches.

**Key principle: global *definitions*, per-store *membership*.** A store "carries" a
category/product **iff it has an item row for it**. No per-store category copies; a store that
doesn't stock Dairy simply has no Dairy items → no Dairy shown.

---

## 2. Shared vs per-store taxonomy

| SHARED (one master, all stores) | PER-STORE (`items` row + batches) |
|---|---|
| `iId` (product identity), barcode (scan key) | `quantity` (= SUM open batches; DERIVED) |
| name, brand, images, unit, weight, description, tags, meta | `price`, `sellingPrice` |
| `categoryId`, `subCategoryId` (GLOBAL) | `costPrice` (weighted-avg of open batches; DERIVED) |
| `gstRate` | `lowQty`, `maxStock`, `reorderQty` |
| master status (active/discontinued) | shelf `location`, per-store `status` |
| warehouses, suppliers (already global) | `inventoryGroupId` + stock-alert state |
| sequences (orderId, transferId, requestId) | `expiresAt` (= MIN open batch; DERIVED) |
| | barcode-enrollment audit (physical shelf action) |
| | `store_batches`, carts, orders, picking, delivery |
| | `store.config` (delivery/min-order/hours/serviceArea/servingWarehouseId/region/gstin) |

---

## 3. Entity definitions (target)

> In **Phases 0–3** the per-store `items` row stays the de-facto product record; the `products`
> master is carved out in **Phase 4** (optional). Field lists below are the end state.

### `products` (master) — NEW (Phase 4; until then these fields live on `items`)
`_id`, **`iId`** (stable identity), `barcode` (sparse-unique scan key), `name`, `brand`,
`images[]`, `unit`, `weight`, `description`, `tags[]`, `gstRate`, `categoryId` (FK global),
`subCategoryId` (FK global), `meta`, `status` (active/discontinued). No `storeId`.

### `categories` (global) — CHANGED (drop `storeId`)
`_id`, `name` (unique), `icon`, `seq`, `isSuggested`, `status`.

### `sub-categories` (global) — CHANGED (drop `storeId`)
`_id`, `name`, `categoryId` (FK global; the `category:[]` array becomes global ids), `seq`, `status`.
Unique `(categoryId, name)`.

### `items` (per-store projection) — CHANGED (today's collection, evolved)
- identity/refs: `storeId`, **`iId`** (same value across stores), `barcode`, `categoryId`/`subCategoryId`
  (GLOBAL ids; keep denormalized `category:{_id,name}` for app compatibility), denormalized
  `name/brand/images/unit/weight/gstRate` (refreshed one-way from master).
- per-store: `quantity` (DERIVED=Σ open `store_batches`), `price`, `sellingPrice`,
  `costPrice` (DERIVED=weighted-avg open batches), `lowQty`, `maxStock`, `reorderQty`,
  `location`, `status`, `inventoryGroupId`, `expiresAt` (DERIVED=MIN open batch), barcode-enroll audit.
- indexes: `(storeId, iId)` unique; `(storeId, barcode)` partial-unique; `(storeId, categoryId, status)`; etc.

### `store_batches` — NEW
`_id`, `storeId`, `iId`, `batchNo`, `qtyRemaining`, `costPrice`, `expiresAt`,
`status` (AVAILABLE/HOLD/RECALL), `receivedAt`, `sourceTransferId`/`supplierId`.
Index `(storeId, iId, batchNo)` unique; `(storeId, iId, expiresAt)` for FEFO.
Re-receiving the same `batchNo` MERGES (adds qty).

### `warehouse_batches` — NEW
`_id`, `warehouseId`, `sku`(barcode)/`iId`, `batchNo`, `qtyRemaining`, `costPrice`, `expiresAt`,
`supplierId`, `status`. Index `(warehouseId, sku, batchNo)` unique; `(warehouseId, sku, expiresAt)` FEFO.

### `warehouse-stocks` — CHANGED (fast denormalized totals)
`availableQty` (=Σ open warehouse_batches; existing meaning kept), **`reservedQty`** (NEW),
**`inTransitQty`** (NEW), `costPrice` (DERIVED weighted-avg), `expiresAt` (DERIVED MIN),
`lowQty`/`maxStock`/`reorderQty`. **Free-to-promise = availableQty − reservedQty.**

### `stock-transfers` — CHANGED
Lines gain `batchNo`, `costPrice`, `expiresAt` (stamped at dispatch from FEFO warehouse batch).

### `stock-movements` (ledger) — CHANGED
Promote `batchNo` from free-text note → real indexed field; add `iId`.

### `orders` — CHANGED (additive, Gson-safe)
Item lines gain `iId` and `batchAllocations:[{batchNo,qty,costPrice}]` (default `[]`, always emitted).
Line `costPrice` = FEFO-weighted batch cost at sale.

### `inventory-groups` / `stock-alerts` — per-store, HARDENED
Stay per-store. Add `storeId` guards everywhere. Group references a **global `categoryId` + per-store
thresholds**; ALSO support per-item thresholds. Skip evaluation on just-created qty-0 rows.

### `delivery-boys` / `pickers` — CHANGED
Uniqueness GLOBAL → COMPOUND `(storeId, phone)` / `(storeId, email)` / `(storeId, username)`.
A person at 2+ stores = one record per store (login resolves store on collision).

---

## 4. Invariants & locked decisions (the rules the code must honor)

1. **`iId` = product identity** (verified: not used by apps or user/picking/delivery backends; only
   admin search/lookup/email/clone). Mint **once per product, reuse across all stores** (today it's
   regenerated per store except on clone). **RE-VERIFY iId usage at code time before flipping.**
2. **Categories/sub-categories fully global** (shared name, ordering/seq, isSuggested, single status; **no
   `storeId`**; name globally unique). **BUILT NOW** (not deferred). A store "carries" a category iff it has
   ≥1 active item in it (**membership**). **Per-store enable/disable override IS built now, default ON** — a
   store admin can hide a carried category from their store and re-enable it (only *disabled* rows persisted,
   in `store-category-settings`). **Global category/sub-category CRUD is SUPER_ADMIN-only**; store admins get
   only the per-store enable/disable. See §11.
3. **Membership = item rows.** HO assigns products to stores centrally (multi-store picker + ALL).
   New rows start **qty 0**; **app hides qty-0** items. Onboarding = template (copy a store's list) +
   trim, creating **references** (not forks); idempotent, resumable, reports "X of Y assigned".
   Retire `cloneStoreCatalog`.
4. **Single-quantity contract preserved.** `items.quantity`/`expiresAt`/`costPrice` are
   **derived-but-physical**, recomputed **in the same transaction** as any batch mutation.
   Seed one synthetic **`LEGACY`** batch per existing stock row so day-one roll-ups == today.
5. **FEFO split:** ACCOUNTING decrement is **always** automatic oldest-expiry-first (keeps quantity /
   weighted-avg cost / COGS deterministic). PHYSICAL picking is **guidance only** for now (picker app
   shows "soonest expiry" hint; **no** hard scan-gate). Picker batch-selection can come later.
6. **Cost:** displayed `costPrice` = **weighted-avg** of open AVAILABLE batches; **true per-batch cost**
   rides on each order line (`batchAllocations`) for COGS. No "cost 0 → profit 0" fallback — exclude
   no-cost lines from margin and **flag "cost unknown"**.
7. **Warehouse reservation:** APPROVE reserves (`reservedQty += qty` only if `available − reserved ≥ qty`,
   server-enforced — no over-commit). DISPATCH: `available−=, reserved−=, inTransit+=` (FEFO batch pick).
   RECEIVE: `inTransit−=`, store batch `+=`. Cancel/reject before dispatch releases reserved;
   cancel dispatched returns to available. **Auto-expire** reservation on APPROVED+undispatched > 7 days
   (configurable) → request EXPIRED/re-requestable.
8. **Routing:** `servingWarehouseId` **required at store creation** (region demoted to legacy fallback).
   Any ACTIVE warehouse allowed (cross-region/cross-state ok — e.g. Bihar WH serves a new Jharkhand
   store until its WH exists; reassign later). Cron **alerts** instead of silently skipping; guard
   warehouse deactivation when stores point at it. Multi-warehouse auto-fallback DEFERRED.
9. **Stock alerts** never leak across stores (storeId guards); nightly **integrity check** emails HO on
   stale refs (item whose inventoryGroupId/category isn't in its store).
10. **Admin UX standing rule:** every status gets a plain-English explanation + a legend (alert states,
    replenishment statuses incl. PARTIALLY_APPROVED/EXPIRED, transfer statuses, Available/Reserved/
    In-transit, batch AVAILABLE/HOLD/RECALL, free-to-promise).
11. **Recall** = `batch.status = HOLD/RECALL` flag + a query ("which stores got batch X") — not a workflow engine.

---

## 5. Problem disposition (P1–P24)

| Disposition | Problems |
|---|---|
| **Discussed + locked (CRITICAL/HIGH)** | P1 (global categories), P12 (batch/FEFO), P2 (add-to-all category), P9 (routing), P10 (reservation/in-transit), P11 (warehouse batch cost/expiry), P7 (alert storeId guards), P5 (retire clone → assignment engine), P6 (iId identity), P15 (app stale ids / cart guard), P3 (sub-category add-to-all), P14 (cross-store analytics), P13 (batch COGS) |
| **Locked, in scope** | P16 (staff compound-unique), P20 (delivery-incentive reliability) |
| **Auto-resolved by the above** | P4 (edit category corruption), P8 (false RED on clone), P17 (barcode insert race) |
| **Deferred by design (small-org / multi-state later)** | P18 (per-store invoice series), P21 (per-jurisdiction GST), P19 (refund ledger), P24 (cross-store demand consolidation), P23 (cross-store query/index tuning) |

---

## 6. Migration — phases (backend; risk-ordered; each reversible)

> Naming: **"Phase N"** = migration step; **"PNN"** = a problem id. Don't confuse them.

### Phase 0 — Safety net (no schema change) — **DONE** (except where noted)
- ✅ Read-only **integrity report** (`scripts/migrations/inventory-integrity-report.js`): items whose `category._id`
  isn't valid; null/orphan `inventoryGroupId`; barcode/iId reuse; alert cross-store leak; cost-backfill candidates.
- ↩︎ Defensive add-to-all by-NAME fix — **built then REVERTED**: superseded by Phase 1 going global now (no workaround).
- ✅ Add `storeId` guards to evaluator + alert repo (**P7**) — completed across evaluator + repos + controllers + cron.
- ✅ Backfill `items.costPrice` where 0 from latest warehouse cost (`scripts/migrations/backfill-item-cost-price.js`, dry-run default).
- ⛔ **P20** delivery-incentive — **SKIPPED** (feature off in store config); the await/retry/log work was reverted (see §11).
- ✅ **Re-verified `iId` usage** — referenced only in `admin`+`shared`; zero refs in user/picking/delivery/auth/cron.

### Phase 1 — Global categories/sub-categories — **IN PROGRESS** (simplified; see §11 for the finalized plan)
> Because PROD has **1 store**, the existing category ids ARE the global ids → **no item remap, no banner-link
> migration**. And **dev is disposable** → wipe + reseed. So the cautious "add-field→backfill→flip / keep old
> rows" dance is NOT needed; we drop `storeId` and rebuild indexes directly.
- **Schema:** drop `storeId` from `categories` + `sub-categories`; `name` globally unique; rebuild indexes.
- **Repos:** remove `storeId` scoping from all category/sub-category finders; admin catalog = all global cats
  with per-store item counts; **customer list = membership** (categories with ≥1 active item in the store) **AND
  not disabled for the store**.
- **Per-store enable/disable** (`store-category-settings`, default ON) + **SUPER_ADMIN-only global CRUD**
  (store admins get only enable/disable; `MANAGER_PRESET` loses category CRUD, gains `TOGGLE_STORE`).
- **Store-clone** stops copying categories/sub-categories (shared now); items keep their global category ids.
- **Migration** `scripts/migrations/migrate-categories-global.js` (idempotent, dry-run default): defensive dedupe-by-name
  (no-op at 1 store) → `$unset storeId` → rebuild indexes.
- **Deferred:** retire `cloneStoreCatalog` → full **assignment engine** (template + idempotent "X of Y") — later.

### Phase 2 — Batch ledger + reservation
> Built in **three milestones** (each tested + committed on `feat/inventory-v2`):
> **2A** store batch ledger + chokepoint — **DONE** (see §11.9); **2B** warehouse batches +
> goods-receipt + transfer batch stamping — **DONE** (see §11.10); **2C** reservation buckets + auto-expire — **DONE** (see §11.11).
> **→ Phase 2 (the whole batch-ledger + reservation backend) is COMPLETE.**
- **FIRST: audit & convert EVERY non-transactional quantity mutator** (restock, razorpay, manual-adjust,
  etc.) to ONE batch-aware **transactional** helper. The FEFO decrement **refuses to run without a session**. ✅ (2A)
- Create `store_batches` ✅ (2A) + `warehouse_batches` (2B). Seed `LEGACY` batches for **100%** of stock
  (idempotent/resumable) so roll-ups == current values before flipping any decrement. ✅ (2A, store side)
- Make `quantity`/`expiresAt`/`costPrice` DERIVED (recompute in-txn on every batch change). ✅ (2A)
- Goods-receipt → insert `warehouse_batch` (real `batchNo`) + bump total. Transfer dispatch → FEFO
  pick + stamp `{batchNo,cost,expiry}` on the line. Receive → create/merge `store_batch` + re-roll-up. ✅ (2B)
- Add reservation buckets (`reservedQty`/`inTransitQty`) + reserve-on-approve + auto-expire cron. ✅ (2C)
- Promote `stock-movements.batchNo` to a real field; add `iId`. ✅ (2B)
- Ship behind a **per-store flag** ✅ (2A: `store.config.batchesEnabled`); **reconcile job** asserts
  `items.quantity == Σ(batches)` and **alerts** on drift ✅ (2A: nightly `inventory-batch-reconcile`).

### Phase 3 — Per-batch COGS + reporting — **DONE** (see §11.12)
- Add `iId` + `batchAllocations` to order lines (Gson-safe). POS + user order placement record FEFO allocations. ✅ (3A)
- Profit/COGS read the true per-line cost; exclude + flag cost-unknown (kill the P13 cost-0 fallback). ✅ (3B)
- Fix analytics `$lookup`s (P14) to join on `iId`/`storeId`; per-store vs all-stores toggle. ✅ (3C)

### Phase 4 — Product master carve-out — **DONE** (see §11.13)
- Materialise `products` from canonical store rows keyed by `iId`; items project from it; one-way
  master→projection sync = **synchronous fan-out on edit + nightly reconcile** (no queue/CDC). ✅
- Onboarding becomes "create empty `(storeId, iId)` projections" (the assignment engine). ✅

---

## 7. Client-side scope — DO AFTER BACKEND IS FULLY DONE & TESTED

> **Hard rule: no client changes until all backend phases land and pass tests.** Most client changes
> are additive/optional. Order when ready: **admin → web → android → ios → picker → delivery.**
>
> **LIVING CHECKLIST → `haper-misc/client-followups.md`** — the actionable, status-tracked
> per-change × per-client list (this §7 is the plan; that file is what you work through one by one).
> Add a `CH-N` block there for every backend change. Memory: `project_client_followups`.

- **haper-admin (ops console — biggest):** global category/sub-category CRUD; product-master UI;
  multi-store **assign picker** (+ ALL) + template onboarding; batch-aware **goods-receipt / Stock-In**
  (batch no + cost + expiry); reservation/in-transit columns + server-enforced free-to-promise;
  routing-health (have) + required serving-warehouse on store create; **Missing Barcode** filter (have);
  COGS / per-store-vs-all-stores reports; **status legends/explanations everywhere** (§4.10).
- **haper-web (React):** reads largely unchanged. Benefit: correct category browse after store switch
  (global ids). Cart resolves by **`iId`**; show "removed — not available at this store" on store switch.
  New fields additive/optional.
- **haper-android (Kotlin/Gson):** SAME as web + **CRITICAL**: any new item/order JSON field must be
  **nullable or always-emitted** (Gson decodes missing → null and can crash old records). `iId` always
  emitted, `batchAllocations` defaults `[]`. Cart by `iId`; store-switch handling.
- **haper-ios (Swift):** same additive/optional-decoding rule.
- **picker:** pick-confirm signature unchanged (returns new quantity); FEFO **hint** only (optional later
  release); batch fields additive.
- **delivery:** order lines unaffected (new fields additive). The P20 incentive fix is backend.

---

## 8. Critical implementation rules (don't skip)

- **Every quantity mutation goes through the one transactional batch helper.** No bare `incrementQuantity`/
  `decrementIfAvailable(session=null)` survives Phase 2 (they would drift the roll-up). The helper throws if no session.
- **Migrations idempotent + resumable** (LEGACY-batch seed, category id map). Re-runnable on live prod.
- **Per-phase rollback** notes (keep old per-store category rows / old single-qty path until verified).
- **Gson/Codable:** additive, nullable, always-emit `iId` (see memory `android_gson_kotlin_defaults`).
- **Redis cart** (`cart.repository` `findById` has no storeId guard) must be store-guarded / iId-resolved (P15) — it's NOT reached by a Mongo migration.
- **Tests: in-memory Mongo only** (per-package setup; never touch prod). Add: reconcile-invariant test,
  migration-idempotency test, FEFO-decrement concurrency test, reservation lifecycle test, alert storeId-isolation test.

---

## 9. Deferred / open (revisit later)
- **Interstate GST + e-way bill** for cross-state warehouse→store transfers (separate GSTIN per state) — once truly multi-state.
- **Per-store invoice series** (P18), **refund ledger** (P19), **cross-store demand consolidation** (P24),
  **multi-warehouse auto-fallback**, **per-store category ordering override**, **picker batch-selection** — build only on real need.

---

## 10. Branch & process
- Backend tests must pass (in-memory Mongo). Keep everything on a **feature branch** `feat/inventory-v2`.
  **Base branch = `dev` in EVERY repo** (updated 2026-06-26): the entire centralized-inventory + POS
  feature has been merged into `dev` across all repos and every `feat/centralized-inventory-phase1` /
  `feat/pos-counter-sales` branch was deleted. `dev` is now the single consistent integration branch —
  cut `feat/inventory-v2` from **`dev`** in haper-backend / haper-admin / haper-misc (and any client repo).
  After the branch cleanup, every repo holds only `dev` + `main` (+ kept release branches: android
  `release_v2.0.0`/`v2.0.1`, delivery `release_v1.0.0`; backend `main_09042026`).
- **Main is hook-protected** (`~/.claude/hooks/block-main-commit-push.sh`): no direct commit/push to `main` — feature branch → dev → main via PR only.
- **Never push to dev** unless explicitly asked; user merges via PRs.
- No client repos touched until backend phases are merged-ready.

---

## 11. Finalized build decisions — 2026-06-26 session (AUTHORITATIVE)

> This log captures every decision made/changed during the build session so nothing is lost across sessions.
> Where it conflicts with earlier prose above, **this section wins.**

### 11.1 Branch & current state
- Working branch **`feat/inventory-v2`** cut from **`dev`** in `haper-backend` (and `haper-misc` holds this doc).
- **Phase 0 landed** (uncommitted): P7 storeId guards across alert evaluator + `inventory-group`/`stock-alert`
  repos + admin `inventory-group`/`stock-alert` controllers + `item.repository` old-group hook + cron daily-digest.
- **Phase 1 (global categories) CODE DONE & TESTED** (uncommitted): category/sub-category schemas → global,
  repos (membership reads), admin controllers/routers/validators, permission model, new `store-category-settings`
  model+repo, `store-clone` change. Full backend suite green (**admin 626 / user 259 / cron 9**).
- **Migration scripts organized** under `scripts/migrations/` with an ordered entry runner `run.js`
  (`npm run migrate` / `npm run migrate:apply`). See **§11.8** for live status + runbook.
- The Phase-0 **add-to-all by-NAME stopgap was reverted** in favour of going global (see 11.3).

### 11.2 P20 delivery-incentive — SKIPPED (do not re-add)
- Business is **not running rider incentives yet**; kept **OFF in store config** (`config.deliveryIncentiveEnabled`
  already defaults `false`). The reliability work (await + retry + `INCENTIVE_AWARD_FAILED` durable log) was
  implemented then **fully reverted**; the award stays the original fire-and-forget IIFE. Don't revive unless asked.

### 11.3 Categories & sub-categories → GLOBAL master (the right way, now)
- **Decision:** do NOT ship the name-matching workaround. Make `categories` + `sub-categories` a single **global**
  master (drop `storeId`; `name` globally unique; `sub-category.category` stays an **array** of parent ids so one
  global sub-category can have multiple parents). Mirrors how `warehouses` are already global.
- **Why cheap now:** PROD = **1 store** → existing ids already serve as global ids (no item remap, no banner-link
  migration). **Dev is disposable** → wipe + reseed; no careful dev migration.
- **Membership:** a store carries a category iff it has **≥1 active item** referencing it. Customer category/
  sub-category lists are derived by membership, NOT by a `storeId` on the category.
- **Items keep `storeId`**; `items.category._id`/`subCategory._id` remain plain refs to the (now global) ids.

### 11.4 Per-store enable/disable override (default ON)
- New collection **`store-category-settings`** `{ storeId, categoryId, enabled }`, unique `(storeId, categoryId)`.
  **Default = enabled**; only *disabled* overrides are persisted (absence of a row = enabled).
- Customer visibility = **membership AND not-disabled-for-store**. A store admin can hide a carried category and
  re-enable it. (Chosen over explicit opt-in so categories appear automatically once a store stocks them.)

### 11.5 Permission model
- **Global category/sub-category CRUD (create/update/delete/global-activate) = SUPER_ADMIN only** — enforced by a
  **role gate** (`requireRole(SUPER_ADMIN)`), NOT a permission, because `store_admin` bypasses permission checks
  within its store.
- **Store admins only get per-store enable/disable** via `PATCH /admin/category/:id/store-state`, gated by the new
  `CATEGORIES.TOGGLE_STORE` permission. **Built category-level only** (disabling a category hides its whole subtree;
  no separate sub-category toggle). `MANAGER_PRESET` loses category/sub-category CRUD perms, gains `CATEGORIES.TOGGLE_STORE`.

### 11.6 Migration / rollout
- `scripts/migrations/migrate-categories-global.js` (idempotent, **dry-run default**, `--apply` to write): defensive
  dedupe-by-name (no-op at 1 store) → `$unset storeId` on cats/sub-cats → drop old `storeId` indexes → create
  global/unique indexes. **Dev:** wipe + reseed instead. **Prod:** run after code lands; re-runnable.
- `store-clone.utils` stops cloning categories/sub-categories; `item.repository.copyItemsToStore` keeps category/
  subCategory ids unchanged when no remap map is supplied (still remaps per-store inventory groups).

### 11.7 Still deferred (unchanged)
- Assignment-engine onboarding (retire `cloneStoreCatalog`), Phase 2 batches/FEFO + reservations, Phase 3 per-batch
  COGS, Phase 4 product master. No client-app changes until backend lands & tests pass (order: admin→web→android→ios→picker→delivery).

### 11.8 Current status & migration runbook — **KEEP THIS UPDATED**
- **Backend code:** ✅ DONE & tested (admin 626 / user 259 / cron 9 green). Committed + pushed on `feat/inventory-v2`
  (backend `d87c0b9`, this doc in haper-misc). **PR into `dev` not yet opened** (user opens/merges).
- **Prod migration:** ⏳ PENDING (not yet applied). Entry runner runs the steps **in order**, integrity report is a **gate**:
  - `npm run migrate`        → DRY RUN (previews all steps, writes nothing)
  - `npm run migrate:apply`  → applies in order: **integrity gate → `migrate-categories-global` → `backfill-item-cost-price`**
  - **Dev:** wipe + reseed `categories`/`sub-categories` instead (disposable) — migration optional there.
  - Run details / per-step docs: `haper-backend/scripts/migrations/README.md`.
- **Old one-time migrations applied in prod & removed from repo** (recoverable via git history):
  `migrate-to-multi-store`, `backfill-item-images`, `backfill-config-version-format`, `update-media-base-path`
  (the last verified applied 2026-06-26 — new uploads now write the `v1.static.haper.in` base, so it won't refill).
- **SEQUENCE (decided 2026-06-26): finish the ENTIRE backend first, clients LAST.** Continue the remaining
  inventory-v2 backend phases on `feat/inventory-v2` — **Phase 2** (batch ledger/FEFO + reservations) → **Phase 3**
  (per-batch COGS + reporting) → **Phase 4** (product master, optional). **Only after ALL backend is done** start
  the client apps (admin/web/android/ios/delivery/picker) — **client order the USER decides later** (see
  `haper-misc/client-followups.md`). PRs into `dev` and the prod migration run on the user's call (the
  global-categories code is already committed + pushed; its migration is still pending).
- **RULE (project):** whenever migration progress changes (code merged, a step run/applied, a step added), update
  **THIS §11.8** + the `project_inventory_v2_redesign` memory + `scripts/migrations/README.md` so any session resumes cleanly.

### 11.9 Phase 2A — store batch ledger + transactional chokepoint — **CODE DONE & TESTED**
- **What shipped (uncommitted at time of writing → to be committed on `feat/inventory-v2`):**
  - New `store_batches` collection (`store-batches.schema.js`) keyed `(itemId, batchNo)` unique +
    `(itemId, status, expiresAt)` FEFO index; `StoreBatchModel` registered in `models/index.js`.
  - New `store-batch.repository.js` = the **single transactional chokepoint**: `stockIn` (create/merge
    by batchNo, weighted-avg cost), `stockOutFEFO` (oldest-expiry-first; **null expiry sorts LAST**;
    **refuses to run without a session**; returns `{ok,allocations}` and false-on-insufficient without
    touching a batch), `recomputeItemRollup` (quantity=Σ open, costPrice=weighted-avg, expiresAt=MIN —
    cost/expiry only refreshed while ≥1 open batch), `setAbsoluteQuantity` (picker OOS → deplete),
    `ensureLegacyBatch`, `reconcileStore`, + a cached **per-store flag gate** (`isStoreBatchEnabled` /
    `isAnyStoreBatchEnabled` / `__resetBatchGateCache` test hook).
  - `item.repository.js`: the 4 mutators (`decrementIfAvailable`, `incrementQuantity`,
    `findOneAndUpdateAtomicQty`, `updateQuantity`) are now **batch-aware** (branch on the flag; legacy
    path byte-for-byte unchanged when off) + new `applyStockIn` for explicit-batch receipts; `add`
    seeds an opening batch for stocked new items. **Return contracts preserved** (bool / doc-or-null /
    updateOne-like / true) so no caller changed.
  - The 3 non-transactional mutators fixed to pass a session: admin manual Stock-In
    (`items/controller.updateItemQuantity` — now in a txn, accepts optional `batchNo/costPrice/expiresAt`,
    negative = FEFO adjust-down, validator updated) + both Razorpay rollbacks (user `order` + `razorpay`).
  - Per-store flag `store.config.batchesEnabled` (default **false** → zero behaviour change).
  - Migration `seed-store-batches.js` (idempotent; registered as **step 4** in `run.js`, after cost
    backfill). Nightly **`inventory-batch-reconcile`** cron (3:15 AM IST) + `StoreRepository.getBatchEnabledStores`.
  - Tests: `packages/admin/__tests__/store-batch-ledger.test.js` (20 cases — FEFO incl. null-last + HOLD
    exclusion, merge + weighted-avg cost, min-expiry roll-up, insufficient contract, session-refusal,
    absolute-set, seed idempotency + unique-index guard, reconcile drift, **concurrent-FEFO oversell
    guard**, HTTP Stock-In create + negative). `StoreBatchModel` added to the admin test `setup.js`
    pre-create list. **Full suite green: admin / user 259 / cron 9.**
- **Rollout (prod):** run `npm run migrate:apply` (now includes the batch seed) → THEN flip a store's
  `config.batchesEnabled` → reconcile cron watches for drift. Dev: enable the flag on a test store directly.
- **NEXT (after 2A):** Phase 2B (done — see §11.10), then 2C (reservation buckets + auto-expire).

### 11.10 Phase 2B — warehouse batch ledger + receipt/transfer batch flow — **CODE DONE & TESTED**
- **What shipped (committed on `feat/inventory-v2`):**
  - New `warehouse_batches` collection (`warehouse-batches.schema.js`) keyed `(warehouseId, sku, batchNo)`
    unique + FEFO index; `WarehouseBatchModel` registered. New `warehouse-batch.repository.js` = the
    warehouse twin of the 2A store chokepoint: `stockIn` (create/merge, weighted-avg cost), `stockOutFEFO`
    (oldest-expiry-first, session-required, returns allocations), `recomputeRollup` (upserts the
    `warehouse-stocks` total: availableQty=Σ open, costPrice=weighted-avg, expiresAt=MIN — **fixes the
    last-cost-overwrite + false-near-expiry bugs**), `returnToBatch` (transfer-cancel), `ensureLegacyBatch`,
    `setBatchStatus` (recall HOLD/RECALL), `findByBatchNo` (recall trace), `reconcileWarehouse`, + a cached
    **per-warehouse flag gate** (`warehouse.batchesEnabled`, default false).
  - **Recall HTTP endpoints** (`procurement` router, warehouse roles): `GET /admin/procurement/batch/:batchNo`
    (trace — which warehouses + stores hold the lot) and `PATCH /admin/procurement/batch/status`
    (HOLD/RECALL/AVAILABLE on a warehouse or store batch; re-rolls-up).
  - **Goods-receipt** (`procurement/controller`): flag-on → real `warehouse_batch` (merge same batchNo) +
    derived total; flag-off → legacy `WarehouseStockRepository.receive`. Ledger row now carries a real `batchNo`.
  - **Transfer** (`transfer/controller`): **dispatch** FEFO-picks warehouse batches → stamps
    `line.batchAllocations[{batchNo,qty,costPrice,expiresAt}]`; **receive** builds **store batches** per
    allocation via `ItemRepository.applyStockIn` (real warehouse cost/expiry now flow into the store, FEFO
    across a partial receive) — falls back to the 2A single-add when there are no allocations; **cancel**
    returns each lot to its own warehouse batch. All three degrade cleanly when a flag is off.
  - `stock-transfers` line gains `batchAllocations:[]` (Gson-safe). `stock-movements` gains real
    `batchNo` + `iId` fields (+ index); `stock-ledger.utils` threads them through.
  - Migration `seed-warehouse-batches.js` (idempotent; **run.js step 5**). Reconcile cron **extended** to
    also assert `warehouse-stocks.availableQty == Σ(open warehouse batches)` (+ `WarehouseRepository.getBatchEnabledWarehouses`).
  - Tests: `packages/admin/__tests__/warehouse-batch-ledger.test.js` (10 cases — warehouse FEFO/merge/wavg +
    min-expiry, session-refusal, seed idempotency + reconcile drift, recall HOLD-excludes, goods-receipt
    on/off, **full dispatch→receive cost+expiry flow into store batches**, cancel restores exact lots, legacy
    fallback). `WarehouseBatchModel` added to admin `setup.js` pre-create. **Full suite green: admin / user 259 / delivery 133 / auth 43 / picking 20 / cron 9.**
- **Rollout (prod):** enable the **warehouse** `batchesEnabled` flag BEFORE the store flags (so dispatched
  lots carry real cost/expiry into store batches). Seeds run via `npm run migrate:apply` (steps 4 + 5).
- **NEXT:** Phase 2C — reservation buckets (done — see §11.11).

### 11.11 Phase 2C — warehouse reservation buckets + auto-expiry — **CODE DONE & TESTED**
- **What shipped (committed on `feat/inventory-v2`):**
  - `warehouse-stocks` gains `reservedQty` + `inTransitQty` (additive — availableQty meaning unchanged;
    **free-to-promise = availableQty − reservedQty**). Four session-aware, floor-at-0 mutators on
    `WarehouseStockRepository`: `reserve` (atomic guard: only if avail−reserved ≥ qty → no over-commit),
    `releaseReserved`, `markDispatched` (reserved→inTransit), `releaseInTransit`.
  - **Bucket transitions:** approve `reserved+=` (rejects over-commit, in a txn with the status change);
    dispatch `reserved−=, inTransit+=` (availableQty already lowered by 2B FEFO); receive `inTransit−=`;
    cancel-CREATED `reserved−=`; cancel-DISPATCHED `inTransit−=` (+ availableQty restored by 2B). A
    directly-created transfer (no approval) caps the reserved release at 0, so buckets stay consistent.
  - New `EXPIRED` replenishment status + nightly **`inventory-reservation-expiry`** cron (3:45 AM IST,
    window `RESERVATION_EXPIRY_DAYS` default 7): stale APPROVED/PARTIALLY_APPROVED + undispatched requests
    → release reserved + mark EXPIRED (cancels a lingering CREATED transfer); dispatched ones are left
    alone. + `ReplenishmentRequestRepository.getStaleApproved`.
  - The legacy `committed` endpoint (request-based UI hint) is kept for back-compat but is now superseded
    by the server-enforced `reservedQty`.
  - **No migration needed** — all bucket ops are `$ifNull`-safe and the schema defaults new rows to 0
    (existing prod rows materialise the fields on first reserve/dispatch).
  - Tests: `packages/admin/__tests__/warehouse-reservation.test.js` (10 cases — bucket-mutator guards,
    approve free-to-promise enforce + over-commit reject, full approve→dispatch→receive lifecycle,
    cancel-CREATED / cancel-DISPATCHED releases, auto-expiry incl. lingering-transfer cancel + the
    dispatched-is-skipped guard). **Full suite green: admin / user 259 / delivery 133 / auth 43 / picking 20 / cron 9.**
- **Phase 2 is now COMPLETE.** Backend remaining: Phase 3 (per-batch COGS + reporting) → Phase 4
  (product master, optional). Clients still LAST.

### 11.12 Phase 3 — per-batch COGS + cross-store reporting — **CODE DONE & TESTED**
- **3A — COGS capture (committed `420eae8`):** order item line gains `iId` (cross-store identity, default "")
  + `batchAllocations:[{batchNo,qty,costPrice}]` (default []) — both ALWAYS emitted (Gson/Codable-safe).
  New `ItemRepository.sellFEFO(itemId, qty, session)`: batch ON → FEFO-consume + return per-lot allocations +
  the FEFO-weighted cost; batch OFF → the same race-safe decrement, empty allocations. User order placement
  + admin POS sale route through it and stamp `iId` + `batchAllocations` + the TRUE line `costPrice`. POS
  SALE ledger row carries iId/batchNo. **The order line is the first customer-facing JSON to gain fields →
  CH-5 (android/iOS Gson rule).**
- **3B — true COGS, no faked cost (committed `329ccc2`):** profit-snapshot aggregation counts a line toward
  profit + cost ONLY if `costPrice > 0`; a no-cost line is EXCLUDED from margin (was faked to cost=salePrice).
  New `costKnownRevenue` field (projection + snapshot schema) = the correct margin denominator
  (margin% = profit / costKnownRevenue; revenue − costKnownRevenue = "cost unknown" revenue). Threaded through
  getLiveProfit / getSnapshotSum / computeAndSaveSnapshot. No migration (additive, default 0).
- **3C — cross-store analytics / P14 (this commit):** shared `CROSS_STORE_KEY` (group by `iId`, fall back to
  per-store itemId for legacy lines). `getAdvancedMetrics` top-sellers + `getItemSaleFrequency` group by the
  cross-store key when all-stores (so the same product across stores adds up, not double-counts);
  `getItemSaleFrequency` gains a `crossStore` flag. New **`getProductCogsReport`** (margin/COGS by product:
  units, revenue, cogs, grossProfit, marginPct, costUnknownUnits — per-store or cross-store) + endpoint
  **`GET /admin/analytics/product-cogs`** (revenue-gated, `crossStore=true` or super-admin no-store).
  (Also fixed a latent `moment.tz(momentObj)` default-date bug copied from item-frequency.)
- **Tests:** `order-cogs-capture` (5), `order-cogs-profit` (3), `order-cogs-report` (5). Full suite green.
- **NEXT:** Phase 4 (product master carve-out — done; see §11.13). **→ The entire inventory-v2 backend is COMPLETE.**

### 11.13 Phase 4 — product master carve-out — **CODE DONE & TESTED** (the FULL carve-out, 4A+4B+4C)
- **4A — master + materialise (committed `10ee6b8`):** new `products` collection keyed by `iId` (one shared
  row per product, no storeId), holding the catalogue/display fields (name/brand/barcode/type/unit/weight/
  description/images/tags/gstRate/category/subCategory/meta/status). `product.repository` with the item↔master
  mappers + `materializeMissing` (canonical = most-recently-updated item per iId; idempotent fill-gaps, never
  overwrites an edited master). Migration `materialize-products.js` (run.js **step 6**). Additive — items stay
  the de-facto record; `products` shadows until 4B/4C wire reads/writes.
- **4B — CRUD + one-way fan-out + reconcile (committed `47b05c4`):** super-admin product CRUD under
  `/admin/product` (mirrors global-category gating). Create mints a fresh iId; an edit fans the display fields
  out to EVERY store's item projection in one transaction (`ProductRepository.syncToItems` → `updateMany` by
  iId). Nightly `product-master-reconcile` cron (4 AM IST) re-applies each active master, fixing drift.
- **4C — onboarding + master-routed edits (this commit):**
  - **P6 fix:** the items pre-save hook now mints `iId` ONLY if absent (was: always) — so a projection can
    REUSE the master's iId. The same product shares one iId across all stores.
  - **Assignment engine** `POST /admin/product/:id/assign` (super-admin): creates qty-0 item projections per
    store (or "ALL") that reuse the master iId + display fields, seeded price (per-store editable). Idempotent
    + resumable (skips stores that already carry it; reports assigned/skipped/failed).
  - **Item display-edit routing:** `updateItem` splits display vs per-store fields. When the item's product is
    materialised, a GENUINE display change (diffed vs the master) is routed to the master (super-admin → fans
    out to all stores; store admin → 403); unchanged echoes are dropped so per-store edits still apply. Items
    with no master keep the legacy direct edit. New-item add ensures a master exists for its iId.
  - Schema/validator tweaks for the projection model: `items.brand`/`items.weight` no longer `required`
    (default ""); `categoryId` optional on item edit (category is master-owned). `clone` left in place but
    superseded by the assignment engine.
- **Tests:** `product-master-materialize` (3), `product-master-crud` (4), `product-master-assign-edit` (6).
  **Full suite green: admin 693 / user 259 / delivery 133 / auth 43 / picking 20 / cron 9.**
- **Rollout:** `npm run migrate:apply` now also materialises the master (step 6). The master becomes
  authoritative for catalogue fields; the admin client (CH-6) moves display editing to the product master and
  hides it for store admins. Customer apps unaffected. **Backend remaining: NONE — inventory-v2 backend is complete.**
