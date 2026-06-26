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
- **FIRST: audit & convert EVERY non-transactional quantity mutator** (restock, razorpay, manual-adjust,
  etc.) to ONE batch-aware **transactional** helper. The FEFO decrement **refuses to run without a session**.
- Create `store_batches` + `warehouse_batches`. Seed `LEGACY` batches for **100%** of stock
  (idempotent/resumable) so roll-ups == current values before flipping any decrement.
- Make `quantity`/`expiresAt`/`costPrice` DERIVED (recompute in-txn on every batch change).
- Goods-receipt → insert `warehouse_batch` (real `batchNo`) + bump total. Transfer dispatch → FEFO
  pick + stamp `{batchNo,cost,expiry}` on the line. Receive → create/merge `store_batch` + re-roll-up.
- Add reservation buckets (`reservedQty`/`inTransitQty`) + reserve-on-approve + auto-expire cron.
- Promote `stock-movements.batchNo` to a real field; add `iId`.
- Ship behind a **per-store flag**; **reconcile job** asserts `items.quantity == Σ(batches)` and **alerts** on drift.

### Phase 3 — Per-batch COGS + reporting
- Add `iId` + `batchAllocations` to order lines (Gson-safe). POS + user order placement record FEFO allocations.
- Profit/COGS read `batchAllocations`; exclude+flag cost-unknown.
- Fix analytics `$lookup`s (P14) to join on `iId`/`storeId`; per-store vs all-stores toggle.

### Phase 4 — Product master carve-out (optional, last)
- Materialise `products` from canonical store rows keyed by `iId`; items reference it; one-way
  master→projection sync = **synchronous fan-out on edit + nightly reconcile** (no queue/CDC).
- Onboarding becomes "create empty `(storeId, iId)` projections". Can be deferred indefinitely.

---

## 7. Client-side scope — DO AFTER BACKEND IS FULLY DONE & TESTED

> **Hard rule: no client changes until all backend phases land and pass tests.** Most client changes
> are additive/optional. Order when ready: **admin → web → android → ios → picker → delivery.**

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
- **Next when resuming:** commit `feat/inventory-v2` → PR into `dev` (NEVER push to dev directly) → after the new
  code is deployed, run the prod migration (`npm run migrate` → `--apply`) → then client-app work (§7).
- **RULE (project):** whenever migration progress changes (code merged, a step run/applied, a step added), update
  **THIS §11.8** + the `project_inventory_v2_redesign` memory + `scripts/migrations/README.md` so any session resumes cleanly.
