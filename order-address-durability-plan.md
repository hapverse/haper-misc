# Order Address Durability — Fix Address Deletion Data Loss & Admin Mislabeling (Build Blueprint)

> **Status:** approved design, ready for build. Phases 2 → 1 → 3 in sequence.
> **Phase 2 (soft-delete addresses) = TO BUILD** — schema + repository + list queries.
> **Phase 1 (address snapshot) = TO BUILD** — schema + builder + checkout wire-up.
> **Phase 3 (honest admin label) = TO BUILD** — resolver + 5+ call-sites + admin FE empty state.
> **Backfill script (Phase 1 support) = TO BUILD** — idempotent, dry-run + `--apply`, DEV only for now.
> **Test guide required** — new haper-misc/test-order-address-snapshot.md (✅/❌ steps, edge cases, deploy needs).
> **Kickoff phrase** (future sessions): **"let's fix the order-address-durability bug"** → read THIS doc end-to-end + memory `project_order_address_durability`. **Phases ship in sequence: Phase 2 first (unblocks everything), Phase 1 next, Phase 3 last.**

---

## 0. Why this exists

**PROD today = orders lose their delivery address when a customer deletes it.** Normal action (customers manage saved addresses), catastrophic data loss — an order placed to "123 Main St, Patna" becomes permanently unrecoverable when the customer deletes that address from their account. Worse, the admin panel doesn't just show blank — it actively *mislabels* that real home-delivery order as `"Store_Pickup ()"`, lying to support/analytics. A rider-navigation risk exists too: a customer can delete an address while their order is `OUT_FOR_DELIVERY` and the rider's screen loses navigation.

**Root cause:** orders store only a **Mongo `ObjectId` pointer** (`order.addressId`) to the customer's address document. When a customer deletes that address (hard `deleteOne(...)` today — no soft-delete, no reference check), the populate chain breaks — Mongoose sets the populated path to `null`, indistinguishable from a legitimate store-pickup order. Admin code then collapses both into `{ name: "Store_Pickup" }` in ~20 places.

**Real evidence:** Aditya Kumar (account created 18 Aug 2026) placed order **HP966912806** (₹271, Razorpay prepaid, successfully delivered, status `CLOSED`) to a saved address, then deleted that address from his account. The `addresses` collection no longer has that document. Admin.haper.in now shows this completed home delivery as `"Store_Pickup ()"` — wrong. Same customer's cancelled order **HP791912804** (COD, cancelled 32s after creation) suffers the same mislabel.

**Fix scope:** (1) make orders survive address deletion by storing a copy of the address *on the order itself* at checkout (snapshot), (2) make soft-delete addresses so `.populate()` keeps resolving (eliminates rider-stranding risk entirely), (3) rewrite admin's label logic to distinguish "address was deleted" from "this was genuinely a pickup order".

---

## 0a. DBA Sign-off & locked design amendments (aabha-dba, Sep 2026)

Schema, backfill script, and data-loss paths have been formally reviewed by the DBA and locked in. The changes below supersede the original plan text and are binding.

**What changed:**
1. **Soft-delete field:** single `deletedAt: Date` only (not dual `isDeleted: Boolean + deletedAt: Date`). Matches `users.schema.js` convention; avoids contradictory states; `{deletedAt: null}` query matches both explicit null and legacy missing-key docs.
2. **Default-address promotion:** atomic `findOneAndUpdate` (not read-then-write) to eliminate double-tap race. Guard on `matchedCount`, not `modifiedCount` (timestamps schema makes modifiedCount unreliable).
3. **addressSnapshot schema:** must be explicit named sub-schema, not bare nested object. Critical: allows `default: null` to prevent every order from materializing `{name:null, phone:null, ...}`, which would break backfill-script candidate detection.
4. **Backfill script:** batch size 500, `{ordered: false}`, sequential 100-200ms pauses, _id watermark resume, literal `null` filter (not `$exists`), primary read preference, `--db=<name>` safety gate. Three metrics dry-run: total candidates, recoverable, unrecoverable (write order IDs, no placeholder snapshots).
5. **Two Phase 1 prerequisites:** (a) account-purge.js hard-delete path remains hard (compliance requirement) but only safe after Phase 1 ships + backfill runs; (b) extend purge to also blank sensitive PII fields in `addressSnapshot` (name, phone, street, landmark, addressLine1, coordinates) while preserving non-identifying fields (village, pin, label).
6. **No new indexes needed.** Four existing addresses indexes remain sufficient. Follow-up: `2dsphere` index on location appears unused, cleanup ticket separate.
7. **Two affected tests:** address.test.js (~line 333) will fail on soft-delete (must rewrite assertion), delete-account.test.js (~line 266) should stay green (guards hard-delete path).
8. **Explicitly rejected:** TTL index or auto-purge on `deletedAt` — would recreate the original bug via timer. Reference-aware purge only, gated on backfill completion, revisit after 6 months on prod, not now.

**See sections 3–5a, 4, 5, 7 for integrated amendments.**

---

## 1. Root cause — precise technical anatomy

### Orders-to-Address: hard reference, no durability

**packages/shared/repositories/order.repository.js** — all order reads call `.populate('addressId')` at lines ~1638, ~1729 (aggregation `$lookup`s in village-match, analytics). **packages/shared/models/orders.schema.js** defines `addressId: ObjectId ref`. When populated:
- Address doc **exists** → path resolves to the address object.
- Address doc **deleted** → Mongoose sets the path to `null` (a falsy value, indistinguishable from never-set).

**packages/shared/repositories/address.repository.js** — `delete()` method at line ~90 calls `Model.deleteOne(...)` — hard delete, no reference check, no retention flag. **addresses.schema.js** has no `isDeleted`, `deletedAt`, or soft-delete pattern.

### Admin label collapse (20+ places)

**packages/admin/src/routes/order/controller.js:**
- Line ~412, ~437, ~1084, ~1542–1550 — render order detail/list/search/board — all call some fallback like `order.address || { name: "Store_Pickup" }` or similar.

**packages/admin/src/routes/user/controller.js:**
- Line ~119 — user order list — same collapse.

**packages/shared/repositories/order.repository.js:**
- Lines ~1638, ~1729 — aggregation `$lookup` on address + village match — both apply the same fallback, mislabeling analytics.

**haper-admin/src/pages/Orders/OrderDetailsModal.tsx:**
- Lines ~573–579 — renders `order.address.city / .state / .zipCode` (fields that **don't exist** on the real address schema — always blank), no empty-state for missing address.

### Rider-stranding risk

**haper-delivery/DeliveryFormatters.kt:**
- Lines ~54, ~152 — DeliveryOrder and EditableDeliveryOrder render the address live from `.populate('addressId')` and read `location.coordinates` for navigation.
- A customer deletes the address mid-delivery → rider's screen loses the address + coordinates → navigation breaks (rider can still tap "navigate" but has no coordinates to pass to the map app).

---

## 2. Real evidence (from local prod-dump analysis only)

**Source:** `prod-dump/haper-prod/*.bson` — data extracted from PROD once, analyzed offline, never touched live.

### Order HP966912806 — real home delivery, now mislabeled as pickup

- **Customer:** Aditya Kumar, phone `9508631366`, account created 18 Aug 2026, 14:49 IST.
- **Order:** order ID `HP966912806`, amount ₹271, payment method `RAZORPAY` (prepaid), status `CLOSED`, delivery address originally set at checkout, later deleted by customer.
- **Today in admin:** shows as `"Store_Pickup ()"` — wrong.
- **Address doc:** no longer exists in the `addresses` collection — unrecoverable.

### Order HP791912804 — cancelled, same customer, same issue

- **Order:** order ID `HP791912804`, payment method `COD`, status `CANCELLED`, created then cancelled 32s later, address subsequently deleted by customer.
- **Today in admin:** shows as `"Store_Pickup ()"` — wrong.
- **Address doc:** deleted, no recovery path.

### Assessment

Both orders prove: (1) hard-delete is irreversible, (2) the admin label logic conflates "address missing" with "genuinely a pickup order", (3) real completed deliveries are mislabeled in analytics.

---

## 3. Approved design — 3 phases, ship order: Phase 2 → Phase 1 → Phase 3

### Phase 2 (soft-delete addresses) — **Build first**

Add a soft-delete marker to the address model. Customers' address lists, default-address logic, and the checkout address-picker all filter out deleted addresses. Orders' `.populate('addressId')` **keeps resolving forever**, so all 20+ existing read-sites, rider app, invoices, and emails need **zero code changes**. This alone closes the rider-stranding risk.

**Schema change (DBA-approved, Sep 2026):**
```
addresses.schema.js:
  deletedAt: { type: Date, default: null }
```
Single field only (replaces earlier plan's dual `isDeleted: Boolean + deletedAt: Date`). Rationale: matches existing codebase soft-delete pattern in `users.schema.js:28`; avoids contradictory states (isDeleted:true + deletedAt:null); `{deletedAt: null}` as a query predicate matches both explicit null AND legacy docs missing the key.

**Repository logic:**
- `address.repository.js delete()` — instead of `Model.deleteOne(...)`, set `{ deletedAt: new Date() }`.
- All customer-facing queries (getPaginated, getDetail, getDefault, markDefault, countDocuments in add()) filter `{ deletedAt: null }` (NOT `$exists: false` — after backfill, re-saved orders materialize an explicit null, so `$exists` would wrongly skip those).
- Default-address promotion: atomic `findOneAndUpdate` (not read-then-write) on the pre-image to pick the newest **non-deleted** address. Return `{new: false}` so `deletedAt` is read under the same operation that will clear it on another address — eliminates double-tap race. Guard on `matchedCount`, never `modifiedCount` (schema has `{timestamps:true}`, so `updatedAt` always changes and `modifiedCount` is unreliable).
- Do **NOT** filter deleted addresses out of order-matching queries in **order.repository.js** lines ~241, ~1827, ~1999 — those queries filter orders (by village/pin/location), and a historical order to a since-deleted address is still a real order; leave unfiltered.

**Result:** Address lives forever (for `.populate()` to resolve), customers see only active addresses, rider keeps navigating, no client changes needed.

### Phase 1 (snapshot the address onto the order at checkout) — **Build second**

Store a copy of the delivery address on the order itself at the moment of checkout. If the address is later deleted, the order still has a snapshot to fall back to.

**Schema change (DBA-approved, Sep 2026):**
Must be built as an explicit named sub-schema (not a bare nested object literal), so Mongoose respects the parent `default: null` and does NOT materialize `{name:null, phone:null, ...}` on every order. Only explicit sub-schema allows "snapshot absent" to be represented, which is load-bearing for backfill-script candidate detection.

```
orders.schema.js:

const addressSnapshotSchema = new mongoose.Schema({
    name: { type: String, default: null },
    phone: { type: String, default: null },
    street: { type: String, default: null },
    village: { type: String, default: null },
    landmark: { type: String, default: null },
    addressLine1: { type: String, default: null },
    label: { type: String, default: null },
    pin: { type: Number, default: null },
    location: { coordinates: { type: [Number], default: [] } }
}, { _id: false });

// in orders schema:
addressSnapshot: { type: addressSnapshotSchema, default: null }
```

(Deliberately named `addressSnapshot`, NOT `address` — would silently flip admin FE precedence without review. haper-admin/src/utils/orders.ts:115 already does `order?.address || order?.addressId`, so naming matters.)

**Builder utility:**
```
packages/shared/utils/address.utils.js:
export function buildAddressSnapshot(addressDoc) {
  if (!addressDoc) return null;
  return {
    name: addressDoc.name || null,
    phone: addressDoc.phone || null,
    street: addressDoc.street || null,
    village: addressDoc.village || null,
    landmark: addressDoc.landmark || null,
    addressLine1: addressDoc.addressLine1 || null,
    label: addressDoc.label || null,
    pin: addressDoc.pin || null,
    location: addressDoc.location ? {
      type: 'Point',
      coordinates: addressDoc.location.coordinates || []
    } : { type: 'Point', coordinates: [] }
  };
}
```

**Wire into checkout (packages/user/src/routes/order/controller.js):**
- **Instant-order path** (~line 750): deliveryAddress is already loaded at ~line 606. Call `buildAddressSnapshot(deliveryAddress)` and pass to the order builder.
- **Scheduled-order path** (~line 1196): deliveryAddress is already loaded at ~line 1057. Same snapshot call.

(No new database query — deliveryAddress is already fetched and in scope.)

**Backward compatibility:** Old orders have no `addressSnapshot` field; clients ignore it (Android Gson decodes missing JSON keys to `null`, not defaults). No app release needed.

### Phase 3 (honest admin label) — **Build third**

Write a resolver function that picks the address to display, with honest precedence and fallback labels.

**Resolver:**
```
packages/shared/utils/address.utils.js:
export function resolveOrderAddressForDisplay(order) {
  // (1) If live address resolves, use it unchanged (99.9% case, zero behavior change)
  if (order.address) {
    return { address: order.address, addressFromSnapshot: false, addressUnavailable: false };
  }
  
  // (2) Else try snapshot
  if (order.addressSnapshot) {
    return { address: order.addressSnapshot, addressFromSnapshot: true, addressUnavailable: false };
  }
  
  // (3) Else genuine pickup or POS sale
  if (order.paymentMethod === 'STORE_PICKUP_PREPAID' || order.paymentMethod === 'STORE_PICKUP_POSTPAID' || order.channel === 'pos') {
    return { address: { name: 'Store_Pickup' }, addressFromSnapshot: false, addressUnavailable: false };
  }
  
  // (4) Else missing (customer deleted the address, no snapshot to recover)
  return { address: { name: 'Address unavailable' }, addressFromSnapshot: false, addressUnavailable: true };
}
```

**Admin controller call-sites (packages/admin/src/routes/order/controller.js, /routes/user/controller.js):**
- Replace all 5+ collapse-pattern locations with `resolveOrderAddressForDisplay(order)`.
- Write result back under the **existing** key (`addressId` in the response object) so no client shape change and no app release.

**Admin FE (haper-admin/src/pages/Orders/OrderDetailsModal.tsx):**
- Lines ~573–579 render blank city/state/zipCode fields (those fields don't exist on the address schema). Update to:
  - Show a proper empty state: **"Address unavailable (customer deleted it)"** when `addressUnavailable: true`.
  - Show a snapshot-badge when `addressFromSnapshot: true`: **"Address (from order history)"**.
  - (Don't break the existing pickup case — if it was genuinely a pickup, keep the existing label.)

**Result:** Admin users see honest labels, customer can see their historical order details work correctly, no client app changes.

---

## 4. Data model changes

### New fields (additive, optional)

**orders.schema.js:**
- `addressSnapshot` (optional sub-document, explicit named schema per Phase 1 section, `default: null`, mirrors address shape, `_id: false`).

**addresses.schema.js:**
- `deletedAt: { type: Date, default: null }` (single field, replaces earlier dual-field plan per DBA sign-off).

### Indexes (DBA-approved Sep 2026)

No new indexes needed — existing four indexes on `addresses` remain sufficient. Filtering on `deletedAt: null` is cheap for customer lists (expected ~5–20 addresses per customer). Address queries are already indexed by `customerId`, and filtering a small result-set is fine. Partial index on `{userId:1, isDefault:1}` with `partialFilterExpression: { isDefault: true }` self-excludes soft-deleted rows (since delete also clears `isDefault`). **Follow-up only:** `2dsphere` index on `location` appears unused (no `$near`/`$geoWithin` queries found); will accumulate soft-deleted rows and should be cleaned up in a future separate ticket (not blocking this effort).

### Migrations

**None required** — MongoDB additive optional fields live without schema migration. Backfill script (see §5) is the only data-touch, and it's opt-in.

---

## 5. Backfill script (Phase 1 support, DBA-approved parameters Sep 2026)

New idempotent script at **haper-backend/scripts/migrations/backfill-order-address-snapshot.js**, following the existing dry-run / `--apply` pattern in that folder.

**Operating parameters (binding per DBA review):**
- **Batch size:** 500 orders per `bulkWrite`, `{ordered: false}` (allows partial batch success without stopping).
- **Concurrency:** sequential batches only (not parallel) — managed Atlas dev cluster shared across projects.
- **Pause between batches:** 100-200ms (protects the shared managed service).
- **Resume mechanism:** _id watermark (`{_id: {$gt: lastId}}`, sorted `_id: 1`), not `.skip()` (skip is O(n) and unstable under concurrent writes).
- **Candidate filter:** `{addressId: {$ne: null}, addressSnapshot: null}` (literal `null`, NOT `$exists: false` — backfilled orders have explicit null, so `$exists` would wrongly exclude them forever).
- **Read preference:** `readPreference: primary` on the cursor (stale secondary read risks re-processing or snapshotting stale address data).
- **Database guard:** script MUST resolve and print `mongoose.connection.name` (DB name only, never URI/creds). Hard-abort unless it matches explicit `--db=<name>` argument at invocation. Refuse to run against anything that looks like the prod database name.

**Behavior:**
- **Dry-run (default):** report THREE numbers:
  - Total candidate orders matching the filter.
  - How many resolve to a still-existing address (recoverable).
  - How many do NOT (permanently unrecoverable — write these order IDs to a file for the "how much history did we lose" ledger).
- For unrecoverable orders: write NOTHING (leave `addressSnapshot: null`). Do NOT write a placeholder — a placeholder would be indistinguishable from a genuine store-pickup order, recreating the exact bug this effort fixes.
- For recoverable orders: call `buildAddressSnapshot(addressDoc)` and write to `addressSnapshot` in the batch.
- Idempotent: re-running on the same batch (same watermark) is safe — snapshot field is already present, so `bulkWrite` updates overwrite with the same value.
- `--apply` flag: actually execute the writes (dry-run default; no writes without explicit flag).

**Run on DEV ONLY for now** — prod run is a manual user step later, per project rules.

**Usage:**
```bash
cd haper-backend
node scripts/migrations/backfill-order-address-snapshot.js                # dry-run, reports candidates
node scripts/migrations/backfill-order-address-snapshot.js --apply        # apply snapshots
node scripts/migrations/backfill-order-address-snapshot.js --db=<name>    # safety gate: explicit DB name required
```

---

## 5a. Phase 1 prerequisites — two paths to address loss (both must be safe before Phase 1 ships)

**Prerequisite 1: Hard-delete path in account purge (DBA requirement, Sep 2026)**

`packages/cron/src/jobs/account-purge.js` (~line 73) runs a hard `deleteMany` on a user's addresses 30 days post-deletion — a separate hard-delete path that Phase 2's soft-delete does NOT cover. DBA's decision: keep this as hard-delete (it's a right-to-erasure / GDPR compliance requirement, not UX soft-delete — conflating the two would be wrong). **However**, it is only SAFE to keep doing this once Phase 1's `addressSnapshot` exists on orders.

Ordering constraint: Phase 1 must ship → backfill must run on PROD → THEN this purge job is safe to leave as hard-delete (addresses are already snapshot-protected).

**Prerequisite 2: Privacy regression fix in account purge (DBA requirement, Sep 2026)**

Phase 1's `addressSnapshot` re-introduces PII (name, phone, street, landmark, addressLine1, coordinates) into orders for users who have exercised account/data deletion. The purge job's existing header comment currently asserts addresses are fully gone after purge — that claim becomes false once `addressSnapshot` ships.

Required Phase 1 companion change: extend `account-purge.js` to also null out sensitive fields in the snapshot during purge:
- BLANK these: `addressSnapshot.name`, `addressSnapshot.phone`, `addressSnapshot.street`, `addressSnapshot.landmark`, `addressSnapshot.addressLine1`, and empty `addressSnapshot.location.coordinates` (set to `[]`).
- KEEP these (non-identifying, in-use by existing queries): `addressSnapshot.village`, `addressSnapshot.pin`, `addressSnapshot.label`.

This is a privacy-regression prerequisite for Phase 1, not optional.

---

## 6. Backward compatibility guarantees

- **No client app release required** for any phase — all response shapes and field names preserved.
- **New fields always optional/nullable** — old orders without snapshots fall back gracefully to live-populate, then to "Address unavailable".
- **Store-pickup and POS labels behave identically to today** — no behavior change for legitimate non-delivery orders.
- **Legacy orders (no snapshot)** fall back to live address, then to honest "Address unavailable" label — never silently break or mislabel.

---

## 7. Known open items accepted as-is (approved defaults, not blockers)

- **Live-address-first display precedence** chosen over snapshot-first. Means zero behavior change for 99.9% of orders (where the address still exists). Snapshot is a safety net, not the primary source. Can revisit once snapshot coverage is broad.

- **Admin-only for the honest-label fix** for now — customer app and rider app not changed in this pass. Future work (Phase 3.1?) can add a badge to customer order detail, and rider-app can show "address history" — but not in scope here.

- **Wallet + full-payment edge case** (rare, cosmetic): an old store-pickup order paid in full with wallet gets its `paymentMethod` overwritten to `WALLET` (when `finalPayable = 0`), losing the "this was pickup" identity. Snapshot doesn't capture payment method (snapshot is address-only), so this order will show "Address unavailable" instead of "Store_Pickup" on re-read. Accepted as acceptable — it's rare and cosmetic (the order was a pickup; the label is wrong but the historical data is not lost). Not fixed in this pass.

- **Checkout doesn't hard-reject if address vanishes mid-checkout** — if a customer loads the checkout screen with address A, then deletes address A, then submits the order, the order is still created but `addressSnapshot` will be `null`. Behavior today: order created with a bare `addressId` that won't resolve. Behavior after Phase 1: same, but we mark it explicitly. Accepted as today's behavior (no new guard in checkout). Can revisit if it becomes a problem.

- **Soft-delete is retention, not erasure** — addresses are marked deleted, not removed. If a compliance requirement surfaces later (GDPR right-to-be-forgotten), a separate hard-purge script will be needed — not in scope here.

- **Explicitly rejected: TTL index or auto-purge policy on `deletedAt`** (DBA decision, Sep 2026). Reason: "reference-blind" — it would eventually hard-delete soft-deleted address rows that live orders still point at, silently recreating the original bug via a timer instead of a user action. If a purge is ever wanted later, it must be reference-aware (verify no order references the row) AND gated on 100% snapshot backfill coverage — revisit no earlier than 6 months after Phase 1's backfill runs on prod, not part of this effort.

---

## 8. Test plan

### Unit tests

- **buildAddressSnapshot:**
  - Null input → null output.
  - Address with all fields → snapshot captures all, exact whitelist (no extra fields).
  - Address with missing optional fields → snapshot sets them to null.
  - location.coordinates → preserves array (even if empty).

- **resolveOrderAddressForDisplay:**
  - Table test over combinations: (live address | snapshot | pickup | POS | missing) × expected label.
  - Precedence: live beats snapshot, pickup/POS beats missing, missing shows "Address unavailable".
  - Result object shape: `{ address, addressFromSnapshot, addressUnavailable }`.

### Integration tests (in-memory Mongo, run from package dir)

**packages/user tests:**
- Checkout flows (COD, Razorpay, wallet, scheduled) write `addressSnapshot` on the order.
- Pickup-order checkout doesn't write a snapshot (or writes null).
- Address soft-delete (Phase 2) hides it from customer's list but doesn't break order.populate.
- Default-address promotion skips deleted addresses.
- Delete the same address twice → second delete returns 404 (or no-op gracefully).

**packages/admin tests:**
- Order list/detail/search/user-orders/scheduled-board all return correct labels for (pickup / POS / unavailable / snapshot-recovery).
- Existing test suites must stay green:
  - order-edit-discount-snapshot.test.js
  - scheduled-admin-views.test.js
- New tests: order-detail-with-deleted-address.test.js (mislabel fix).

**Test notes (DBA requirement, Sep 2026):**
- **packages/user/__tests__/address.test.js** (~line 333): currently asserts hard delete (`findById` returns null after DELETE). WILL FAIL under the new soft-delete behavior — must be rewritten to assert `deletedAt` is set instead (will be handled by the Phase 2 engineer, already briefed separately).
- **packages/user/__tests__/delete-account.test.js** (~line 266): asserts the purge cron hard-deletes addresses. Should STAY GREEN unchanged — this is the guard that ensures the compliance purge path remains a real hard delete, not soft.

**packages/delivery tests:**
- Existing "no addressId" test must stay green (rider order without address).

### Manual / e2e on dev

1. Place an order, delete the address, confirm:
   - Admin detail page shows the order with correct (snapshot or "unavailable") label.
   - Admin list page shows the same label.
   - Thermal print / invoice PDF render the address correctly.
2. Place an order, don't delete the address, confirm:
   - Admin shows the live address (zero change from today).
3. Place an order as `OUT_FOR_DELIVERY`, delete the address mid-delivery, confirm:
   - Rider app still has the address (because Phase 2 soft-deletes it, so `.populate()` still resolves).
   - Rider can navigate.

### FE verification (haper-admin)

- `tsc -b` compiles cleanly.
- `eslint .` — baseline 113 problems must not grow (known-failing baseline, not zero).
- `vitest` — 273 tests, exactly the 5 known-failing OrderDetailsModal tests (react-router context) are allowed; no new failures.

### New test guide required

**haper-misc/test-order-address-snapshot.md:**
- Overview: what it is (address durability fix, 3 phases).
- Phase-by-phase walkthrough (✅/❌ steps for checkout, delete, admin read, print).
- Edge cases (soft-delete during checkout, POS/pickup, wallet edge case).
- What deploy each phase needs.
- Cross-link from test-store-from-delivery-address.md.

---

## 9. Files that matter most

### Schema
- haper-backend/packages/shared/models/orders.schema.js — add `addressSnapshot`.
- haper-backend/packages/shared/models/addresses.schema.js — add `isDeleted`, `deletedAt`.

### Repository & utils
- haper-backend/packages/shared/repositories/address.repository.js — soft-delete in `delete()`, filters in list queries.
- haper-backend/packages/shared/repositories/order.repository.js — village-match queries stay unfiltered (orders are historic).
- haper-backend/packages/shared/utils/address.utils.js (new/extended) — `buildAddressSnapshot()`, `resolveOrderAddressForDisplay()`.
- haper-backend/packages/shared/utils/index.js — export the new utils.

### Checkout (Phase 1 wire-up)
- haper-backend/packages/user/src/routes/order/controller.js — call `buildAddressSnapshot(deliveryAddress)` at instant-order (~line 750) and scheduled-order (~line 1196) paths.

### Admin controllers (Phase 3 label resolver)
- haper-backend/packages/admin/src/routes/order/controller.js — ~5 call-sites that render order detail/list/search/board.
- haper-backend/packages/admin/src/routes/user/controller.js — user order list (~line 119).
- Call `resolveOrderAddressForDisplay()` at each, replace the collapse-pattern fallback.

### Admin FE (Phase 3 empty state)
- haper-admin/src/pages/Orders/OrderDetailsModal.tsx — update empty-state for missing address, add snapshot-badge, fix the blank city/state/zipCode fields.

### Backfill script
- haper-backend/scripts/migrations/backfill-order-address-snapshot.js (new).

### Tests & docs
- haper-backend/packages/*/test/*.test.js — add/update tests per §8.
- haper-misc/test-order-address-snapshot.md (new) — walkthrough + edge cases + deploy checklist.

---

## 10. Routing (for context only, not your task)

**Phase 2 (soft-delete):** aabha-dba reviews schema, then backend engineer implements address.repository and list-query filters.

**Phase 1 (snapshot):** same backend engineer (depends on Phase 2 being merged to dev) implements order.snapshot + buildAddressSnapshot + checkout wire-up + backfill script.

**Phase 3 (honest label):** backend engineer (resolver + 5+ controllers) + chanchal-designer (empty-state / snapshot-badge mockup) + web engineer (admin FE) in parallel.

**Tests:** santosh-tester executes test plan per §8; gated by farhan-testinfra.

**Review:** mayank-reviewer.

**Commit:** kiran-git, direct to `dev` per this project's current git workflow (no feature branches / PRs), only on explicit user go-ahead each time.

---

## 11. Abbreviations & terminology

- **HP\*\*\*\*\*\*\*\***: order ID (example: HP966912806).
- **addressSnapshot**: optional address sub-document stored on the order at checkout (Phase 1).
- **addressFromSnapshot**: resolver flag indicating the returned address came from snapshot, not live.
- **addressUnavailable**: resolver flag indicating the address is gone and unrecoverable (no snapshot).
- **Store_Pickup**: label for genuine pickup orders (paymentMethod STORE_PICKUP_PREPAID/POSTPAID or channel POS).
- **soft-delete**: mark with `isDeleted: true` instead of removing the row.
- **hard-delete**: `deleteOne(...)` — irreversible, the current (broken) behavior.
