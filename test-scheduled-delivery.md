# Test: Scheduled Delivery — **PHASE 0** (guards only, nothing customer-facing)

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

## What this is — and what it is NOT yet

**Scheduled delivery** will eventually let a customer choose *"Deliver now"* or *"Schedule"* — pick
a date up to 7 days ahead and a time slot such as *12–2 PM* — and the order then sits quietly until
a few hours before the slot, when the picker finally sees it.

**None of that is built yet.** This slice is **Phase 0: the groundwork and the guards.**

| Not in this slice — do not go looking for it | Where it comes |
|---|---|
| Slot picker at checkout (web / Android / iOS) | later phases |
| The booking API, slot availability, capacity limits | Phase 1 |
| The release cron that hands the order to the picker | Phase 1 |
| The admin slot-settings page, Scheduled tab, day view | Phase 1 |
| Change-slot / cancel rules, reminder pushes | Phase 1 |

**Scheduling is off by default for every store, and there is no code path that can create a
scheduled order.** So on live data every change here is a no-op.

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

## Edge cases worth probing

| Case | Expected |
|---|---|
| An order placed **before** this change (no `deliveryType` field at all) | Behaves **exactly as today** everywhere — pick task, reconcile cron, rider assign, reopen. This is the single most important compatibility case |
| An **old Android / iOS build** opening a new order | Renders normally. All new fields are additive and nullable; no status code changed, so nothing is mapped to "Failed" |
| Reopening a cancelled order | Still gets a pick task (the gate only skips a positively-scheduled, un-released order) |
| A store with **picking disabled** | Unchanged — the existing "only picker-enabled stores get tasks" gate still runs after the new one |
| The reconcile cron running while an order is mid-flight | Unchanged. The stale-task half never sees a scheduled order at all, because an un-released one has no task to find |
| Two new database indexes on a hot collection | They are **partial**: they only cover `deliveryType: "scheduled"`, so a normal checkout costs one in-memory comparison and **zero** index writes |
| An order that already has a pick task | Unchanged — the helper still reactivates the existing task instead of double-creating |

---

## After deploy — quick sanity list

1. ✅ Backend restarts cleanly; no schema or index errors in the boot log.
2. ✅ *(Optional, read-only)* `sched_release_queue` and `sched_by_slot` exist on the `orders`
   collection on dev. Mongoose builds them at start-up — **there is no migration to run.**
3. ✅ Place one order end-to-end (Walkthrough A1) and confirm nothing changed.
4. ✅ Watch the cron log for one minute: `pick-task-reconcile` runs as before, with no new errors and
   no repeated "could NOT create task" lines.
5. ✅ Do the profit checks in **[test-profit-snapshot.md](test-profit-snapshot.md)** — including
   setting `PROFIT_ATTRIBUTION_CUTOVER` to the deploy day **before** deploying.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| A normal order is sitting at Open with no pick task | The highest-risk failure for this slice. Check the pick-task helper log and the reconcile cron; report immediately |
| The reconcile cron logs "could NOT create task" repeatedly for one order | Should be impossible with no scheduled orders in existence — report it with the order id |
| Rider assign returns 400 *"This is a scheduled order…"* | Should be impossible in this slice. It means an order somehow carries `deliveryType: "scheduled"` — report it |
| Looking for the slot picker / Scheduled tab / slot settings page | **Not built yet.** This slice is guards only — see "What this is / what it is NOT yet" |
| `batchAllocations[].expiresAt` is `null` | Either the store has batch tracking off, or that lot has no expiry recorded. Both are expected — `null` means "unknown", not "expiring" |
| Profit numbers moved | That is the other half of this slice — see **[test-profit-snapshot.md](test-profit-snapshot.md)** |

---

## Reference

- Signed-off spec: `haper-misc/scheduled-delivery-design.md` (§6 lifecycle, §12 known breakage,
  §14 profit fix, §15 backward compatibility, §16 final decisions).
- Implementation plan: `haper-misc/scheduled-delivery-plan.md` (Phase 0 task table, §8 profit fix).
- Profit fix guide: `haper-misc/test-profit-snapshot.md`.
