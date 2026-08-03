# Test: Scheduled Delivery — **PHASE 0 + PHASE 1B**

## PHASE 0 (guards only, nothing customer-facing)

**Area:** Backend only. No screen changes anywhere — admin, web, Android, iOS, picker and delivery
apps are all untouched by this slice.
**Files:** `packages/shared/models/orders.schema.js` · `packages/shared/utils/pick-task.utils.js` ·
`packages/cron/src/jobs/pick-task-reconcile.js` ·
`packages/admin/src/routes/order/controller.js` (rider assign / reassign) ·
`packages/shared/repositories/item.repository.js` + `packages/user/src/routes/order/controller.js`
(lot expiry snapshot).
**Deploy needed:** backend **redeploy** only. **No DB migration**, no admin/web/app release.
Deployment is **manual and user-only**.
**Tests (green):** `packages/picking/__tests__/scheduled-delivery-guard.test.js` ·
`packages/admin/__tests__/scheduled-delivery-guards.test.js` ·
`packages/admin/__tests__/order-assign-gate.test.js` ·
`packages/cron/__tests__/pick-task-reconcile-scheduled.test.js` (+ the existing
`pick-task-reconcile.test.js`, extended). Suite totals for this slice:
**admin 970 passed · cron 38 passed · delivery 133 passed.**

> 🔴 **This slice also carries a live production bug fix for profit reporting.**
> It is unrelated to scheduled delivery and it has **its own guide** — read it, it must not ride in
> unremarked: **[test-profit-snapshot.md](test-profit-snapshot.md)**.

---

## PHASE 1B (slot booking, release, and reminders — backend only)

**Area:** Backend only. **No admin screen, no customer app UI.** A tester cannot book a slot by
tapping in the app; all testing is via the API.

**Files (new):** 
- `packages/shared/utils/scheduling.utils.js` (settings resolver, slot builder, ID encoding)
- `packages/shared/repositories/slot-capacity.repository.js` (capacity counter and claim logic)
- `packages/user/src/routes/order/controller.js` (GET /order/slots, place-order with slotId, change-slot, extended cancel)
- `packages/admin/src/routes/store/controller.js` (PUT /admin/store/:storeId/slot-config)
- `packages/cron/src/jobs/scheduled-release.js` (every 2 min: release orders to picker, alert on maintenance/expiry)
- `packages/cron/src/jobs/scheduled-reminders.js` (customer reminders: evening before, 1h before)

**Deploy needed:** backend **redeploy** only. **No DB migration** (Mongoose builds indexes at start-up), no admin/web/app release.
Deployment is **manual and user-only**.

**Tests (green):** `packages/user/__tests__/scheduled-booking.test.js` · `packages/user/__tests__/scheduled-change-cancel.test.js` · `packages/user/__tests__/seat-release.test.js` · `packages/admin/__tests__/slot-settings.test.js` · `packages/admin/__tests__/slot-capacity.test.js` · `packages/admin/__tests__/scheduled-seat-release.test.js` · `packages/cron/__tests__/scheduled-release.test.js` · `packages/cron/__tests__/scheduled-reminders.test.js`. Suite totals for this slice: **user 417 passed · admin 1020 passed · cron 58 passed · picking 58 passed**.

---

## What this is — and what it is NOT yet

**Scheduled delivery** lets a customer choose *"Deliver now"* or *"Schedule"* — pick a date up to 7 days ahead and a time slot such as *12–2 PM* — and the order then sits quietly until a few hours before the slot, when the picker finally sees it.

**Phase 0 built the guards.** **Phase 1B is the slot booking, release, and reminders — backend only.**

| Not in this delivery — do not go looking for it | Where it comes |
|---|---|
| Slot picker UI at checkout (web / Android / iOS) | Phase 2+ (later) |
| Admin slot-settings screen (currently API only) | Phase 2+ (later) |
| Admin Scheduled tab + day view on order list | Phase 2+ (later) |
| Customer change-slot / cancel UI | Phase 2+ (later) |
| Customer reminder push notifications | Phase 1B built the backend; client apps to build in Phase 2+ |

**Scheduling is off by default for every store.** A tester must enable it via the API to test Phase 1B. On live data with it off, every change here is a no-op.

### 🎯 THE ACCEPTANCE BAR — the single most important test

**With scheduling off, this slice must be a complete no-op. Nothing about today's behaviour
changes.** Everything in "Walkthrough A" below exists to prove exactly that. If any step there
behaves differently from before the deploy, **stop and report it** — that is the only failure mode
this slice can have.

**Nothing customer-facing changes in this slice.** No app screen, no order screen, no notification,
no price, no delivery time.

---

## What actually landed (under the hood)

| # | Change | Why it is a no-op today |
|---|---|---|
| 1 | **New fields on the order record**: `deliveryType` ("now" / "scheduled"), `slot.{start,end,date,key}`, `releaseAt`, `releasedAt`, `slotChangeCount`, `slotHistory`, plus release-retry bookkeeping (`releaseAttempts`, `lastReleaseAt`, `lastReleaseError`) | All **nullable or defaulted**, all additive. Old Android/iOS builds decode a missing key to `null`, which they already tolerate. **No new order status** — a scheduled order will sit at `OPEN` like any other, because old builds map an unknown status number to "Failed" |
| 2 | **Two partial database indexes** on orders (`sched_release_queue`, `sched_by_slot`) | They only index orders where `deliveryType` is literally `"scheduled"`. Since none exist, they hold **zero entries** and cost nothing on checkout |
| 3 | **Lot expiry snapshotted on each order line** — `items[].batchAllocations[].expiresAt` | Extra field written at checkout in batch-tracked stores. Nothing reads it yet. `null` when the lot has no expiry on file ("unknown", never "expiring") |
| 4 | **Gate in the shared pick-task helper** (`ensurePickTaskForOrder`) — a scheduled, un-released order never gets a pick task, whichever of the six triggers fires | The test is **positive**: it skips only when it can see `deliveryType === "scheduled"` **and** no `releasedAt`. Anything else — including every order that has no `deliveryType` at all — falls straight through and behaves as today |
| 5 | **Pick-task reconcile cron (every 60 s) fixed in BOTH directions**: it no longer grabs un-released scheduled orders, **and** its 7-day window now follows `releasedAt` for a released scheduled order so a booking made long ago does not fall off the edge | Written as `{deliveryType: {$ne: "scheduled"}}`, which **matches a missing field** — so every order in existence still qualifies exactly as before |
| 6 | **Rider assign / reassign refuse an un-released scheduled order** (400) | Positive test again, and the same condition is repeated in the update filter so it cannot be lost to a race. Pre-existing orders pass untouched |
| 7 | **`deliveredOn` hardening** (see the profit guide) | No path today re-closes an already-closed order, so it changes nothing. It is there so it stays that way |

**The rule the whole slice is built on:** guards **fail towards today's behaviour**. If the code
cannot positively see a scheduled, un-released order, it treats it as a normal order. A scheduled
order picked early is a bad day; a normal order never picked is a lost customer.

---

## Walkthrough A — the no-op checks (**do these first**)

Use the dev store you normally test on, with **picking enabled**. Do the same run once before the
deploy and once after if you can; the two must be indistinguishable.

### A1. A normal order still behaves exactly as today
- ✅ Place a normal order from the app or web (COD **and** prepaid — run it twice).
- ✅ It appears in the **admin order list** immediately, at status **Open**, with the same age timer
  and the same colours as before.
- ✅ A **pick task is created** and the order shows up in the **picker app** queue within seconds,
  exactly as before. (Prepaid: after the payment succeeds, as before.)
- ✅ Pick it, pack it, **assign a rider**, deliver it. Every status transition works as before.
- ✅ The order appears everywhere it does today: order list, ops board, dashboard counts, order
  details modal, invoice, delivery app, customer's order screen.
- ❌ No new badge, chip, tab, column, filter or message appears anywhere. If you can *see* that
  anything shipped, that is a bug in this slice.

### A2. The pick-task reconcile safety net still works
This cron runs **every 60 seconds** and creates a pick task for any Open order that somehow has none.
- ✅ Place an order in a picking-enabled store and let it flow normally — within a minute the log
  line `[cron] pick-task-reconcile: backfilled …` still behaves as before (it usually has nothing to
  do, which is also correct).
- ✅ The stale-task half of the same cron is unchanged: an order that leaves the pickable window
  still gets its open task cancelled.
- ❌ No order stops getting a pick task. This is the highest-risk change in the slice — if a normal
  order ever sits at Open with no pick task, **stop and report it**.

### A3. Rider assign and reassign still work
- ✅ Assign a rider to an Open / picked order from the admin panel → works exactly as today.
- ✅ **Reassign** it to a different rider → works exactly as today.
- ✅ On a store **without** picking enabled, an Open order is still directly assignable.
- ❌ No order becomes unassignable. The new 400 (*"This is a scheduled order…"*) must **never** be
  seen in this slice, because no scheduled order can exist.

### A4. Old orders — the ones placed before this change
Every order in the database today has **no `deliveryType` field at all** (a `.lean()` read returns
`undefined`, not `"now"` — schema defaults do not apply to lean reads). This is the trap the guards
were written around.
- ✅ Open an old order in the admin panel → details, items, timeline, invoice all render as before.
- ✅ **Reopen** an old cancelled order (admin) → it gets a pick task exactly as before.
- ✅ Assign / reassign a rider on an old ongoing order → works.
- ✅ The picker app shows old open orders exactly as before.
- ❌ Nothing about an old order is treated as scheduled. Not one of them may be skipped, hidden or
  blocked.

### A5. Everything else that touches orders
- ✅ Cancel an order (customer and admin) → refunds / restock behave as before.
- ✅ Abandoned prepaid payment → the existing cron still cancels and restocks it.
- ✅ Free gift, wallet, delivery charge, minimum order → unchanged.
- ✅ Auto-replenishment and stock alerts → unchanged.
- ✅ Order search, order activity / audit trail, cash reconciliation → unchanged.

---

## Walkthrough B — the guards themselves

**You cannot exercise these by hand in this slice.** There is no booking path, so no scheduled order
can be created without writing to the database directly — which we do not do. The guards are proven
by the automated suites instead, and those are the evidence for this slice:

| What is proven | Where |
|---|---|
| An order with `deliveryType: "scheduled"` and no `releasedAt` gets **no pick task** | `packages/picking/__tests__/scheduled-delivery-guard.test.js` |
| Once `releasedAt` is set, the **same** order does get its pick task | same file |
| An order with **no `deliveryType` field at all** still gets a pick task (fail-towards-today) | same file |
| `deliveryType` and `releasedAt` are actually **projected** by the helper's `.select()` — without this the gate would silently never fire | same file |
| The reconcile cron **does not** pick up an un-released scheduled order | `packages/cron/__tests__/pick-task-reconcile-scheduled.test.js` |
| The reconcile cron **does** still pick up a released scheduled order booked more than 7 days ago (the `releasedAt` window) | same file |
| The reconcile cron still backfills every normal and every pre-existing order, unchanged | `packages/cron/__tests__/pick-task-reconcile.test.js` |
| Rider **assign** and **reassign** refuse an un-released scheduled order with a 400, and allow everything else | `packages/admin/__tests__/order-assign-gate.test.js`, `scheduled-delivery-guards.test.js` |

Run them from the package directory so the in-memory Mongo setup fires — **never point tests at the
real database**:

```bash
cd packages/picking && NODE_ENV=test npx jest
cd packages/admin   && NODE_ENV=test npx jest     # 970 passed
cd packages/cron    && NODE_ENV=test npx jest     # 38 passed
cd packages/delivery && NODE_ENV=test npx jest    # 133 passed
```

**The message to expect later** (Phase 1, once bookings exist), on assign or reassign of an
un-released booking — **HTTP 400**:

> This is a scheduled order. It can be assigned once its delivery slot is released.

---

## Walkthrough C — the lot expiry snapshot

Stock is pulled **oldest-expiry-first**, so a booking made today could hold a lot that expires before
its delivery day next week. To make that checkable later without re-querying the batch ledger, each
order line's batch allocation now stores the lot's expiry date at the moment of sale.

- ✅ In a store with **batch tracking ON**, place an order for an item that has an expiry on its lot.
  The order completes exactly as before — same price, same cost, same stock movement.
- ✅ *(Optional, read-only dev DB check)* That order's
  `items[].batchAllocations[].expiresAt` now carries the lot's expiry date.
- ✅ In a store with **batch tracking OFF**, `batchAllocations` is still an empty list, as before.
- ✅ An item whose lot has **no expiry on file** stores `null` — meaning **unknown**, which must
  never be read as "expiring".
- ❌ Profit, COGS and margin figures do **not** change. Profit still reads the sale-time
  `items[].costPrice` snapshot — that is deliberately untouched.

---

## Walkthrough C (PHASE 1B) — Core workflow: enable → slot list → book → release → change → cancel

**Prerequisites for all tests below:** Scheduling is **off by default**. To test anything at all, you must **first** turn it on for a test store. No scheduled order can exist until you do.

### C0. Enable scheduling on a store

Before any other Phase 1B test, set up slot config. Use `PUT /admin/store/:storeId/slot-config` with a concrete payload:

```json
{
  "enabled": true,
  "slotMinutes": 60,
  "maxDaysAhead": 3,
  "minLeadMinutes": 120,
  "releaseLeadMinutes": 240,
  "maxOrdersPerSlot": 5,
  "slotsByWeekday": {
    "mon": ["09:00-10:00", "12:00-13:00"],
    "tue": ["09:00-10:00", "12:00-13:00"],
    "wed": [],
    "thu": ["09:00-10:00", "12:00-13:00"],
    "fri": ["09:00-10:00", "12:00-13:00"],
    "sat": ["10:00-11:00", "15:00-16:00"],
    "sun": []
  },
  "blackoutDates": [],
  "allowedPaymentMethods": [1]
}
```

**Explanation:** Slots are 60 min. Booking window is 3 days max. Minimum 2h lead time (a slot starting sooner is greyed "Too soon"). Orders release 4h before the slot starts. Max 5 orders per slot. Prepaid only (payment method 1 = Razorpay; 0 = COD, built but off). Store must have opening hours set or validation fails.

- ✅ The `PUT` succeeds with 200 and returns the full store doc with the config saved.
- ✅ A second `PUT` with different values overwrites the first.
- ❌ Slot "09:00-10:00" on a day when the store is closed fails with 400 and names the day.
- ❌ `maxDaysAhead: 8` is silently clamped to 7 on the backend, never returns 8.
- ❌ `maxOrdersPerSlot: 0` is silently clamped to 1.

### C1. Fetch available slots

**Before testing checkout, always fetch the slot list first.** Use `GET /user/order/slots?storeId=<id>`.

- ✅ The response has `{ enabled: true, serverNow: <ISO>, timezone: "Asia/Kolkata", maxDaysAhead: 3, allowedPaymentMethods: [1], dates: [...], serverRenderedLabels }` (payment method 1 = Razorpay).
- ✅ Each date entry is `{ dateStr: "2026-08-04", label: "Sun, 4 Aug", available: true/false, slots: [...] }`.
- ✅ Each slot has `{ slotId: "<opaque-base64>", key: "09:00-10:00", label: "9 – 10 AM", available: true/false, reason: "FULL" | "TOO_SOON" | null, remaining: 3 }` (remaining shows count when close to full).
- ✅ Unavailable slots are **returned and greyed** with a reason, never hidden.
- ✅ A date with zero available slots is greyed but still shown.
- ✅ With scheduling **off** (`enabled: false`), the list is empty and `enabled: false`. No error.

**Store is in maintenance:** the entire slot list returns as normal but all slots are greyed with reason "UNAVAILABLE". A customer can still read the page; nothing is bookable.

### C2. Book a scheduled order

Use the existing `POST /user/order/place-order` endpoint, adding `deliveryType: "scheduled"` and the `slotId` from the slot list above.

```json
{
  "cartId": "...",
  "addressId": "...",
  "paymentMethod": 1,
  "deliveryType": "scheduled",
  "slotId": "<the base64 token from C1>"
}
```

- ✅ Prepaid booking succeeds, payment captured, order status is `OPEN`, stock is taken immediately (like a normal order).
- ✅ The order carries `deliveryType: "scheduled"`, `slot: { start: <Date>, end: <Date>, date: "YYYY-MM-DD", key: "HH:MM-HH:MM" }`, `releaseAt: <Date>`, `releasedAt: null`.
- ✅ **No pick task yet.** The order is not visible in the picker app.
- ✅ A seat is claimed in the `slot_capacity` collection — the order id is added to that slot's `orderIds` array.
- ✅ A second booking into the same slot increments the count; a 6th booking when max is 5 returns **HTTP 422** with `code: "SLOT_UNAVAILABLE"` and `reason: "FULL"`. The response includes a fresh slot list so the customer can pick another time.
- ✅ **No slot is picked at booking time.** The customer still pays the same price, gets wallet-refund warning (if prepaid), stock is held exactly like a normal order.
- ❌ COD cannot be used (it is built but off in the config). Attempting it returns 400 or is silently rejected depending on the validation order.

### C3. Wait for release (the 2-minute cron)

The `scheduled-release` cron runs every 2 minutes. It finds orders where `releaseAt` has passed and `releasedAt` is still null, then:
1. Sets `releasedAt: now` (idempotency guard — compare-and-set).
2. Checks if the store is in maintenance (if so, holds and alerts admin ~every hour).
3. Checks if the slot has already ended (if so, stops retrying and records the reason in `lastReleaseError`).
4. Detects if any batch allocated to the order expires before the slot start (alerts store admin and picker, but still releases).
5. Creates the pick task and sends admin notification *outside* the transaction.

**For testing:** manually advance the server clock or wait until `releaseAt` passes.

- ✅ After release, the pick task is created and the order appears in the **picker app queue** exactly like a normal order.
- ✅ The order's `releasedAt` field is now set (was null before).
- ✅ The order's status remains `OPEN` (not a new status).
- ✅ Admin receives a notification: **"Order #XYZ due now · 4 Aug, 12–1 PM"**.
- ✅ If a batch allocated to the order is marked as expired before the slot, the store admin and picker receive an alert: *"Batch expiring on 4 Aug, 11 AM"* (example), but the order is released anyway and delivery is still attempted.

**Store in maintenance when releaseAt arrives:** the order is **held**, not auto-cancelled. Admin receives an alert: **"Order #XYZ cannot be released; store is in maintenance. Call the customer."** The alert fires ~once per hour, not every 2 minutes.

### C4. Change slot (once only, until 4h before)

Use `POST /user/order/:orderId/change-slot` with a new slot from a fresh `GET /user/order/slots` call.

```json
{
  "slotId": "<new opaque slot token>"
}
```

- ✅ Before the order is released, change-slot works exactly like booking: the new slot's seven availability checks run server-side, capacity is claimed atomically, the old slot's seat is released in the same transaction.
- ✅ A second change-slot attempt returns **409** (Conflict) and says "You have already used your one slot change."
- ✅ If the new slot is full, the change fails with **422 SLOT_UNAVAILABLE** and the customer **keeps their old slot** — nothing is written.
- ✅ If changing to the same slot, the request succeeds but is a no-op (seat is re-confirmed, old slot is not released).
- ✅ **Change window:** until `slot.start - 4h` (shown in the order response as "You can change until 2026-08-04, 08:00 AM"). After that, the endpoint returns **410** (Gone).
- ✅ After the order is released (after `releaseAt`), change-slot is blocked with **410** (the order is in the picker queue).

### C5. Cancel (until 8h before, never after release)

Use the existing `DELETE /user/order/:orderId` endpoint.

- ✅ Until `slot.start - 8h`, cancellation succeeds. Stock is restocked, wallet is refunded (if prepaid), the slot seat is released, status becomes `CANCELED`.
- ✅ **Between 8h and 4h before the slot, cancel is blocked with 409.** The order can be changed but not cancelled (deliberate to keep the sale). This is **not a bug**; it is a designed asymmetry.
- ✅ After `slot.start - 4h` (4h before), cancel also returns **410** (no longer bookable).
- ✅ After the order is released, cancel is blocked with **410**.
- ✅ The order response carries `scheduleActions: { canChangeNow: true/false, canCancelNow: true/false, changeDeadline: <ISO>, cancelDeadline: <ISO> }`, so the app can enable/disable buttons.

### C6. Fill a slot and hit the 422 response

Book 5 orders into the same slot (matching the `maxOrdersPerSlot: 5` config from C0).

- ✅ Orders 1–5 succeed normally.
- ✅ Order 6 returns **HTTP 422** with:
  ```json
  {
    "code": "SLOT_UNAVAILABLE",
    "message": "That 12:00–13:00 slot just filled up. Please pick another time.",
    "data": {
      "reason": "FULL",
      "slots": [<fresh slot list>]
    }
  }
  ```
- ✅ The response includes a fresh slot list so the customer can immediately retry a different slot without a second API call.
- ✅ Nothing is written — the 6th order is completely rolled back.

### C7. Old orders and backward compatibility

An order placed **before** Phase 1B shipped has **no `deliveryType` field at all** (a `.lean()` read returns `undefined`).

- ✅ Place a normal order from checkout **without** specifying `deliveryType`. It defaults to `"now"` server-side.
- ✅ The order behaves exactly as before: pick task created immediately, rider can be assigned, no slot window restrictions.
- ✅ Its status is `OPEN`, and it is indistinguishable from today's orders.

### C8. The midnight–5:30 AM IST edge case

Slot calculations use IST calendar dates ("2026-08-04", not UTC). Between 00:00 and 05:30 IST, the UTC calendar date is the PREVIOUS day — a naive date calc lands on the wrong day.

- ✅ Place a slot-booking request at 01:00 IST (22:30 UTC the previous day).
- ✅ Slot dates returned are correct IST dates, not off by one.
- ✅ A slot built for "2026-08-04" 09:00–10:00 IST is the correct UTC instant (00:00–01:00 UTC on 08-03 the previous day — verify against the order's saved slot.start in milliseconds).

### C9. Scheduling turned off while a booking exists

Turn scheduling OFF for the store (PUT with `enabled: false`) after one or more scheduled bookings are on the shelf.

- ✅ Existing bookings are honoured — the orders continue to exist, are released normally, and are delivered.
- ✅ New bookings cannot be placed (the slot list returns `enabled: false` and no slots).

---

## PHASE 1C (admin screens — settings, tabs, and order view)

**Area:** Admin panel (`haper-admin`) only. Backend and admin deploy together.
**Files (new):**
- `packages/admin/src/routes/store/controller.js` — slot-config endpoints (Phase 1B backend already here)
- `packages/admin/src/pages/StoreSettingsSlots.tsx` — Delivery Slots settings page
- `packages/admin/src/pages/OrderList.tsx` — three new tabs and scheduled badge
- `packages/admin/src/pages/OrderDetailsModal.tsx` — slot info and change history

**Deploy needed:** Backend **and admin together** (the screens call new endpoints). Deployment is **manual and user-only**.

### What shipped in 1C

1. **Delivery Slots settings page** — new item under Settings, per store. Toggles scheduling ON (default OFF). Shows slot length, weekday schedule, lead times, max orders per slot, blackout dates, and payment methods (cash COD is built but switched OFF).
2. **Three tabs on the Orders page** — `Live` (excludes un-released scheduled orders, default view), `Scheduled` (upcoming bookings grouped by date), `Day Plan` (one day at a time, orders grouped by slot, opens on today).
3. **Badge on scheduled order rows** — `SCHEDULED · 4 Aug, 12–2 PM` chip next to status. Normal orders have no badge.
4. **Inverted age timer for scheduled rows** — counts **towards** the slot ("Releases in 2h 10m", "Due 4 Aug, 12–2 PM") instead of aging up. Turns red only if release is >15 min late **or** the slot ended with no delivery. Never red just for being old.
5. **Dashboard and board counts exclude un-released bookings** — new "Scheduled ahead" tile and "waiting for their delivery slot" strip show them separately.
6. **Order details** show the booked slot and change history (each change timestamped).

### How to test — the critical checks

- ✅ **Headline check:** Open the Orders page, ops board, and dashboard on a store with scheduling **OFF** → no tabs, no badge, no new tile, no strip. Screens are exactly as they are today.
- ✅ Go to **Delivery Slots** and turn scheduling ON for a test store. Save.
- ✅ Return to Orders → three tabs now appear. `Live` shows only un-released and released orders awaiting pickup. `Scheduled` shows upcoming bookings grouped by date. `Day Plan` opens on today.
- ✅ Book a few scheduled orders via API (use Phase 1B Walkthrough C). They appear in the `Scheduled` tab with the date label.
- ✅ Scheduled row has the badge `SCHEDULED · <date, time-slot>` and the inverted timer (e.g. "Releases in 45m").
- ✅ After release, the order moves to `Live` and the timer becomes "Due 4 Aug, 12–2 PM". The badge stays.
- ✅ Timer turns red only if release is delayed or the slot already ended. Not red just for the order sitting for hours.
- ✅ Dashboard "Live" count does not include un-released scheduled orders; a new "Scheduled ahead" tile shows the count separately.
- ✅ Click an order → details show the slot (`4 Aug, 12:00–13:00 IST`) and a "Change history" section listing each slot change with timestamp.
- ❌ COD payment is never an option when booking a scheduled order from the app — the payment method drop-down is filtered or COD is greyed. It is built on the backend but deliberately disabled.
- ❌ No "items to reserve" roll-up or per-slot inventory forecast — that is Phase 2+.

---

## Edge cases worth probing

### Phase 0 cases

| Case | Expected |
|---|---|
| An order placed **before** this change (no `deliveryType` field at all) | Behaves **exactly as today** everywhere — pick task, reconcile cron, rider assign, reopen. This is the single most important compatibility case |
| An **old Android / iOS build** opening a new order | Renders normally. All new fields are additive and nullable; no status code changed, so nothing is mapped to "Failed" |
| Reopening a cancelled order | Still gets a pick task (the gate only skips a positively-scheduled, un-released order) |
| A store with **picking disabled** | Unchanged — the existing "only picker-enabled stores get tasks" gate still runs after the new one |
| The reconcile cron running while an order is mid-flight | Unchanged. The stale-task half never sees a scheduled order at all, because an un-released one has no task to find |
| Two new database indexes on a hot collection | They are **partial**: they only cover `deliveryType: "scheduled"`, so a normal checkout costs one in-memory comparison and **zero** index writes |
| An order that already has a pick task | Unchanged — the helper still reactivates the existing task instead of double-creating |

### Phase 1B cases

| Case | Expected |
|---|---|
| **Between 8h and 4h before the slot, cancel is blocked** | This is **intentional**, not a bug. Change is allowed (move to another slot and reset the window), cancel is not (protect the revenue). The app must show both deadlines clearly |
| Booking a slot that has just passed its lead time | If `minLeadMinutes: 120` and the slot starts in 1h 59m, it is greyed as "Too soon" and is not bookable |
| Simultaneous bookings into the same slot by two customers | Atomic: one claims the seat and commits, the other hits "Full" before their transaction even touches the capacity document. Never over-books |
| Release cron runs twice while an order is being released (overlapping ticks) | Idempotent: the loser's predicate (`releasedAt: null`) no longer matches and returns null. Only one `releasedAt` timestamp is written |
| Store maintenance is enabled AFTER an order is booked but BEFORE it releases | The order is held when `releaseAt` arrives; admin sees a maintenance-hold alert; the order can be released later when maintenance ends |
| The slot is already ended when release tries to fire (9 PM slot, cron runs at 9:05 PM) | Release detects this via `slot.end < now` and stops retrying (sets `lastReleaseError: "slot_expired"`). The order is NOT auto-cancelled |
| A batch in the order expires BEFORE the slot date | Order is released normally, but store admin and picker receive an expiry alert. Stock is **not** re-allocated and the cost is not rewritten |
| `maxOrdersPerSlot` is lowered from 20 to 5 mid-day | New bookings honour the new cap immediately. Existing 18 customers keep their seats; the slot stops accepting new ones at the reduced 5-seat level |
| Customer is on the slot-picker screen for 10 minutes, then tries to book | A fresh slot list is fetched on booking (because the app trusts the `slotId` opaque token, not a stale "slot 12" label). The seven checks run again server-side. If the slot filled in the meantime, the 422 is returned with a fresh list |
| Capacity counter reconciliation detects a phantom holder (released order still in the list) | The reconcile job pulls it out and logs at ERROR level. Finding this means a `releaseSlotClaim` call site is missing — a code bug, not a race |
| Capacity counter reconciliation detects a live order missing from its slot (over-booked) | The reconcile job adds it and logs at ERROR level (worse than a phantom). The slot was accepting over-bookings — a code bug |

---

## After deploy — quick sanity list

### Phase 0 checks (before Phase 1B testing)

1. ✅ Backend restarts cleanly; no schema or index errors in the boot log.
2. ✅ *(Optional, read-only)* `sched_release_queue` and `sched_by_slot` exist on the `orders`
   collection on dev. Mongoose builds them at start-up — **there is no migration to run.**
3. ✅ Place one order end-to-end (Walkthrough A1) and confirm nothing changed.
4. ✅ Watch the cron log for one minute: `pick-task-reconcile` runs as before, with no new errors and
   no repeated "could NOT create task" lines.
5. ✅ Do the profit checks in **[test-profit-snapshot.md](test-profit-snapshot.md)** — including
   setting `PROFIT_ATTRIBUTION_CUTOVER` to the deploy day **before** deploying.

### Phase 1B checks (new)

6. ✅ *(Optional, read-only)* `slot_capacity` and `scheduled-reminder-log` collections exist on dev.
7. ✅ Enable scheduling on a test store (Walkthrough C0) and confirm the PUT succeeds.
8. ✅ Fetch slot availability (Walkthrough C1) and confirm dates and slots are returned.
9. ✅ Book a scheduled order (Walkthrough C2): succeeds, stock is taken, no pick task yet.
10. ✅ Watch the release cron log: `[cron] scheduled-release:` lines appear and orders transition from `releasedAt: null` to a timestamp.
11. ✅ After release, the order appears in the picker app queue exactly like a normal order.
12. ✅ Change the slot (Walkthrough C4): verify old seat is released and new seat is claimed atomically.
13. ✅ Cancel before 8h: succeeds, stock is restocked, seat is released. Cancel between 8h and 4h: returns 409 (deliberate).
14. ✅ Book until the slot is full, then try to book a 6th: returns HTTP 422 with fresh slot list.

---

## Troubleshooting

### Phase 0 issues

| Symptom | Likely cause |
|---|---|
| A normal order is sitting at Open with no pick task | The highest-risk failure for this slice. Check the pick-task helper log and the reconcile cron; report immediately |
| The reconcile cron logs "could NOT create task" repeatedly for one order | Should be impossible with no scheduled orders in existence — report it with the order id |
| Rider assign returns 400 *"This is a scheduled order…"* | Should be impossible in this slice. It means an order somehow carries `deliveryType: "scheduled"` — report it |
| `batchAllocations[].expiresAt` is `null` | Either the store has batch tracking off, or that lot has no expiry recorded. Both are expected — `null` means "unknown", not "expiring" |
| Profit numbers moved | That is the other half of this slice — see **[test-profit-snapshot.md](test-profit-snapshot.md)** |

### Phase 1B issues

| Symptom | Likely cause |
|---|---|
| Slot config PUT returns 400 — "Slot on X is outside opening hours" | The slot key does not fit the store's `time[weekday].start`–`end` range. Verify the store's opening hours exist and the slot sits inside them |
| GET /user/order/slots returns `enabled: false` but I just enabled it | The store doc is stale. Try a fresh GET /admin/store/:storeId to confirm the config is saved, then retry /order/slots |
| Booking returns 422 SLOT_UNAVAILABLE even though the slot showed available | The slot filled while the customer was on the page (7 checks run again at booking). This is expected — show the fresh slot list and let them retry |
| Booking succeeds but no pick task is created and the picker cannot see it | Normal — the order is waiting for `releaseAt`. Wait for the release cron (every 2 min) or manually advance the clock past `releaseAt` |
| After release, the order is in the picker queue but the customer got no reminder | Reminders run on a separate cron. Evening-before reminder is at 8 PM IST the day before. One-hour-before is 1h before slot.start. Verify the reminder cron is running in the logs |
| Release cron logs "PHANTOM SEAT REMOVED" or "UNCOUNTED BOOKING ADDED" | A code bug in a release call site (a release path forgot to call `releaseSlotClaim`). Report the full log entry with order id and slot details |
| Cancel returns 409 between 8h and 4h before the slot | This is **intentional design** — the customer can move the order (change slot) but not cancel it (protect revenue). Show them the change-slot option instead |
| Change-slot returns 410 (Gone) | The order has already been released (past `releaseAt`) or the change window has closed (past `slot.start - 4h`). Both are correct — the order is in picking |
| Slot capacity counter keeps growing (shows 15/5 booked, for example) | A booking claimed a seat but the order later entered a seat-releasing status without calling `releaseSlotClaim`. The reconcile job will repair it and log at ERROR. This is a code bug, not a race |

---

## Reference

- Signed-off spec: `haper-misc/scheduled-delivery-design.md` (§3 customer UX, §4 admin settings, §5 seven availability checks, §6 lifecycle + release, §8 change/cancel rules, §9 edge cases, §11 admin UX, §15 backward compatibility, §16 final decisions).
- Implementation plan: `haper-misc/scheduled-delivery-plan.md` (Phase 0 + Phase 1B task table).
- Profit fix guide: `haper-misc/test-profit-snapshot.md` (required reading if this deploy carries a profitability impact).
- Backend code reference:
  - Slot availability logic: `packages/user/src/routes/order/controller.js:evaluateSlot()`
  - Slot settings schema validation: `packages/admin/src/routes/store/controller.js` (PUT slot-config endpoint)
  - Capacity counter: `packages/shared/repositories/slot-capacity.repository.js`
  - Release cron idempotency: `packages/cron/src/jobs/scheduled-release.js` (compare-and-set on `releasedAt`)
