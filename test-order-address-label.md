# Test: Honest order address label in admin (Phase 3 — order durability fix)

**Area:** Admin panel → Orders (list, detail, search), Users → a user's orders,
Scheduled day-plan board, and the village-wise analytics report.
**Backend:** `packages/shared/utils/address.utils.js`,
`packages/shared/repositories/order.repository.js`,
`packages/shared/events/order.handler.js`,
`packages/admin/src/routes/order/controller.js`,
`packages/admin/src/routes/user/controller.js`.
**Apps:** none. No Android / iOS / Web / admin release is *required* — the response shape is
unchanged. A follow-up admin FE change (empty state + "from order history" badge) is separate.

## The problem this fixes

When an order's address document did not resolve, admin printed **`Store_Pickup`** — the exact
same label a genuine counter pickup gets. So a real ₹271 home delivery (order **HP966912806**,
Razorpay, delivered, address deleted by the customer afterwards) reads in admin as if the
customer walked into the store. Support can't tell the two apart, and the village analytics
report silently counted those orders into the "Store Pickup" bucket.

The old code was literally `addressId === null ? { name: "Store_Pickup" } : order` in 5 places.

**Full design:** `order-address-durability-plan.md` §3 (Phase 3). Phases 2 and 1 ship first —
see `test-address-soft-delete.md` and `test-order-address-snapshot.md`.

---

## What changed

**New resolver** `addressUtils.resolveOrderAddressForDisplay(order)` — four rungs, in order:

| # | Situation | What admin now shows |
|---|-----------|----------------------|
| 1 | The live address document still resolves | the live address, **untouched** (99.9% of orders — zero change, keeps live coordinates) |
| 2 | It doesn't, but the order has an `addressSnapshot` (Phase 1) | the snapshot, plus `addressFromSnapshot: true` |
| 3 | No address and none expected — `STORE_PICKUP_PREPAID` / `STORE_PICKUP_POSTPAID` / `channel: "pos"` | `Store_Pickup` — **exactly as before** |
| 4 | Anything else (a real delivery whose address is gone and unrecoverable) | `Address unavailable`, plus `addressUnavailable: true` |

The result is written back under the **existing** `addressId` key, so no client sees a shape
change. `addressFromSnapshot` / `addressUnavailable` are new optional booleans — Gson and Codable
ignore unknown keys, so old app builds are unaffected.

**Applied at 5 call sites:** order list, order detail, order search, a user's order history, and
the scheduled day-plan board. The board renders a plain **string** (`area`), not an address
object, so it uses the same four rungs via a small local helper: live village/street → snapshot
village/street → `"Store Pickup"` → `"Address unavailable"`.

**Village-wise analytics** (`getVillageWiseUserStats` / `...ByStore`) had the same collapse inside
its aggregation. It now follows the same precedence in Mongo syntax: looked-up village → snapshot
village → `"Store Pickup"` for genuine pickup/POS → **`"Unknown"`**. So the "Store Pickup" row in
that report finally means only real pickups.

**Hygiene fix (from Phase 1/2 review):** ~16 order populates used an *exclusion* select
(`-userId -isDefault -createdAt -updatedAt -__v`), which did not exclude Phase 2's new internal
`deletedAt` marker — so it leaked into order responses. `-deletedAt` added to every one of them.
Not a security issue (a user only ever sees their own data); a correctness/hygiene fix.

---

## How to test (dev)

### ✅ Normal order — nothing changes

Place a delivery order, keep the address, open it in admin.

- **Expect:** the address renders exactly as it does today, no new badge, no new wording.
- **Expect:** the JSON has **no** `deletedAt` key inside `addressId`.

### ✅ Customer deletes the address after ordering (Phase 2 + 1 in place)

Place a delivery order, then delete that address from the customer app.

- **Expect:** admin still shows the **live** address (Phase 2 soft-deletes it, so `.populate()`
  keeps resolving) — rung 1, no badge.
- **Expect:** the rider app still has coordinates and can navigate.

### ✅ Address truly gone, but the order has a snapshot

Only reproducible for an address hard-deleted by the compliance account-purge job, or by
deleting the row directly in the DB on dev.

- **Expect:** admin shows the snapshot's address, with `addressFromSnapshot: true` in the JSON.
- **Expect:** the same address shows in the order list, the search results, and the user's
  order history — all four surfaces must agree.

### ✅ Genuine store pickup — unchanged

Place a `STORE_PICKUP_PREPAID` / `STORE_PICKUP_POSTPAID` order, and separately ring up a POS
counter sale.

- **Expect:** both still say **`Store_Pickup`**, with no `addressUnavailable` flag. This is the
  true-positive case and it must not regress.
- **Expect:** on the scheduled day-plan board the `area` column still reads `Store Pickup`.

### ✅ THE BUG — a real delivery with no recoverable address

A legacy order (placed before Phase 1) whose address was hard-deleted, e.g. **HP966912806**.

- **Expect:** admin now says **`Address unavailable`** with `addressUnavailable: true` — not
  `Store_Pickup`.
- **Expect:** the village-wise analytics report counts it under **`Unknown`**, not `Store Pickup`.

### ❌ Not covered by Phase 3

- **The admin FE empty state / badge is not built here.** The backend now returns the honest
  label + flags; `haper-admin` still renders the raw string. Showing
  "Address unavailable (customer deleted it)" and an "from order history" badge is the separate
  FE task (plan §3, Phase 3 FE).
- **Old orders still get no snapshot retroactively** — that's the backfill script (plan §5),
  still not built. Until it runs, legacy broken orders land on rung 4, not rung 2.
- **The wallet edge case** (plan §7): a store-pickup order paid fully by wallet has its
  `paymentMethod` overwritten to `WALLET`, losing the "this was a pickup" identity, so it reads
  `Address unavailable` instead of `Store_Pickup`. Known, rare, cosmetic, accepted.
- **Customer app / rider app labels are unchanged** — admin-only in this pass.

---

## Automated test coverage

**`haper-backend/packages/admin/__tests__/order-address-display.test.js`** (new, 13 tests):

- unit, all four rungs plus precedence (live beats snapshot) and a null-order pass-through;
- unit, a bare never-populated `ObjectId` is **not** mistaken for a resolved address — bson's
  `ObjectId` has an `_id` getter that returns itself, so the check also requires `!_bsontype`;
- HTTP `GET /admin/order/:id`: live address, soft-deleted address (still resolves),
  hard-gone + snapshot, genuine pickup, POS sale, and the real bug case;
- HTTP: the populated `addressId` no longer carries `deletedAt`.

Run from the package dir (in-memory Mongo):
`cd haper-backend/packages/admin && NODE_ENV=test npm test`
(`npm test` — the admin suite needs `--runInBand --forceExit`.)

Also re-run `cd haper-backend/packages/user && NODE_ENV=test npx jest` — the shared populate
selects are used by the user package too.

---

## What this needs to go live

**No migration.** No new fields, no index. Purely read-path logic.

**Deploy:** normal backend deploy (`shared` + `admin` packages). No client release.

**Ordering:** Phase 2 → Phase 1 → **this**. The backfill script (plan §5) and the admin FE empty
state are the remaining follow-ups.

**Cross-links:** `test-address-soft-delete.md` (Phase 2), `test-order-address-snapshot.md`
(Phase 1), `test-address-village.md` (the village analytics report whose bucket labels changed).
