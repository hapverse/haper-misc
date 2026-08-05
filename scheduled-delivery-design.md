# Design Spec — Scheduled Delivery (Deliver Now / Schedule Later)

Date: 2026-07-30 · **Revision 2**
Status: **All product decisions signed off by the user. Not yet built, nothing committed.**

> **Revision 2 changed two fundamentals.** Read this even if you read revision 1:
> 1. **Stock IS now held at booking** (revision 1 said it was not). This inverts §6 and removes
>    most of what revision 1 called Phase 0.
> 2. **The booking ceiling is 7 days, not 30.**
> Revision 1's claim that "no stock is held, so there is nothing to return" was wrong on the code
> and is the reason this revision exists — see §10.

---

## 1. Summary + a concrete example

At checkout the customer picks one of two things:

- **Deliver now** — exactly today's behaviour, "delivery in 20–30 mins", nothing changes.
- **Schedule** — pick a date up to N days ahead (N is set per store, **hard ceiling 7**) and a time
  slot such as *9–11 AM*.

Everything about the slots is controlled by the store admin: how long a slot is, which slots run on
which weekday, how far ahead people can book, how many orders one slot can hold, and holidays.

### Concrete example

**Bhagwan Bazar** store, open 07:00–20:00. The admin sets: slot length 2 hours, slots enabled
9–11 AM / 12–2 PM / 4–6 PM, booking up to 3 days ahead, 15 orders per slot, 25 December blacked out.

- A customer opens checkout on **1 Aug at 10 PM**. They tap **Schedule**, see dates 2 Aug → 4 Aug,
  pick **4 Aug**, and see three slots. *9–11 AM* shows **Full** (15 orders booked), so they take
  *12–2 PM*, which shows **"Only 3 left"**.
- They pay ₹800 by UPI now. **The stock comes off the shelf immediately**, exactly like a normal
  order. Before paying they are told that any refund arrives as **wallet coins**.
- The order then sits quietly until 4 Aug. No picker sees it.
- On **4 Aug at 8 AM** (4 hours before the slot) the order is released: the pick task is created and
  the picker sees it in their queue like any other order.
- Delivery happens between 12 and 2 PM.

---

## 2. Decisions (signed off)

| Question | Decision |
| -------- | -------- |
| Price on delivery day | **Freeze the price booked.** Already how the code works — `salePrice` is snapshotted per line at checkout. |
| Payment methods | **Both COD and prepaid supported, prepaid-only for now.** Which methods a scheduled order may use is an admin setting per store. |
| **Stock** | **HELD AT BOOKING**, exactly like a normal order. *(Reversed in revision 2.)* |
| Cost price | Booking-day cost. Settled automatically by holding stock at booking — no separate decision needed. |
| Category restrictions | **None.** Milk and rice can both be scheduled. |
| Slot change | **Once only**, to a **different date and/or different slot**, until **4 hours** before the slot starts. Clearly communicated in the app. |
| Cancellation | Until **8 hours** before the slot, and only while the order has not gone to picking. |
| Refund on out-of-stock or cancellation | **Haper wallet coins** — the existing `refundUtils.refundToWallet`. The customer is warned **before paying**. |
| Booking window | **Configurable per store. Maximum 7 days.** *(Was 30 in revision 1.)* |
| Store in maintenance on delivery day | Order **held, not auto-cancelled**; store admin alerted. |
| Store pickup | **Delivery only.** Scheduled pickup is not offered. |
| Admin settings UI | **Dedicated page** (Chanchal's recommendation, over Arijit's store-modal section). The settings *data* still lives in `store.config`. |

---

## 3. What the customer sees

1. **Checkout** — two choices: *Deliver now — 20–30 mins* and *Schedule*. Default is *Deliver now*,
   so a customer who ignores this feature has an unchanged experience.
2. **Date strip** — today + N days. Dates with nothing available are **greyed out, not hidden**
   (hiding makes the strip jump and looks broken).
3. **Slot list** — each slot shows its time range. Unavailable slots are greyed **with the reason**:
   "Full" or "Too soon". A slot near capacity shows **"Only 3 left"**.
4. **Before payment** — a clear line that refunds for this order arrive as **Haper wallet coins**,
   not back to the card or UPI. Shown before they pay, not after.
5. **Reminder pushes** — one the **evening before** the slot, and one **an hour before** it starts.
6. **Order screen** — the booked slot, plus two real dates and times, not vague sentences:
   - "You can change this slot until **4 Aug, 8:00 AM**. One change allowed."
   - "You can cancel until **4 Aug, 4:00 AM**."
   After the change is used: "You have already used your one slot change."

---

## 4. Admin settings — a dedicated page, per store

Data lives in `store.config`, alongside the existing `deliveryRadiusKm`, `maintenance` and
`giftWithPurchaseEnabled`. The **screen** is separate because there are far too many controls for
the store modal (7 weekdays each with their own slot list, plus everything below).

| Setting | Example | Notes |
| ------- | ------- | ----- |
| Scheduling on/off | `false` | Default **off**, so every existing store is unaffected. |
| Slot length | 120 min | 60 / 90 / 120. |
| Enabled slots per weekday | Mon–Sat: 9–11, 12–2, 4–6 · Sun: 9–11 only | Must sit inside the store's existing `time` open/close hours. |
| Max days ahead | 3 | **Ceiling of 7 enforced on the backend**, not just in the admin form. |
| Minimum lead time | 2 h | A slot starting sooner than this is not offered. |
| Release lead time | 4 h | How long before the slot the order goes to the picker (§6). |
| Max orders per slot | 15 | Prevents 40 orders landing on one slot with one delivery boy. |
| Blackout dates | 25 Dec, 14 Mar | Whole days with no slots. |
| Allowed payment methods | prepaid only | COD stays wired but switched off for now. |

Global defaults live in `APP_CONFIG` so a store that sets nothing still behaves sensibly.

---

## 5. Slot availability — the seven checks

Slots are **generated on read**, not stored as rows. One endpoint returns available slots for a
store and date range; the app never computes slots itself.

A slot is offered only if **all seven** hold:

1. Scheduling is on for that store
2. The date is inside the booking window
3. The date is not a blackout date
4. That weekday has that slot enabled
5. The slot sits inside store opening hours for that weekday
6. The slot start is at least the minimum lead time away
7. The slot is below its capacity

A **date** greys out when no slot on it passes. A **slot** greys out with its reason — "Full"
(fails 7) or "Too soon" (fails 6).

**Worked example.** Today 2 Aug, 10:30 AM. Store open 07:00–20:00. Slots 9–11, 12–2, 4–6.
Lead time 2 h, capacity 15.

| Slot | Shown as | Why |
| ---- | -------- | --- |
| Today 9–11 AM | not shown | already passed |
| Today 12–2 PM | grey — "Too soon" | starts in 1½ h, under the 2 h lead time |
| Today 4–6 PM | **available** — "Only 3 left" | 12 of 15 booked |
| Tomorrow 9–11 AM | grey — "Full" | 15 of 15 booked |
| 25 Dec | whole date grey | blackout |

Two rules that matter:

- A **cancelled order frees its place** for someone else.
- **Every check runs again server-side at the moment of booking.** A customer can sit on the slot
  screen for ten minutes while the last place goes, so the app's view is never trusted alone.

### Capacity must be a counter document, not a count-on-read

Counting booked orders at read time is **broken by construction, not merely racy**: Mongo has no
predicate locks, so two customers can both read "14 booked", both insert, and both commit with no
conflict — 16 orders in a 15-order slot. Use a `slot_capacity` document keyed on
`(storeId, dateString, slotString)` holding the claimed order ids, claimed with a guarded
`$addToSet` **inside the checkout transaction**.

**Key on strings, not Dates.** Two writers producing `.000Z` and `.001Z` silently create two
capacity documents for one slot — a 30-order slot with no error anywhere.

---

## 6. Order lifecycle

A scheduled order is an **ordinary order that gets picked later**. Stock, payment, pricing, wallet
and gift all behave exactly as they do today. The only difference is that the pick task is delayed.

```
Booking                              Release (releaseAt)                Slot
  |                                        |                              |
  |-- order saved, status OPEN             |-- pick task created          |-- delivered
  |-- payment captured (prepaid)           |-- batch re-checked (§9)      |
  |-- STOCK TAKEN (normal FEFO)            |-- from here it is a          |
  |-- NO pick task yet                     |   completely normal order    |
```

**`releaseAt` = the later of (slot start − release lead time) and (store opening time that day).**

Why the second half matters: the store opens at 07:00. If a customer books the 7–9 AM slot, 4 hours
before is 3 AM — the shop is shut and there is no picker. So that order releases at 07:00 and the
picker takes it first. Operationally the cleaner answer is for the admin to simply **not enable a
slot that starts at opening time** — make the first slot 9–11 AM.

A release cron runs **every 2 minutes**, finds scheduled orders whose `releaseAt` has passed and
which have not been released, and creates the pick task. (2 minutes keeps the existing 15-minute
"release is stuck" alarm sensible — the grace must stay at least 3× the interval.)

**Idempotency: compare-and-set on `releasedAt` as the first write inside the transaction.** A
null-check is read-then-write, and `cron.schedule` gives no re-entrancy protection, so a slow run
genuinely overlaps its successor. The loser aborts with a WriteConflict — the job must treat that as
"someone else won", not an error worth paging on.

### Pick-task creation must skip un-released scheduled orders

There are **six** triggers, not the four revision 1 listed. One is a generic mongoose hook with no
call site, so **the guard belongs in `pick-task.utils.js` itself** — and that function's `.select()`
must include the new fields, or the guard silently never fires.

| File | What it is |
| ---- | ---------- |
| `packages/user/src/routes/order/controller.js:443` | COD / wallet checkout |
| `packages/user/src/routes/razorpay/controller.js:137` | prepaid, after the payment webhook |
| `packages/shared/events/emitter.js:17` | the order-placed event handler |
| `packages/cron/src/jobs/pick-task-reconcile.js:43` | **the dangerous one** — see below |
| + 2 more found by the audit | see the plan document |

`pick-task-reconcile` looks for orders at status OPEN with no pick task and creates one, because
normally that means a dropped event. A scheduled order is exactly that shape **on purpose**. It
breaks in *both* directions: it would shove an unreleased order into the picker queue within 60
seconds, **and** its 7-day `createdAt` window means a released booking near the edge of the window
has no safety net at all.

---

## 7. Data model — additive and backward compatible

Old Android and iOS builds map any **unknown order status number** to "Failed" and drop the order
from tracking (see the comment at `packages/user/src/routes/order/controller.js:26`). So we must
**not** add a new `SCHEDULED` status. A scheduled order carries the normal `OPEN` status with new
fields alongside it.

Every new field is nullable or defaulted, because Gson decodes a missing key to `null`, not to the
Kotlin default:

| Field | Type | Default |
| ----- | ---- | ------- |
| `deliveryType` | `"now"` \| `"scheduled"` | `"now"` |
| `slot.start`, `slot.end` | Date | `null` |
| `releaseAt` | Date | `null` |
| `releasedAt` | Date | `null` — set by the release job; also the idempotency guard |
| `slotChangeCount` | Number | `0` |
| `slotHistory` | Array | `[]` — one entry per change, for support calls |

**Do not reuse `expectedDelivery`.** No customer client reads it, it is overwritten when a rider is
assigned, and it feeds the on-time-delivery KPI — populating it with the slot start would mark every
on-time scheduled delivery as late. *(Revision 1 proposed reusing it. Struck.)*

---

## 8. Change and cancel rules

| Action | Deadline |
| ------ | -------- |
| Change slot (once, new date and/or new slot) | slot start − 4 h, **and never after `releaseAt`** |
| Cancel | slot start − 8 h, **and never after `releaseAt`** |

Both deadlines are shown as concrete dates and times on the order screen.

Two accepted consequences:

1. **Between 8 and 4 hours before the slot, a customer can move the order but not cancel it.**
   Deliberate — moving keeps the sale.
2. **Changing the slot restarts the cancel window** against the new slot, so someone who moves a
   Monday order to Thursday can then cancel it. Accepted as fair.

A slot change moves the **capacity claim** from the old slot to the new one atomically. It does not
touch stock — stock was taken at booking and stays taken. The new slot must itself pass all seven
checks in §5.

---

## 9. Edge cases

| Situation | Behaviour |
| --------- | --------- |
| **Batch expires before the delivery date** | Stock is pulled oldest-expiry-first at booking, so a booking made today can be assigned a batch that expires before its slot. **Phase 1: detect and alert.** `expiresAt` is persisted on the allocation at checkout, compared to the slot at release, and the **store admin and picker are alerted** if the lot expires first. **Automatic re-allocation is phase 2** — it rewrites `items[].costPrice` after the sale, which is the exact class of bug §14 exists to fix, and needs a "which cost is the truth" decision that does not exist yet. *(Revision 2 over-promised auto re-allocation in phase 1. Corrected.)* |
| **`batchNo` is not a stable identity over 7 days** | `stockIn` merges by `batchNo` and keeps the **earliest** expiry, so the same batch number can mean a different lot a few days later. Anything re-checking a batch must not assume otherwise. |
| Item damaged / missing at picking | The picker's normal out-of-stock flow — line reduced or removed, `adjustments` written, prepaid customer refunded to wallet. Identical to a normal order. |
| Store in maintenance on delivery day | Order **held, not auto-cancelled**. Store admin alerted to call the customer. |
| Store closed that weekday | Cannot happen at booking (slots come from opening hours). If hours change after booking, treat as maintenance. |
| Prepaid payment never completes | Existing abandonment cron cancels and restocks — **correct now**, because stock really was taken. **But the slot claim leaks:** `payment-initiated-orders.js:65-78` writes `PAYMENT_CANCELLED` and never releases the capacity claim taken inside the checkout transaction. **15 abandoned payment sheets and that slot is permanently "Full" with zero real orders in it.** Fix: one shared `releaseSlotClaim(order, session)` wired into **all seven** exit points, not just customer-cancel. |
| Customer cancels / admin cancels / admin reopens | All existing paths behave correctly, because a scheduled order holds stock like any other. |
| Customer books, then store turns scheduling off | Existing bookings are honoured; the setting only stops new bookings. |
| Free gift | Reserved at booking (`gift.utils.js:245`) — **consistent** with holding stock. No change needed. |
| Delivery charge / minimum order | Calculated and frozen at booking, like the prices. |
| Auto-replenishment | Correct, because held stock lowers the stock level and triggers restock normally. |

---

## 10. Risks accepted

0. **Phantom stock — the biggest real-world risk, and it is operational, not code.** `items.quantity`
   stays correct as a *sellable* figure, but it now diverges from the physical shelf **for days**:
   the system says 7, the shelf holds 12, because 5 are booked for Thursday. Today that gap lasts
   minutes. **A store admin doing a manual count will "find" 5 phantom packets and stock-in a
   correction — and those 5 units then sell twice.** This is what makes the §11.6 day view
   load-bearing rather than a nice-to-have: it is how the store sees *why* the numbers differ.
1. **Shelf lock-up — the main cost of holding stock.** You have 12 packets of milk; 5 are booked for
   3 days out. Today's walk-in customers see 7. If those packets would have spoiled anyway, that is
   real lost sale. This scales directly with the booking window — **which is why the ceiling was cut
   from 30 days to 7.**
2. **Price risk.** Prices are frozen at booking. Over 7 days this is small; over 30 it was not.
3. **Refund-to-wallet.** A prepaid customer who loses items gets wallet coins, not money back to
   UPI. Mitigated by warning them before they pay (§3.4). Real money back to source is a later
   upgrade (Razorpay refund API).
4. **Early-morning slots are tight** — a slot starting at opening time gets no head start for
   picking. Mitigated by not enabling such a slot.

---

## 11. How admin and store admin tell a scheduled order apart

The data is unambiguous — every order carries `deliveryType` and its slot. The problem is that the
admin panel reads status `OPEN` as **"act on this now"**, and a scheduled order sits at `OPEN` for
up to 7 days. Six changes:

1. **Badge on the order row.** Normal orders look exactly as today. A scheduled one carries a
   clearly different chip: `SCHEDULED · 4 Aug, 12–2 PM`.
2. **Two tabs on the order list.** **Live** (default) — needs action now, **excludes un-released
   scheduled orders**. **Scheduled (12)** — upcoming bookings grouped by date. Without this a store
   admin sees a dozen orders that look neglected and are not.
3. **The age timer must invert.** Today the row counts up from order-placed and reddens as it ages —
   which is why a scheduled order goes red after 6 minutes and stays red for a week. Scheduled rows
   count **towards** the slot instead: "Releases in 2h 10m" / "Due 4 Aug, 12–2 PM".
4. **Dashboard counts** exclude un-released scheduled orders, or show them as a separate figure.
5. **Two notifications, not one.** At booking: *"New scheduled order #123 · ₹800 · 4 Aug,
   12–2 PM"* (the sale happened, plan stock). At release: *"Order #123 due now · 12–2 PM"* (act).
   Without the second push, a booking made 5 days ago goes live with nobody watching.
   The existing single push is `sendAdminStoreNotification` in the checkout controller.
6. **A day view for the store admin** — scheduled orders grouped by slot ("9–11 AM: 6 orders ·
   4–6 PM: 11 orders"). This is how the store knows what to buy and who to roster. Listed as
   optional in revision 1; **it is core.** **Opens on today**, with tomorrow's count on its button.
   Lives as a **third tab on `/orders`**, while `Delivery Slots` (settings) gets its own nav item.
   For a super admin on "All stores" the count **sums across stores**, with store names on the
   group rows. A per-day "items to reserve" roll-up ("14 kg sugar tomorrow") is a **later phase**.

All of §11 — including the ops-board, dashboard and funnel exclusions — is **phase 1**. If the
exclusions slip, the Scheduled tab is correct while the counts beside it are wrong on day one.

| Order | Today's panel | With this built |
| ----- | ------------- | --------------- |
| #4471 normal, 4 min old | `#4471 · ₹620 · 4 min` | unchanged |
| #4472 scheduled for 4 Aug | `#4472 · ₹800 · 3 days` — **red, looks neglected** | `#4472 · ₹800 · SCHEDULED 4 Aug 12–2 PM · releases in 2h`, in the Scheduled tab |
| #4472 after release | — | moves to **Live**, behaves like any normal order, slot still shown |

The picker still sees nothing until release — correct, and no work.

---

## 12. Known breakage from parking orders at status `OPEN`

Scheduled orders sit at `OPEN` for up to 7 days with no pick task. The audit found **12** places
that assume `OPEN` means "needs attention right now". The ones that matter:

- **Delivery SLA turns every scheduled order red after 6 minutes.**
- **The ops board** calls them stale after 48 h and then hides them on the very day they need picking.
- **Phantom "unattended" orders** pile up on the dashboard.
- **`pick-task-reconcile`** — both directions, see §6.

Verified **harmless**: the picker app (zero work), the rider queue, account-purge, rate limits. And
auto-replenishment, which revision 1 flagged, is fine now that stock is held.

---

## 13. Scope by app

| App | Work |
| --- | ---- |
| Backend | Schema fields, slot-availability endpoint, capacity counter, booking validation, change/cancel endpoints, release cron, guards in the six pick-task paths, batch re-check, admin settings CRUD |
| Admin | Dedicated slot-settings page · **Live/Scheduled tabs on the order list** · scheduled badge + inverted timer on the row · dashboard counts excluding un-released · **store-admin day view grouped by slot** (§11) |
| Android | Checkout toggle, date strip, slot picker, wallet-refund notice, order-screen slot display, change/cancel |
| iOS | Same as Android |
| Web | Same as Android |
| Picker | **Nothing** — a released order looks completely normal |
| Delivery | Show the slot on the order card so the rider knows the window |

Plus `haper-misc/test-scheduled-delivery.md` — required by the project rules, in the same pass.

---

## 14. Profit-snapshot fix — ships INSIDE this feature's first phase

**Ships inside this feature's first phase, not as separate work ahead of it** (user decision).
Note the consequence: the feature's first phase now carries a live-bug fix that touches production
profit reporting, so it needs its own tests and its own line in the test guide — it must not ride in
unremarked on the back of the feature.

A **live production bug** found during the audit, otherwise unrelated to scheduled delivery: the daily profit
snapshot computes each day once at 01:00 and never revisits it, so any order completed later never
counts. Estimated from the offline dump at ~₹11,764 and 88 orders across the days the cron has run —
**that rupee figure is unverified**; only the cron logic is confirmed wrong.

**Exact current behaviour, read from the code** (`profit-snapshot.repository.js:237` →
`computeAndSaveSnapshot`): the aggregation matches a completed order **and** `createdAt` within the
target day. So the basis today is the **creation** date, gated on the order already being completed
when the cron runs. An order created yesterday and completed after 01:00 today is excluded from
yesterday's snapshot and never revisited — invisible forever.

**Naming trap for whoever implements this:** the matcher is `status: CLOSED (1)`. There is **no
`DELIVERED` status** in this system — `DELIVERED` is a local alias defined at
`profit-snapshot.repository.js:8` (`const DELIVERED = orderStatus.CLOSED`). Do not go looking for a
DELIVERED constant; it does not exist.

**Size of the loss, re-verified from the offline dump:** **67 orders · ₹9,665 revenue · ₹1,158
profit.** The earlier "₹11,764" figure was wrong *in kind* — it was missing revenue, not missing
profit. The bug is real and worth fixing; it is a smaller hole than first reported.

### The fix has two independent halves

**Half 1 — attribution basis (signed off):**

| Order type | Profit counts on |
| ---------- | ---------------- |
| Normal prepaid | **Creation date** — unchanged, exactly as today |
| COD | **Delivery date** |
| **Scheduled (any payment method)** | **Delivery date** |

The third row exists because scheduled orders are prepaid-only, so under a plain
"prepaid = creation date" rule **every scheduled order's profit would vanish permanently**: booked
1 Aug, the 1 Aug snapshot runs 01:00 on 2 Aug while the order is still undelivered (excluded), the
order is delivered 4 Aug, and 1 Aug's snapshot is never revisited. The whole feature would be
invisible in profit reporting.

For a normal order this table changes nothing — ordered and delivered inside half an hour, both
dates are the same day. It only bites where the two genuinely differ, which is exactly the case
being fixed.

**Half 2 — the snapshot must be re-runnable for a past day.** This is the actual bug and it is
independent of the basis. Without it, any late-marked delivery keeps vanishing.

Two constraints:

- **New basis applies from a cutover date forward.** The seam in the reports must be **labelled in
  the admin UI, not switched silently.**
- **Pre-cutover days ARE backfilled — signed off.** A **one-off job, run once, covering all affected
  days in a single pass.** It runs under the **OLD basis (`createdAt`)** for pre-cutover days only,
  so it changes **no definitions** — it only adds back orders that were wrongly excluded because
  they completed after the snapshot had run. **Past figures therefore move UP, never down**, and
  nothing already reported is restated differently. Recovers ≥67 orders / ₹9,665 revenue / ₹1,158
  profit as of the 14 July dump; more by now.
- Cost is unaffected — profit still reads the sale-time `orders.items.costPrice` snapshot, which is
  what makes the 2-decimal cost rounding safe. **Do not change that.**

---

## 15. Backward compatibility — hard requirement

**Nothing in this feature may change existing behaviour.** User-stated, and the project rule.

**The structural guarantee:** scheduling is **off by default for every store**, so with it off no
scheduled order can exist and every change here is a no-op on live data. No migration, no backfill.
Enable one store at a time.

| Rule | Why |
| ---- | --- |
| New order fields nullable/defaulted, never required | Old Android builds decode a missing key to `null`, not the Kotlin default. Old app + new order, and new app + old order, must both be safe. |
| **No new order status code** | Old builds map an unknown status to "Failed" and drop it from tracking. Scheduled orders stay at `OPEN`. The single most important constraint in the feature. |
| Every consumer must default `deliveryType` | Old orders have no such field, and `.lean()` does **not** apply schema defaults — reads return `undefined`, not `"now"`. The same trap is already documented in the store schema for `maintenance` and `giftWithPurchaseEnabled`; this would be the third time. |
| Guards fail **towards today's behaviour** | If the pick-task guard cannot tell what an order is, treat it as normal and create the task. A scheduled order picked early is a bad day; a normal order never picked is a lost customer. |
| No response shape, field name or enum changes | Everything additive. Android, iOS, web, picker and delivery all decode existing payloads unchanged. |
| `expectedDelivery` stays untouched | Writing the slot into it would mark every on-time scheduled delivery late on the KPI (§7). |
| Admin list/dashboard filters are additive | With no scheduled orders in existence, the Live tab returns exactly what the order list returns today. |

### The one deliberate exception

**Moving profit to the day of delivery (§14) is not backward compatible** — it changes what past
numbers mean. Recomputing history would shift daily figures already reported (a day showing ₹8,000
might become ₹9,200).

**Resolution: apply the new basis from a cutover date forward; do not recompute history.** Every
number already seen stays as it was. The cost is a seam in the reports — days before the cutover
counted one way, days after another — which must be **labelled in the admin UI, not switched
silently.**

---

## 16. Final decisions — nothing open

Every question in the plan's §13 is answered. **Nothing blocks implementation.**

| # | Question | Decision |
| - | -------- | -------- |
| 1 | Pre-cutover profit backfill | **Yes** — one-off job, single run, all affected days at once, old basis, pre-cutover days only (§14) |
| 2 | `deliveredOn` re-stamp hardening | **Include it.** No behaviour change today; removes a foot-gun that could silently move an order's profit to another day |
| 3 | Phase-2 batch re-allocation — which cost is the truth | **Booking-day cost.** Profit reads the sale-time `costPrice` snapshot, which is what keeps the 2dp rounding safe. Changing it would reopen the bug §14 closes |
| 4 | May a store admin edit a scheduled order days ahead | **Yes, allow it.** Works correctly either way (stock adjusts both directions); a customer adding 2 kg onions three days early is a normal request |
| 5 | COD switch-on | **After the feature is live**, user-triggered. Setting ships from day one, off |
| 6 | Day-view default date | **Today**, with tomorrow's count on its button |
| 7 | "Items to reserve" per-day roll-up | **Later phase.** The genuinely useful number for a store owner, but the day view covers the immediate need |
| 8 | Nav shape | **Split.** `Delivery Slots` is settings → its own nav item. `Day Plan` is about today's orders → **third tab on `/orders`** |
| 9 | Ops-board / dashboard / funnel exclusions | **Phase 1.** If they slip, the Scheduled tab is right while the counts beside it are wrong on day one |
| 10 | `scheduledCount` for super admin on "All stores" | **Sum across stores**, store names on the group rows |
| 11 | Release-cron interval | **Every 2 minutes.** Keeps the existing 15-minute stuck-release alarm sensible (3× interval well under it) |
| 12 | Amber "nearly gone" on the date strip | **Skip.** The slot list already says "Only 3 left"; colouring dates too is polish, and it needs an unspecced backend field |

### Settled since revision 2

- **Customer reminder push: YES** — the evening before, and one hour before the slot (§3.5).
- **Admin notifications:** two, at booking and at release (§11.5).
- **Admin/store-admin visibility:** six changes, incl. Live/Scheduled tabs and the day view (§11).
- **Backward compatibility:** hard requirement; scheduling off by default is the structural
  guarantee (§15).
- **Profit snapshot:** fix it. Normal prepaid → creation date (unchanged) · COD → delivery date ·
  **scheduled → delivery date regardless of payment method**. No history recompute; cutover forward,
  labelled in the UI. Plus the snapshot must be re-runnable for a past day (§14).
