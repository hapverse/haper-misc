# Implementation Plan — Scheduled Delivery (Deliver Now / Schedule Later)

**Rewritten for spec REVISION 2** · Plan date: **2026-08-02** · Spec date: 2026-07-30 (rev 2)
**Status:** 🟡 **PLAN AWAITING USER APPROVAL. No code has been written. No commits have been made. No branch was created.**
**Author:** Shavinder (principal architect), consolidating the revision-2 re-audits from rajit (stock/cron), deepanshu (profit snapshot) and chanchal (admin/store-admin design).

> ### ⚠️ THIS PLAN REPLACES THE REVISION-1 PLAN. Two fundamentals were reversed.
> 1. **STOCK IS HELD AT BOOKING.** A scheduled order is an **ordinary order that simply gets picked later**. Stock, payment, pricing, wallet and the free gift all behave **exactly as they do today**. The only difference is that the pick task is delayed until `releaseAt`.
> 2. **THE BOOKING CEILING IS 7 DAYS, NOT 30.** Per-store setting, **backend-enforced**, default short.
>
> Roughly half of the revision-1 plan is now dead. See **§1 OBSOLETE — DO NOT BUILD** immediately below. Do not "soften" those items; delete them from your mental model.

**Source documents**
| What | Absolute path |
| --- | --- |
| Product spec (signed off, **revision 2**) | `/Users/office/Documents/haper/haper-misc/scheduled-delivery-design.md` |
| This plan | `/Users/office/Documents/haper/haper-misc/scheduled-delivery-plan.md` |
| Feature test guide (to be created) | `/Users/office/Documents/haper/haper-misc/test-scheduled-delivery.md` |
| Profit-snapshot test guide (separate, to be created) | `/Users/office/Documents/haper/haper-misc/test-profit-snapshot.md` |

**Preconditions before anyone writes a line of code**
- `haper-backend` is currently on branch `fix/analytics-store-scoping` with **unrelated parallel WIP in the tree**. **Re-base off `dev` first**, and stage every file **explicitly by path** (never `git add -A` / `-am`).
- Re-check `git status` immediately before each commit — these trees carry parallel WIP and the branch can flip mid-session.
- Work lands **directly on `dev`**. `main` is off-limits.

**Signed-off product decisions this plan works WITHIN and does not re-open:** price frozen at booking · wallet-only refunds · **stock HELD at booking** · one slot change · 4h change deadline / 8h cancel deadline · **7-day ceiling** · status stays `OPEN`, no new status code · **delivery only, no scheduled store pickup** · **dedicated admin settings page** · reminder pushes YES (evening before + one hour before) · COD setting built but shipped OFF.

---

## 1. OBSOLETE FROM REVISION 1 — DO NOT BUILD

Every item below appeared in the previous plan. **All ten are now dead.** If you find any of them in a branch, a ticket, or a code review comment, delete it.

| # | Dead item | Why it is dead |
| --- | --- | --- |
| 1 | **The `stockTaken` boolean on the order** | Every order takes stock at checkout. There is no second case to distinguish, so there is nothing to flag. |
| 2 | **The shared `returnOrderStock()` helper + the audit of the five/seven restock call sites** | All existing restock paths are **correct as they stand**, because the stock really was taken. Spec §9's rows "prepaid payment never completes" and "customer/admin cancels" are right with zero code change. |
| 3 | **The inline bidirectional `holdsStock` guard in `applyItemEdit`** (`packages/shared/utils/order-edit.utils.js`) | Admin edit adjusts stock in both directions and that is now **correct by construction**. Only a product question remains (see §5.3). |
| 4 | **The admin-reopen double-deduction guard** (`packages/admin/src/routes/order/controller.js:721`) | Same reason. One deduction, one order. There is no second deduction at release. |
| 5 | **Release-time `costPrice` re-snapshot** | `packages/user/src/routes/order/controller.js:130-139` writes `costPrice` and `batchAllocations` at checkout from the **actual FEFO consume** (`sellFEFO` returns the weighted cost of the lots really taken — `packages/shared/repositories/item.repository.js:954-961`). Because stock is genuinely taken at that moment, **the snapshot IS the true consumed cost** — exactly the invariant the project protects. **There is nothing to re-snapshot.** |
| 6 | **Release-time stock TAKING** | Stock is taken at booking. The release job creates a pick task and **touches inventory not at all**. |
| 7 | **Any "stock could not be secured at release → cancel and refund" path**, and therefore **lifting `cancelEmptiedOrder` out of the picking package into `shared`** (the revision-1 blocker) | It cannot happen. Nothing is taken at release, so nothing can be short at release. The revision-1 "partial-tolerant release / `sellFEFO` all-or-nothing at release" failure mode is **gone**. |
| 8 | **A guard against `inventory-reservation-expiry`** | That cron cannot reach order stock. Proven in §6.1 — do not re-investigate it. |
| 9 | **Any 30-day booking window** in validation, the admin form, the index sizing, or the tests | The ceiling is **7**, backend-enforced. |
| 10 | **Reusing `expectedDelivery` to carry the slot** | Already struck in spec §7. Restated here so nobody re-proposes it: no customer client reads it, it is overwritten at rider-assign, and it feeds the on-time-delivery KPI. |

**Also dead as a consequence:** the "free gift breaks the no-stock-held promise" conflict (spec §9 now says the gift is reserved at booking and that is **consistent**); the "committed demand invisible to auto-replenishment" concern (held stock lowers `items.quantity`, so replenishment is now **correct**); and the revision-1 profit-snapshot design (a rolling 9-day recompute of a `createdAt`-keyed query) — replaced wholesale by §8.

---

## 2. Verdict — one paragraph

**Buildable, and revision 2 makes it a much smaller and much safer backend change than revision 1.** Holding stock at booking deletes the entire class of "phantom inventory" risk that dominated the last plan: every restock path, every edit path and the reopen path are now correct with no code change at all, and the release job shrinks to "create a pick task". What remains on the backend is genuinely modest — the slot capacity counter, the booking branch, change/cancel, one release cron, and a guard in one choke point. **The weight of this feature has moved to the admin panel.** A scheduled order sits at status `OPEN` for up to seven days, and the admin panel reads `OPEN` as "act on this now", so six separate admin surfaces (order list, ops board, dashboard, notifications, a new day view, and a new settings page) have to learn the difference — that is now the bigger half of the work, and the phasing below reflects it. Two new problems were found that were in **neither** revision: an **orphaned slot-capacity claim** when a booking dies without releasing its seat (a slot can show "Full" with zero real orders in it), and the fact that **held stock makes the system's stock number diverge from the physical shelf for days**, which will make a store admin "find" phantom stock during a manual count. Separately, the live profit-snapshot bug is confirmed and re-measured — **67 orders / ₹9,665 revenue / ₹1,158 profit lost across the nine days the cron had run as of the 14 July dump** — and per the user's decision it ships **inside phase 1, as its own first commit with its own test file**, so it stays revertible on its own.

---

## 3. What must still CHANGE in the signed-off spec

Technical corrections only. Every signed-off product decision stays intact.

### 3.1 §9 "the batch is re-checked at release and **re-allocated** if needed" — **OVER-PROMISES. Split it.**

Full analysis in §7. The short version: automatic re-allocation would rewrite `orders.items.costPrice` **after** the sale, which is the exact class of bug §14 exists to fix, and it needs new code in `store-batch.repository.js` — the single transactional chokepoint every stock mutation funnels through.

**Spec text should read:** *"The batch is re-checked at release; if the allocated lot expires before the slot, the store admin and the picker are alerted. Automatic re-allocation is phase 2."*

### 3.2 §14 "the aggregation matches `status: DELIVERED`" — **wrong about the data**

`packages/shared/repositories/profit-snapshot.repository.js:8` reads `const DELIVERED = orderStatus.CLOSED; // 1`. The enum at `packages/shared/constants/order.constant.js:1-29` has **no `DELIVERED` key**; `CLOSED: 1` is at `:16`. The spec's sentence is true of the **variable name** and false of the **data**.

**Record everywhere:** *the profit snapshot counts orders at `status = CLOSED (1)`. There is no DELIVERED status in this system.*

### 3.3 §6 "four places create a pick task" → **SIX, and the fix goes in ONE place**

Two of the six have no call site to guard, so the guard belongs in the choke point.

| # | Where | Why it fires |
| --- | --- | --- |
| 1 | `packages/user/src/routes/order/controller.js:443` | COD / wallet checkout, explicit post-commit call |
| 2 | `packages/user/src/routes/razorpay/controller.js:137` | prepaid webhook, explicit call |
| 3 | `packages/shared/models/orders.schema.js:272` (`pre('save')`, hook starts `:258`) | a NEW order saved at `status === OPEN` queues `open-order-created` → the listener in `packages/shared/events/emitter.js` |
| 4 | `packages/shared/models/orders.schema.js:334` (`post('findOneAndUpdate')`, hook starts `:317`) | **ANY** transition into OPEN. **No call site to guard.** Reachable from admin reopen (`packages/admin/src/routes/order/controller.js:676`, `:737`) and rider reject-assignment (`packages/delivery/src/routes/order/controller.js:323`) |
| 5 | `packages/cron/src/jobs/pick-task-reconcile.js:46` | runs **every 60 seconds** (`packages/cron/src/scheduler.js:17`); backfills a task for any OPEN order created in the last 7 days with no task. A scheduled order is exactly that shape **on purpose** |
| 6 | `packages/admin/src/routes/order/controller.js:1024` | on stores with `pickingEnabled: false`, rider assignment is allowed straight from OPEN |

**The guard goes inside the choke point.** In `packages/shared/utils/pick-task.utils.js`, `ensurePickTaskForOrder` starts at line **132** *(line numbers verified 2026-08-02 — the file has shifted since the earlier audit; the old plan said 114/120 and that is wrong)*. Immediately after the order read:

```js
if (order.deliveryType === 'scheduled' && !order.releasedAt) return null;
```

> 🚨 **THE GOTCHA THAT WILL SHIP THIS GUARD SILENTLY BROKEN.** Line **138** of that file reads:
> ```js
> .select({ items: 1, storeId: 1, orderId: 1 })
> ```
> **It MUST become `.select({ items: 1, storeId: 1, orderId: 1, deliveryType: 1, releasedAt: 1 })`.** Without it `order.deliveryType` is `undefined`, the guard never fires, and every scheduled order lands in the picker's queue. One-word omission, completely silent failure. **Put it in the code-review checklist.**

**Note the direction of failure.** The guard reads "is this definitely a not-yet-released scheduled order? then skip." Anything it cannot classify — a legacy order with no `deliveryType`, a projection miss — falls through to **create the task**, which is today's behaviour. That is deliberate (see §10).

Triggers 5 and 6 still need their own filters on top (§3.4, §5.3).

### 3.4 §6 `pick-task-reconcile` — the spec sees HALF the bug

**Half one (spec has it):** without an exclusion the cron shoves an un-released order into the picker queue within 60 seconds, then re-warns at `pick-task-reconcile.js:76` **once a minute, per order, for up to seven days**.

**Half two (spec misses it, and it is worse):** the job windows on `createdAt` with `windowStart = now − 7 days` (`:130`, used at `:46`). With a 7-day ceiling a booking made at the very edge is **right on the boundary** on its release day. If the post-commit `ensurePickTaskForOrder` call fails — and it is fire-and-forget with swallowed errors — **nothing backfills its task and the order is never picked.**

> ⚠️ **The obvious exclusion predicate is WRONG:**
> ```js
> deliveryType: { $ne: "scheduled" }   // WRONG — also excludes RELEASED scheduled orders, which DO need the net
> ```
> **Correct:**
> ```js
> $or: [ { deliveryType: { $ne: "scheduled" } },   // normal orders + ALL pre-existing orders (a missing field matches $ne)
>        { releasedAt: { $ne: null } } ]           // scheduled AND already released
> ```
> and the window becomes an `$or` too: normal orders on `createdAt`, scheduled orders on `releasedAt`, same 30-second grace cutoff.

### 3.5 §8 Cancellation — the 60-second window in code hard-blocks the spec's own rule

`packages/user/src/routes/order/controller.js:651-653`:
```js
const CANCEL_WINDOW_MS = 60 * 1000;
if (!createdAtMs || Date.now() - createdAtMs > CANCEL_WINDOW_MS) { /* reject */ }
```
Any cancel more than **60 seconds** after `createdAt` is rejected outright. The spec wants cancellation until slot − 8h.

**Fix:** branch on `deliveryType` so the 60-second rule for normal orders is **untouched**. Mirrored on clients: `haper-android/.../data/model/OrderModels.kt:154` (`isCancellable`) and `haper-ios/.../Models/OrderModels.swift:155` — the existing 60-second free-cancel **countdown** must be suppressed for scheduled orders on all three clients, or it directly contradicts the "cancel until 4 Aug, 4:00 AM" copy. **Settled, not open.**

### 3.6 §13 "Web — same as Android" — WRONG, web needs an EXTRA change

`haper-web/pages/OrderDetail.tsx:142` has **no 60-second window at all** — it shows a live "Cancel Order" button on **any** OPEN order, forever. A scheduled web order would show Cancel three hours before its slot when the 8h deadline has already passed, and the backend rejection is rendered **verbatim in a browser alert**. Web's `isCancellable` must respect `scheduleActions.canCancelNow` from the server.

### 3.7 §3/§5 — the spec has no error contract and no deadline-ownership decision

**DECISION 1 — the two deadlines are SERVER-COMPUTED ABSOLUTE TIMESTAMPS, never client-derived.**
1. The rules are **per-store config**. A client computing `slotStart − 4h` hard-codes a number the admin can change; the moment a store sets release lead time to 6h, three apps are wrong and two need an app-store release. *Same class of bug as the FE/BE permission mirror this project already hit.*
2. **Clock skew.** A phone 40 minutes fast would grey out "Change slot" while the server still accepts it.
3. The server enforces the deadlines anyway, so client re-derivation is duplicated logic with **no enforcement**.

**Skew mitigation:** every response carrying a deadline also carries `serverNow`. The client computes `offset = serverNow − deviceNow` once and applies it to any countdown.

**DECISION 2 — slot rejection is HTTP 422 + a machine-readable `code`. NEVER 409.**
All three clients already treat **HTTP 409 from `/order/place` as "store is in maintenance"** and respond with a config refresh plus a **full-screen maintenance wall**: `haper-android/.../OrderViewModel.kt:193`, `haper-ios/.../OrderViewModel.swift:183`, `haper-web/pages/Checkout.tsx:293`. Reusing 409 would throw a customer whose slot filled up into a maintenance wall — unfixable in already-shipped builds. No client has any 422 handling, so 422 falls to the generic error path, which shows the server message — exactly what we want.

```json
HTTP 422
{ "status": false,
  "msg": "That 12–2 PM slot just filled up. Please pick another time.",
  "code": "SLOT_UNAVAILABLE",
  "data": { "reason": "FULL", "slots": { /* same shape as the slots endpoint */ } } }
```
`msg` is **customer-ready copy, shown verbatim.** Codes: `SLOT_UNAVAILABLE` · `CHANGE_WINDOW_CLOSED` · `CANCEL_WINDOW_CLOSED` · `CHANGE_LIMIT_REACHED`. (Today the clients classify errors by **substring-matching the message** — `OrderViewModel.kt:199` does `contains("area")`. A `code` field is what stops a fourth string match being added.)

### 3.8 §3 — slot labels must be SERVER-RENDERED display strings

- Every `label` in the slots response is a **server-rendered string** (`"9 – 11 AM"`, `"Sun, 4 Aug"`). Three clients would otherwise produce three formats, and `DateFormatter` / `SimpleDateFormat` default to the **device** locale and timezone. A 90-minute slot length also breaks naive formatters.
- `slotId` is an **opaque token** the client sends back — never `start`/`end`. This enforces "the app never computes slots itself" **in the contract** rather than by discipline.
- **Full slots are RETURNED with `available: false`, not omitted** — omit them and the customer cannot tell a full slot from one that does not exist.
- The booking endpoint must **reject a client-supplied slot that does not match a server-generated one exactly. Never trust a client-sent Date.**

### 3.9 §9 "store in maintenance → held, not auto-cancelled" — the decision is right, the mechanism is missing

`store.config.maintenance` (`packages/shared/models/stores.schema.js:117-121`) has an `endTime` that auto-lifts with no cron; `maintenanceUtils.resolveEffective` is the shared resolver (used at `packages/user/src/routes/order/controller.js:195-197`).

**Mechanism:** the release job evaluates maintenance as **step 2**, before claiming. If active it does **not** claim, and instead writes (outside the transaction) a hold reason and alerts the store admin **once**. **Nobody un-holds it** — the next run simply finds maintenance inactive and releases. Cheapest correct answer, no new machinery.

### 3.10 §6 — there is no TERMINAL PATH. Must be added.

Maintenance lasting three days · the cron down for a day: today the order would retry **silently forever**.

**Add:** if `now > slot.end`, the release job **stops retrying**, records the reason, and pushes the order into an admin "needs action" queue. Not auto-cancelled (signed off) — but it must stop being invisible.

| Field | Type / default | Purpose |
| --- | --- | --- |
| `releaseAttempts` | `Number, default: 0` | how many times we tried |
| `lastReleaseAt` | `Date, default: null` | last **attempt**, not success — gives the cron a backoff so alerts fire once an hour, not every tick |
| `lastReleaseError` | `String, default: null` | `"store_maintenance"` \| `"slot_expired"` \| … |

**`lastReleaseError != null && releasedAt == null` IS the admin's attention queue.**

### 3.11 Not in the spec — the LATE WEBHOOK RULE

If `payment.captured` arrives for a scheduled order whose slot end has already passed, **do not release** — refund to wallet, exactly like the already-cancelled branch at `packages/user/src/routes/razorpay/controller.js:54-109`. The release job must also refuse to release an order whose slot has already ended, or a customer whose payment landed at 11 PM gets a pick task for a 9–11 AM slot that finished 14 hours ago.

---

## 4. Data model, settings and indexes

### 4.1 New fields on `orders` (`packages/shared/models/orders.schema.js`)

All additive, all nullable or defaulted, all Gson-safe.

| Field | Type / default | Notes |
| --- | --- | --- |
| `deliveryType` | `String, default: "now"` | `"now"` \| `"scheduled"`. **Always serialized explicitly on every order response** — see §10 |
| `slot` | sub-doc `{start, end, date, key}`, `_id:false`, all default `null` | see §5.4 |
| `releaseAt` | `Date, default: null` | when the release job should fire |
| `releasedAt` | `Date, default: null` | **the idempotency guard** — set by CAS inside the release transaction. Also the **age re-anchor** for admin SLA |
| `slotChangeCount` | `Number, default: 0` | |
| `slotHistory` | `Array, default: []` | capped with `$slice: -10` on every push |
| `releaseAttempts` / `lastReleaseAt` / `lastReleaseError` | `0` / `null` / `null` | §3.10 |
| `items[].batchAllocations[].expiresAt` | `Date, default: null` | **NEW in revision 2** — persisted at checkout so the release job can detect an expiring lot without re-querying. See §7 |

**`releaseAt` = the later of (slot start − release lead time) and (store opening time that day)** — spec §6, unchanged.

### 4.2 Two partial indexes on `orders`

The collection already carries **14 indexes** (`orders.schema.js:231-255`) and **none can serve the release query** — it filters on `releaseAt` with no `storeId` or `status` leading key, so today it would be a **full collection scan on the hottest collection every few minutes**.

```js
schema.index({ releasedAt: 1, releaseAt: 1 },
  { name: "sched_release_queue", partialFilterExpression: { deliveryType: "scheduled" } });
schema.index({ "slot.start": 1, storeId: 1 },
  { name: "sched_by_slot", partialFilterExpression: { deliveryType: "scheduled" } });
```

**The cron query must LITERALLY include `deliveryType: "scheduled"` or the planner ignores the index:**
```js
OrderModel.find({ deliveryType:"scheduled", releasedAt:null,
                  releaseAt:{ $lte: new Date() }, status: orderStatus.OPEN })
  .sort({ releaseAt: 1 }).limit(50)
```

- **Why partial:** almost every order is `deliveryType:"now"` with `releaseAt:null`. A plain index would store one entry for every order ever placed, crammed into a single null key — useless, and it costs a write on every checkout.
- **Why the filter is only `{deliveryType:"scheduled"}`:** the tighter `{releasedAt:null}` filter is syntactically legal but MongoDB warns that null-matching interacts badly with partial filters and **the failure mode is silent** — the planner quietly declines the index. If anyone wants it later it must be signed off by an `explain()` **on DEV** showing IXSCAN, not COLLSCAN.
- **Why `releasedAt` leads:** equality first, range second.
- **Write cost:** for a "Deliver now" order (90%+ of traffic), evaluating a string equality in memory and writing **zero** index entries. Genuinely free.

**One more index, for the profit fix (route to aabha-dba):** `{status:1, deliveredOn:-1}` **cross-store**. `{status:1, createdAt:-1}` exists (`orders.schema.js:243`) but the only `deliveredOn` index is store-scoped (`:253`), and the snapshot job runs across all stores with no `storeId`. See §8.4.

### 4.3 Migration — NONE NEEDED, AND NONE SHOULD BE RUN

Every new field is defaulted and the queries can be written so pre-existing documents behave correctly. Prod migrations are user-driven and manual, and `orders` is the hottest collection; an `updateMany({}, {$set:{…}})` across the whole order history would be **the riskiest thing in this feature**.

**SAFE on un-backfilled documents (these DO match a missing field):**
`{deliveryType: {$ne:"scheduled"}}` · `{deliveryType: {$in:["now", null]}}` · `{releasedAt: null}` · `{"slot.start": {$exists:false}}`

**🚨 UNSAFE — these SILENTLY EXCLUDE EVERY PRE-EXISTING ORDER:**
| Predicate | Why |
| --- | --- |
| `{deliveryType: "now"}` | old orders have no such field → **excluded from every report, list and cron. THIS IS THE ONE THAT WILL BITE.** |
| `{slotChangeCount: {$lt: 1}}` | **range predicates NEVER match missing fields.** Use `(order.slotChangeCount ?? 0) < 1` in JS, or `{$or:[{slotChangeCount:{$exists:false}},{slotChangeCount:{$lt:1}}]}` |
| `{releasedAt: {$exists: true}}` | only matches new documents |
| `{slotHistory: {$size: 0}}` | `$size` does not match a missing array |

### 4.4 Per-store settings — `store.config.scheduling`

`store.config` is **not cached**; it is read fresh via `StoreRepository.getById` (`packages/shared/repositories/stores.repository.js:14-20`), a full `findById().lean()`, with ~48 call sites including checkout (`packages/user/src/routes/order/controller.js:173`). Fine for scalars (~400 bytes).

```js
scheduling: {
  enabled:            { type: Boolean, default: false },   // OFF by default — the §15 structural guarantee
  slotMinutes:        { type: Number,  default: 120 },      // 60 / 90 / 120
  maxDaysAhead:       { type: Number,  default: 3 },        // HARD-CLAMP to 7 server-side
  minLeadMinutes:     { type: Number,  default: 120 },
  releaseLeadMinutes: { type: Number,  default: 240 },
  maxOrdersPerSlot:   { type: Number,  default: 15 },       // hard-clamp to ~200 server-side
  allowedPaymentMethods: { type: [Number], default: [1] },  // Razorpay only at launch; COD wired but off
  slotsByWeekday: { mon: {type:[String], default:[]}, /* … */ sun: {…} },  // ["09:00-11:00", …]
  blackoutDates:  { type: [String], default: [] },          // "2026-12-25", capped ~60, past dates pruned on save
}
```

**Enforce `maxDaysAhead <= 7` AND `maxOrdersPerSlot <= 200` in the schema/validator, not just the admin form. Clamp on read too.** A store row with `maxDaysAhead: 400` (a bad admin write or a future migration) must not be able to open a 400-day window.

**Blackout dates** are an array that grows every year in a document read on every checkout — the classic unbounded-array-in-a-hot-document mistake. **Cap it (~60 entries) and prune past dates server-side on every settings save.** With a 7-day booking window a store cannot meaningfully blacklist more than a couple of months ahead. *(If recurring/annual holidays are ever requested: a tiny `store_blackout_dates` collection with a unique index on `{storeId:1, date:1}`.)*

> 🚨 **THE `.lean()` TRAP — THIS WOULD BE THE THIRD TIME.** `getById` uses `.lean()`, so **Mongoose defaults are NOT applied** — an existing store document reads `config.scheduling === undefined`, **not** the defaults above. The schema comments already record this biting twice: `maintenance` at `stores.schema.js:112-116` and `giftWithPurchaseEnabled` at `:122-128`.
> **Ship ONE resolver util** (same shape as `maintenanceUtils.resolveEffective`) that takes a raw store document and returns fully-defaulted scheduling settings, and make **every** consumer call it. **Never read `store.config.scheduling.enabled` directly.** Same rule applies to `order.deliveryType` — see §10.

---

## 5. Answers to the four architecture questions

### 5.1 Slot capacity — how do we count it without over-booking?

**Winner: a counter document holding a bounded LIST OF ORDER IDS.** New collection `slot_capacity`, one document per (store × IST calendar day × slot):

```js
{ _id, storeId,
  slotDate: "2026-08-04",   // IST calendar day, STRING
  slotKey:  "12:00-14:00",  // local wall-clock label, STRING
  slotStart: ISODate, slotEnd: ISODate,   // for range reads + TTL
  orderIds: [ObjectId, ...],              // who holds a seat. Length = booked count.
  cap: 15, createdAt, updatedAt }
```

**Why the key is STRINGS and not the `slot.start` Date.** Slot identity must be a value every writer produces byte-identically. A Date is computed; the day one writer produces `...T06:30:00.000Z` and another `...T06:30:00.001Z`, you silently get **two capacity documents for the same slot, each with its own cap of 15 — a 30-order slot, with no error anywhere.** `"2026-08-04" + "12:00-14:00"` cannot drift. (Spec §5 says the same.)

**Indexes:**
```js
index({storeId:1, slotDate:1, slotKey:1}, {unique:true, name:"slot_identity"})   // two docs impossible
index({storeId:1, slotStart:1}, {name:"slot_window"})                            // availability endpoint
index({slotEnd:1}, {expireAfterSeconds:7776000, name:"slot_ttl"})                // 90-day self-cleanup
```

**Volume:** 1 store × 3 slots × 7 days = **21 live documents**. Two stores with a year of history ≈ 2,200 docs of ~250 bytes. A rounding error.

**The exact atomic operation — two steps.**

Step 1, **outside** the transaction, idempotent, ensure the doc exists:
```js
try {
  await SlotCapacityModel.updateOne({ storeId, slotDate, slotKey },
    { $setOnInsert: { slotStart, slotEnd, orderIds: [], cap } }, { upsert: true });
} catch (e) { if (e.code !== 11000) throw e; }   // two customers created it at once — fine, it exists now
```

Step 2, **inside** the same transaction that inserts the order:
```js
const claimed = await SlotCapacityModel.findOneAndUpdate(
  { storeId, slotDate, slotKey,
    $or: [ { [`orderIds.${cap - 1}`]: { $exists: false } },   // fewer than `cap` entries
           { orderIds: orderObjectId } ] },                    // I already hold a seat (retry-safe)
  { $addToSet: { orderIds: orderObjectId }, $set: { cap } },
  { new: true, session });
if (!claimed) → 422 SLOT_UNAVAILABLE
```

Three things make it correct:
1. `orderIds.14: {$exists:false}` is the documented **"array shorter than 15"** test, evaluated **under the document's write lock**, so it cannot be stale at the moment of the write.
2. `$addToSet` (not `$push`) means a retried claim can never take two seats.
3. The `$or` second branch means an already-seated order retrying at a now-full slot is still told **"yes, you have your seat"** instead of a wrong "Full".

`cap` is read from **live** store config at request time, so lowering 15 → 10 immediately stops new bookings **without evicting the 15 already in**.

**The order id must be PRE-GENERATED in JS** (`new mongoose.Types.ObjectId()`) and passed into `OrderRepository.add`, so the claim and the insert refer to the same id.

> ⚠️ **IMPLEMENTER REQUIREMENT.** `placeOrder` today uses **manual** `session.startTransaction({readPreference:'primary'})` at `packages/user/src/routes/order/controller.js:164` and `commitTransaction()` at `:340`, which does **not** retry. Adding a shared document to that transaction means two customers booking the identical slot within ~100 ms produce a **WriteConflict and one checkout errors out**. **Wrap only the scheduled branch in `session.withTransaction(...)`**, which retries `TransientTransactionError` automatically. The "now" path keeps its existing manual transaction **byte-for-byte**. The failure direction is safe either way: it fails **closed** and never over-books.

**Why count-on-read loses — and why a transaction does NOT save it.**

| Time | Event |
| --- | --- |
| 10:00:00.100 | customer A: count → 14, proceed |
| 10:00:00.140 | customer B: count → 14, proceed |
| 10:00:00.190 | A inserts. Real count 15. |
| 10:00:00.210 | B inserts. **REAL COUNT 16. CAP BREACHED.** |

MongoDB has **no predicate locks, no gap locks, no `SELECT … FOR UPDATE`**. A transactional read takes a **snapshot**; it does not block another transaction from inserting a document that *would* have matched. Both read 14 from their own snapshot, both insert, both commit — and **no conflict is detected because they never touched the same document.** **There is no isolation level in MongoDB that makes count-then-insert safe. It is broken by construction, not merely racy.**

**Why the unique-seat-number trick loses.** Not wrong — a unique index on (store, slot, seatNumber) genuinely prevents over-booking. It loses on cost and blast radius: every claim needs a read to find a free number plus a retry loop; a burst produces an E11000 storm with up to 15 round-trips per customer; a hole in the middle (seat 7 cancels) needs gap handling or seats leak; it writes **15 documents per slot instead of 1**; and the availability endpoint becomes a `$group`. The seat *number* has no business meaning.

**Does the counter drift?** Three classic causes are eliminated by construction: double-count impossible (`$addToSet` of the same id is a no-op) · double-release impossible (`$pull` of a gone id is a no-op) · claim-without-order impossible (the claim commits in the **same transaction** as the order insert). **One** residual cause remains, and it is a **code gap, not a race** — see §5.2. **That is why the document stores order IDs and not a number:** a repair job can name the exact phantom holders.

#### 5.2 🚨 NEW BREAK — the orphaned slot-capacity claim (in NEITHER revision)

`packages/cron/src/jobs/payment-initiated-orders.js:65-78` writes `PAYMENT_CANCELLED` and nothing else. **The dead booking's slot claim is never released.**

**Concrete:** a customer opens the payment sheet for the 4 Aug 12–2 PM slot (the claim is taken inside the checkout transaction, spec §5), abandons payment, the cron cancels the order 15 minutes later — and the slot is **still counted as full forever**. Repeat 15 times and the slot is permanently "Full" with **zero real orders in it**.

**FIX: one shared `releaseSlotClaim(order, session)` helper, called from EVERY place an order leaves a live status** — not only from the customer-cancel endpoint:

| Moment | What happens to the seat | Where |
| --- | --- | --- |
| Booking (prepaid, order at PAYMENT_INITIATED) | `$addToSet` guarded on length < cap, **inside the checkout transaction**; failure → 422, nothing written | `placeOrder`, `packages/user/src/routes/order/controller.js:162-341` |
| Payment success (webhook → OPEN) | **NOTHING** — the seat was taken at booking; otherwise two people could both pay for the last seat | `razorpay/controller.js` |
| Razorpay order-create fails (rollback → PAYMENT_CANCELLED) | `releaseSlotClaim`, in the same compensation block that restocks and refunds wallet | `order/controller.js:360-412` |
| **Payment abandoned (the new break)** | **`releaseSlotClaim` in the abandonment cron's transaction** | `packages/cron/src/jobs/payment-initiated-orders.js:65-78` |
| `payment.failed` webhook | `releaseSlotClaim`, in the block that already checks `stockRestored` and restocks | `packages/user/src/routes/razorpay/controller.js:168-190` |
| Customer cancel (until slot − 8h) | `releaseSlotClaim` inside the existing cancel transaction | `order/controller.js:622-742` |
| Admin cancel (ADMIN_CANCELED) | `releaseSlotClaim` inside the existing cancel transaction | `packages/admin/src/routes/order/controller.js:624`, `:894-914` |
| Slot change (once, until slot − 4h) | ONE transaction: (1) **claim the NEW slot** — if it fails, ABORT and the customer KEEPS their old slot; (2) release the old slot; (3) guarded single-document order update | new change-slot endpoint |
| Release | **NOTHING** — a released order still consumes that slot's delivery capacity. The seat stays for the life of the order | new release cron |
| Delivered / undelivered | nothing; the doc ages out via the 90-day TTL on `slotEnd` | TTL index |
| Drift repair | both directions, every correction logged at **ERROR** | `slot-capacity-reconcile` |

**Repair job `slot-capacity-reconcile`** — every 10 minutes, current and future slots only, **both directions** (pull dead/moved holders; add live scheduled orders missing from their doc). Two rules:
1. **Every repair is logged at ERROR level and counted.** A repair firing means a release call site is missing — a bug to fix, not routine housekeeping. If it corrects things every day, the design has failed.
2. **Define the RELEASING statuses explicitly, not the holding ones:**
   ```js
   seatReleasingStatuses = [PAYMENT_FAILED, PAYMENT_CANCELLED, CANCELED, ADMIN_CANCELED, FAILED, DELETED]
   ```
   Everything else holds a seat. A status added in 2027 then defaults to "still holds a seat" — worst case a seat stays blocked (**visible, fixable**) instead of being freed and over-booking (**invisible, ugly**).
   **DO NOT reuse `successStatuses`** (`packages/shared/constants/order.constant.js:64-73`) — it omits PAYMENT_INITIATED and UN_DELIVERED, both of which must hold a seat.

**The slot-change guard MUST be in the update predicate, not a read-then-write**, or a double-tap spends both the first change and the "one allowed" change:

```js
OrderModel.findOneAndUpdate(
  { _id, userId, deliveryType:"scheduled", releasedAt:null, slotChangeCount:{ $lt: 1 } },
  { $inc:{ slotChangeCount: 1 },
    $set:{ "slot.start":newStart, "slot.end":newEnd, "slot.date":d, "slot.key":k, releaseAt:newReleaseAt },
    $push:{ slotHistory: { $each:[entry], $slice: -10 } } },   // $slice caps the array NOW, while it costs nothing
  { new:true, session });   // null return = already changed once, or already released
```

> ⚠️ **`releaseAt` MUST be recomputed on slot change, inside that same transaction** — otherwise an order moved from Thursday to Tuesday keeps Thursday's `releaseAt` and **releases two days late**.

### 5.3 Release-cron idempotency — and what release now actually does

**Release is now tiny.** Stock was taken at booking. The release job **creates a pick task and nothing else touches inventory.**

**A `releasedAt == null` check is NOT a guard; it is read-then-write.** `packages/cron/src/scheduler.js:17` uses `cron.schedule('* * * * *', …)` and node-cron **does not skip a still-running previous invocation**, so a slow run genuinely overlaps its successor.

**The guard must be a compare-and-set performed as the FIRST WRITE INSIDE the transaction.** The house pattern already exists at `packages/cron/src/jobs/inventory-reservation-expiry.js:50-62`.

> ⚠️ Inside a Mongo transaction, the **loser** of `findOneAndUpdate({_id, releasedAt: null}, {$set:{releasedAt: now}})` will typically **abort with a WriteConflict / TransientTransactionError rather than politely return `null`**. Treat that as *"another worker won this order"* — not an error to retry forever, not something to page on.

**Exact ordering** inside `session.withTransaction(…, { readPreference: 'primary' })`:
1. **Claim** — CAS on `releasedAt`. Loser aborts / returns → do nothing.
2. **Re-check LIVE store maintenance + today's opening hours.** Active → hold (§3.9), do **not** claim.
3. **Slot already ended?** → terminal path (§3.10), record `lastReleaseError`, stop retrying.
4. **Batch expiry DETECTION** (§7) — compare each line's persisted `batchAllocations[].expiresAt` to the slot start. Any lot expiring first → set a flag for the post-commit alert. **Nothing moves.**

**Post-commit, OUTSIDE the transaction:** 5. `ensurePickTaskForOrder` · 6. admin release notification · 7. the expiring-lot alert if step 4 flagged one.

> 🔴 **MANDATORY: every transaction opened from the `cron` package must pass `{ readPreference: 'primary' }`.** The prod cron connection is `secondaryPreferred` and the driver **rejects transactional reads on a secondary**. Documented in-code at `packages/cron/src/jobs/payment-initiated-orders.js:38-43`, applied at `:79` and `inventory-reservation-expiry.js:63`.

**The release burst.** `releaseAt` derives from the slot start, so **every** order for the 12–2 PM slot releases at exactly 08:00. Because release no longer touches stock this is far lighter than revision 1, but still:
1. Bound each tick with `.limit(50)` **sorted by `releaseAt` ascending**, so the oldest pending always goes first; `releasedAt` is the idempotency guard so a long tick simply resumes next tick.
2. Optional per-order **jitter on `releaseAt` (±10 minutes)** so the herd spreads.
3. Keep the index equality-then-range so a backlog never becomes a collection walk.

### 5.4 Does keeping status `OPEN` break anything? — RE-GRADED for revision 2

Every item below was **re-verified item by item**, not assumed.

**STILL STANDS — must be built**
| What | Why it breaks | Fix |
| --- | --- | --- |
| The pick-task guard + all six triggers (§3.3) | an un-released order lands in the picker queue | choke-point guard + the `.select()` at line **138** |
| `pick-task-reconcile` in **both** directions (§3.4) | floods the picker AND leaves a released booking with no safety net | `$or` predicate + `releasedAt` window |
| Release idempotency (§5.3) | overlapping cron runs | CAS on `releasedAt` first-write-in-transaction, `{readPreference:'primary'}` |
| **SLA flag** — `packages/admin/src/routes/order/controller.js:85-115`, `OPEN:{warn:3,breach:6}` **MINUTES** anchored on `createdAt` at `:101-103` | **every scheduled order is a red "SLA breach" from minute 7** and inflates `totals.breach`. It is **pure clock arithmetic and never reads stock, so the reversal changes nothing here** | `sla: null` (or a distinct `scheduled` flag) for un-released; **after release, anchor on `releasedAt`** |
| **Ops board 48h stale cutoff** — `:1258-1272`, `matchBase` `:1261`, `staleCountMatch` `:1278` | pure `createdAt` again — and worse than clutter: **a booking made more than 48h ahead is HIDDEN FROM THE BOARD on the day it must be picked** | exclude un-released scheduled from **both** `matchBase` and `staleCountMatch`; add back at `releasedAt`; anchor staleness on `releasedAt` |
| Dashboard counts — `packages/shared/repositories/order.repository.js:1197, 1200, 1209, 1220, 1225` | phantom "unattended" orders | `$or` exclusion + a separate `scheduledUpcoming` figure (§9) |
| `reassignDeliveryBoy` — `:1091` (`ongoingStatuses` includes OPEN) and `assignDeliveryBoy` — `:1024` (non-picking stores) | an admin assigns a rider to a 5-day-out order; it leaves OPEN, the release job never fires | own filter excluding un-released scheduled |
| **Account-deletion block** — `packages/user/src/routes/profile/controller.js:14-21` | a customer with a booking cannot delete their account until it is delivered | **KEEP THE BLOCK — do NOT relax it.** See below |

**MOOT — the reversal fixed these; do not build anything**
- **Auto-replenishment** — held stock has already lowered `items.quantity`, so a booking legitimately pulls the item toward restock. Spec §9 is right.
- **The picker app, the rider queue, `account-purge`, rate limits, the customer "Active orders" list** — all still harmless.

**DOWNGRADED from BREAK to "works, decide the policy"**
- **Admin order edit** — `packages/admin/src/routes/order/controller.js:182-187`. Editing an OPEN order adjusts stock via `atomicAdjustStock` (`:392-421`): reduce a line and stock returns, increase and it is re-taken. Under revision 1 that was wrong; **now it is right by construction.** The only remaining question is a **product** one: should a store admin be allowed to edit an order 5 days before its slot? **Not a correctness break.** → Open question.

**Why the account-deletion block must stay.** `account-purge.js:40-75` hard-deletes a purged user's addresses. That is safe **only because** the profile controller blocks deletion while any OPEN order exists — and a booking is OPEN for its whole life. **The two rules are coherent.** Relaxing the block would let a purge delete the delivery address of a live, paid booking. Improve the **message** (name the scheduled order and its slot, offer the cancel path — this is an app-store-mandated flow), never the rule.

### 5.5 Timezone — the house pattern is sound; the hazards, plus how slots must be stored

**House pattern (good — use it):** `moment-timezone` with `const TZ = 'Asia/Kolkata'`, then `moment.tz(TZ).startOf('day')` / `moment.tz(str, 'YYYYMMDD', TZ)`. Used consistently in all cron jobs, `order.repository.js`, `packages/admin/src/routes/analytics/controller.js:98-105`, `packages/admin/src/routes/picker/validator.js:16`, `packages/shared/utils/gift.utils.js:83`. `$dateToString` was searched for across all packages — **found nowhere.**

**T1 — `packages/user/src/routes/store/controller.js:16-18`. THE ONE TO WORRY ABOUT.**
```js
const istDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
const dayIndex = istDate.getDay();
```
This is the **only** place that answers *"which weekday is it in IST, and are we inside opening hours"* — **precisely what the slot generator needs, so it WILL be copied.** It round-trips through a US-locale string and reads it back with **server-local** getters; it is right on a UTC-configured server only by coincidence of V8's date parser. **DO NOT COPY. Use `moment.tz(TZ).day()`.** Cleanup is a follow-up (§13).

**T3 — `packages/shared/repositories/delivery-boys.repository.js:69, 72, 124, 127` and `packages/shared/repositories/pick-task.repository.js:16, 19`** use `moment(startDate).tz(TZ).startOf('day')`, which parses in the **server's** zone first. **Slot endpoints MUST use the validator form `moment.tz(value, 'YYYY-MM-DD', TZ)`.**

**T6 — the direction that actually bites.** The hazard is **00:00–05:30 IST**, where the UTC date is the **previous** day: a customer at 1 AM IST on 4 Aug is at 19:30 UTC on 3 Aug, so a "today + N days" strip built from a **UTC** date starts on a date already in the past. Likewise a "tomorrow's scheduled orders" admin day view built on UTC days shows the wrong day for that whole window — **exactly when the morning-shift store manager opens it.**

**Slot storage — store BOTH a wall-clock identity and a UTC instant:**
```js
slot: {
  start: { type: Date,   default: null },   // UTC instant — ORDERING ONLY: releaseAt, deadlines, the cron's indexed $lte, sorting
  end:   { type: Date,   default: null },
  date:  { type: String, default: null },   // "2026-08-04" — IST calendar day. IDENTITY: capacity key, blackout key, weekday lookup, admin grouping
  key:   { type: String, default: null },   // "12:00-14:00" — local wall-clock label, mirrors stores.time.mon.start
  _id: false,
}
```
Why both: the Date alone makes a **fragile capacity key** (§5.1); the strings alone lose the cron's cheap indexed range query. The admin's configuration is wall-clock (`stores.time` is `{mon:{start:"07:00",end:"20:00"}}`, `packages/shared/models/stores.schema.js:13-21`), so the slot key speaks that language and compares to opening hours with the existing `getMinutesFromTime` helper.

> **ONE CANONICAL BUILDER, NON-NEGOTIABLE.** A single util `buildSlot(store, dateStr, slotKey) → {start, end, date, key}`, used by the availability endpoint, the booking validator **and** the change-slot endpoint. The booking endpoint must **reject a client-supplied slot that does not match a server-generated one exactly.**

**THE FIVE RULES — put this checklist in the PR description:**
1. Every weekday / calendar-date / hour-of-day decision goes through `moment.tz(…, 'Asia/Kolkata')`. **Never** `new Date().getDay()` / `.getHours()` / `.getDate()`, **never** `.toISOString().split('T')[0]`, **never** the `toLocaleString` round-trip from T1.
2. Parse every client-supplied date with an explicit format **and** zone: `moment.tz(value, 'YYYY-MM-DD', TZ)` — not `moment(value).tz(TZ)`.
3. Capacity, blackout and weekday keys are **IST date strings**, never Date ranges.
4. Any Mongo `$year` / `$month` / `$dayOfMonth` / `$isoWeek` / `$dateToString` touching a slot field **must** pass `timezone: 'Asia/Kolkata'`.
5. `releaseAt` and the two deadlines are **absolute Dates** compared against `new Date()`. Never do calendar arithmetic on them.

---

## 6. The stock-holding re-audit (revision 2)

### 6.1 THE RESERVATION-EXPIRY CRON IS CLEARED — no guard needed, do not re-investigate

The highest-risk suspected consequence of the reversal turned out to be a **non-issue**. Recorded here with evidence so nobody re-opens it.

`packages/cron/src/jobs/inventory-reservation-expiry.js` expires **warehouse supply commitments, not customer orders.**
- Timeout `EXPIRY_DAYS = process.env.RESERVATION_EXPIRY_DAYS || 7` at `:11`; runs 03:45 IST (`packages/cron/src/scheduler.js:24`).
- It selects from the **`replenishment_requests`** collection via `ReplenishmentRequestRepository.getStaleApproved(cutoff)` (`packages/shared/repositories/replenishment-request.repository.js:46-58`, status APPROVED/PARTIALLY_APPROVED with `reviewedAt < cutoff`). **Orders are never queried.**
- It writes only `WarehouseStockRepository.releaseReserved` (`packages/shared/repositories/warehouse-stock.repository.js:252-264`) → `$set reservedQty = max(0, reservedQty − qty)` on a **`warehouse_stocks`** document keyed `{warehouseId, sku}`.

A customer order's stock lives somewhere else entirely: checkout goes `packages/user/src/routes/order/controller.js:124` → `ItemRepository.sellFEFO` (`packages/shared/repositories/item.repository.js:947`) → `StoreBatchRepository.stockOutFEFO` (`packages/shared/repositories/store-batch.repository.js:161-189`), decrementing `store_batches.qtyRemaining` and re-deriving `items.quantity`. **Different collections, different keys, no shared reference.**

**Plain English:** `reservedQty` is a **promise** the warehouse made to a store — *"80 units are earmarked for an approved transfer."* Nothing has physically moved, and after 7 undispatched days the promise is cancelled so the units can be promised elsewhere. A customer order never makes such a promise — it **takes the units for real** off the store shelf ledger at checkout. **There is no counter to expire.**

**Also searched and found none:** any other reservation/timeout mechanism (`grep reservedQty|reservation|RESERVED|expiresAt` — the only reservation buckets in the system are the warehouse ones, schema at `packages/shared/models/warehouse-stocks.schema.js:26`, with exactly three callers: replenishment approve `packages/admin/src/routes/replenishment/controller.js:148`, transfer dispatch/cancel `packages/admin/src/routes/transfer/controller.js:430`, and this cron); any physical-count/stocktake/cycle-count logic; any job that marks a batch expired or deletes expired stock.

> **Store-side stock has NO reservation concept at all.** Checkout is an unconditional decrement, so **there is nothing for a timeout to release.**

### 6.2 Every cron job inventoried — the evidence that the sweep was complete

`packages/cron/src/scheduler.js:16-25`:

| Job | Schedule | What it does | Touches stock? | Touches orders? |
| --- | --- | --- | --- | --- |
| `payment-initiated-orders.js` | every 1 min | cancels PAYMENT_INITIATED >15 min: restock + wallet refund + PAYMENT_CANCELLED | yes | yes |
| `pick-task-reconcile.js` | every 1 min | backfills pick tasks for OPEN orders with none; cancels tasks whose order left OPEN/PICKING | no | reads |
| `daily-profit-snapshot.js` | 01:00 | computes one day's snapshot once, never revisits (§8) | no | reads |
| `account-purge.js` | 02:00 | anonymizes users soft-deleted >30d; hard-deletes their addresses + carts | no | no |
| `inventory-batch-reconcile.js` | 03:15 | **read-only** drift check `items.quantity` vs Σ open batches; logs, never auto-corrects (`:12-13`) | detect only | no |
| `inventory-reservation-expiry.js` | 03:45 | releases warehouse `reservedQty` on undispatched approved replenishments | warehouse counter only | no |
| `product-master-reconcile.js` | 04:00 | re-applies product-master **catalogue fields only** to item projections | no | no |
| `inventory-daily-digest.js` | 09:00 | read-only push/email of still-red inventory groups | no | no |
| `auto-replenishment.js` | hourly :30 | drafts PENDING replenishment requests for items at/below `lowQty` | no | no |
| `inventory-evaluation-sweep.js` | every 15 min | re-evaluates inventory groups (red/green + alerts) | no | no |

Verified `product-master-reconcile` **cannot** touch stock: `ProductRepository.syncToItems` (`packages/shared/repositories/product.repository.js:183-194`) `$set`s only `projectionFieldsFromProduct` (`:29-42`) — name, brand, type, unit, weight, description, images, tags, gstRate, category, subCategory, meta. **No quantity, cost or expiry.**

### 6.3 Inverted-failure-mode findings — what 7-day HELD stock actually breaks

| Where | Verdict |
| --- | --- |
| `payment-initiated-orders.js:102-105` | **HARMLESS (stock).** The filter is `status: PAYMENT_INITIATED` only; a booked scheduled order is `OPEN` and is never selected. The restock is now **correct** because stock really was taken. **But see §5.2 for the capacity claim.** |
| `inventory-batch-reconcile.js:15-46` | **HARMLESS.** A sale drops both sides in the same transaction (`store-batch.repository.js:187` recomputes the roll-up inside `stockOutFEFO`), so held stock creates no drift — and the job is read-only by design. |
| `auto-replenishment.js:40` → `item.repository.js:1210-1218` | **HARMLESS, now correct.** Held stock has already lowered `items.quantity`, so a booking legitimately pulls the item toward restock. The units are committed, not sellable. Spec §9 is right. |
| `inventory-evaluation-sweep.js` + `inventory-daily-digest.js` | **HARMLESS.** Alerts are honest for the same reason. |
| `account-purge.js:40-75` | **HARMLESS**, because the profile controller blocks account deletion while any OPEN order exists. The two rules are coherent — **which is exactly why the block must not be relaxed** (§5.4). |
| `store-batch.repository.js:161-189` `stockOutFEFO` | **DEGRADES — the real new risk.** It takes soonest-expiry first and **does not even skip already-expired lots**. See §7. |
| `store-batch.repository.js:86-149` `stockIn` merge branch | **DEGRADES (only if the release re-check is built).** A same-`batchNo` stock-in weighted-averages the cost (`:113`) and keeps the **earliest** expiry (`:122`). The order records `batchNo` (a string), not a batch id, so over 7 days a later receipt can merge into that batch number and change its cost and expiry underneath the order. `AUTO-EXP-<expiry>` names are safe by construction (same expiry); `LEGACY` and `AUTO-RCV-<today>` are not. **The already-consumed units are untouched** (`qtyRemaining` was decremented at checkout) — what breaks is the *identity* of the lot if you look it up by `batchNo`. **Any release-time re-check must never assume `batchNo` still means the same lot.** |
| `item.repository.js:978-1000` `incrementQuantity` | **DEGRADES (pre-existing, amplified).** Every restock path merges returned units into the **LEGACY catch-all** batch at the item's *current* cost, so a cancelled 7-day-old booking returns units whose real expiry is lost. **Out of scope for phase 1** — note it in the test guide. |
| **Store-admin "stock on hand" reads** | **DEGRADES — operational, real, and the one to call out.** `items.quantity` is correct as a *sellable* figure but now **diverges from the physical shelf for days**: the system says 7, the shelf has 12 (5 booked for Thursday). Today that gap lasts minutes. **A store admin doing a manual count will "find" phantom stock and may stock-in a correction — which over-counts and lets the same units be sold twice.** The §11.6 day view is the mitigation and is **genuinely load-bearing**; the store admin needs *"committed for future slots: 5"* visible next to on-hand. **Put this in the test guide.** |
| `packages/shared/utils/gift.utils.js:45-49` | **HARMLESS.** The daily gift cap counts every status except the never-paid ones, so a gift reserved at booking consumes that day's allowance — consistent with the anti-farming rule. |

---

## 7. Batch expiry at release — DETECT in phase 1, RE-ALLOCATE only in phase 2

**Verdict: the full re-allocation spec §9 promises is MODERATE-to-expensive and collides with the costPrice money invariant. Do NOT ship it in phase 1.**

### 7.1 What is missing today

1. **The order does not record the expiry.** `packages/shared/models/orders.schema.js:66-76` stores `batchAllocations` as `{batchNo, qty, costPrice}` only. The ledger *produces* `batchId` and `expiresAt` (`store-batch.repository.js:184`) but the seller wrapper **drops both** (`item.repository.js:954-958`). A release-time check would have to re-query `store_batches` by `(itemId, batchNo)` — and **`batchNo` is not a stable identity** (§6.3).
2. **There is no "give me units that do not expire before date D" primitive.** `stockOutFEFO(itemId, qty, session)` has exactly one policy — soonest expiry first — and does not even skip already-expired lots. Adding one means new code in `store-batch.repository.js`, **the single transactional chokepoint every stock mutation funnels through. That is not "small".**
3. **Returning units to a specific batch is supported but dirty.** `stockIn` merges by `(itemId, batchNo)` (`:106-124`), so returning to the original lot works — but it also increments `qtyReceived` (`:117`), so the lot claims to have received those units twice (polluting the receipt ledger and any receipt-correction logic), and returning at the old cost re-weights the lot's average if it drifted (`:113`). The generic `incrementQuantity` is worse — LEGACY, current cost, expiry lost.
4. **🔴 THE BLOCKER: re-allocating changes `items[].costPrice`.** The new lot has its own cost, so the order's `costPrice` and `batchAllocations` would be rewritten **after** the sale — meaning **a profit figure can move after the fact**, which is the exact class of bug §14 exists to fix. Spec §14 and the project's standing costPrice money invariant both say do not change that snapshot. If re-allocation is ever built it needs its own signed-off decision on **which cost is the truth** (booking-day cost per §2, or actually-consumed cost). **That decision does not exist yet.**

### 7.2 What if no non-expiring batch is available at release?

Leaving it and releasing anyway breaks §9's promise. **Failing the release is worse** — the customer's paid order dies quietly.

**Recommended: release normally and flag.** Create the pick task so the customer gets their delivery attempt, plus an admin alert: *"Order #4472, line 'Amul milk', is allocated to a lot expiring 3 Aug — check the shelf."* If the stock really has gone bad, the **picker's existing out-of-stock flow** handles it (line reduced/removed, `adjustments` written, prepaid customer refunded to wallet) — that path already exists and spec §9 row 2 already relies on it.

### 7.3 PHASE 1 — detect and flag (~half a day, no invariant risk)

1. Persist `expiresAt` on `orders.items.batchAllocations` **at checkout** — additive, nullable, Gson-safe. Requires passing the field through `sellFEFO`'s return (`item.repository.js:954-958`), which already receives it from `stockOutFEFO` (`store-batch.repository.js:184`) and currently throws it away.
2. At release, compare each allocation's `expiresAt` to the **slot start**.
3. If any line's lot expires first: **create the pick task as normal**, and raise (a) an admin alert and (b) a picker note on the task.

**Nothing moves, no cost changes, no new code in the batch chokepoint.** This delivers the real promise — *no picker is asked to pick expired stock without someone knowing* — at a fraction of the cost. Orders placed before this ships have `expiresAt: null` on their allocations, which the check must treat as *"unknown → do not flag"* (fail towards today's behaviour, §10).

### 7.4 PHASE 2 — the true re-allocation, gated

Needs its own decision record covering: which cost is the truth; a new **expiry-floored FEFO primitive** in `store-batch.repository.js`; and a clean **return-to-lot primitive** that does not inflate `qtyReceived`. Do not start it without that sign-off.

---

## 8. The profit-snapshot fix (spec §14) — ITS OWN SLICE INSIDE PHASE 1

> **Ships as commit 1 of phase 1, with its OWN commits and its OWN test file.** Not folded into the scheduled-delivery commits. Rationale in §8.9.

### 8.1 Spec correction and confirmed bug

- The matcher is **`CLOSED`, not "DELIVERED"** — see §3.2.
- The real aggregation match is `profit-snapshot.repository.js:242-248`: `{ status: 1 /* CLOSED */, createdAt: {$gte: dayStart, $lte: dayEnd} }`; the live "today" tile uses the same pair at `:98-101`.
- The bug is confirmed: `daily-profit-snapshot.js:12-15` computes `moment.tz(TZ).subtract(1,'day')` — **yesterday, once** — and `scheduler.js:18` runs it at `0 1 * * *` IST. **Nothing else ever calls `computeAndSaveSnapshot`. A day is never revisited.**

### 8.2 The loss figure — re-measured, and the old number was wrong IN KIND

The offline dump is dated **2026-07-14**, so this is "as of 14 July", not today. `profit_snapshots.bson`: 340 rows, one store — **331 written in one shot on 2026-07-05** (a manual backfill), **9 from the cron** (nightly 2026-07-06 → 07-14, covering attribution days 07-05 → 07-13). Recomputing those 9 days from `orders.bson` on the **unchanged** basis:

| Day | snapshot orders | actually CLOSED now | missing | missing revenue | missing profit |
| --- | --- | --- | --- | --- | --- |
| 07-05 | 36 | 42 | 6 | ₹638 | ₹67.76 |
| 07-06 | 10 | 12 | 2 | ₹615 | ₹39.00 |
| 07-07 | 11 | 17 | 6 | ₹852 | ₹81.18 |
| 07-08 | 21 | 25 | 4 | ₹196 | ₹18.50 |
| 07-09 | 20 | 26 | 6 | ₹1,013.50 | ₹131.45 |
| 07-10 | 17 | 30 | 13 | ₹1,253 | ₹131.57 |
| 07-11 | 15 | **36** | 21 | ₹3,290.50 | ₹469.09 |
| 07-12 | 35 | 37 | 2 | ₹153 | ₹15.00 |
| 07-13 | 24 | 31 | 7 | ₹1,654 | ₹204.47 |
| **Total** | | | **67** | **₹9,665.00** | **₹1,158.02** |

> 🔴 **The old "~₹11,764 / 88 orders" figure is REPLACED everywhere.** It was the right order of magnitude but it was **missing REVENUE, not missing PROFIT**. The correct statement: **67 orders / ₹9,665 revenue / ₹1,158 profit across the 9 days the cron had run as of the 14 July dump** — and the cron has kept running since, so today's live hole is roughly three times as many days.

### 8.3 `deliveredOn` — usable forward, with two guards

Set in exactly one place, `packages/shared/models/orders.schema.js:294-296`:
```js
if (newStatus === CLOSED) { update.$set.deliveredOn ??= new Date(); }
```
**Confirmed: `??=` tests the UPDATE PAYLOAD (`this.getUpdate()`), not the stored document.** So any `findOneAndUpdate` that writes `status: CLOSED` on an **already-CLOSED** order without carrying `deliveredOn` would **overwrite the stored value with "now"** — silently moving an order's profit from one day to another once `deliveredOn` keys money reporting.

**Not reachable today** — every close path was checked: admin `markOrderAdmin` returns early when the status is unchanged (`packages/admin/src/routes/order/controller.js:656-666`); the rider close filters on `{_id, status: currentStatus, assignedTo}` (`packages/delivery/src/routes/order/controller.js:161-167`) so an already-CLOSED order does not match; POS creates the order already CLOSED via `pre('save')` and sets `deliveredOn` itself (`packages/admin/src/routes/pos/controller.js:179,183`). The one legitimate restamp is cancelled → reopened → closed again, which is correct. **But it is one unguarded future `findOneAndUpdate` away.**

**Data check:** of 15,871 CLOSED orders, **2,836 (17.9%) have `deliveredOn = null`** — all created before Feb 2026. From 2026-02 onward: **zero nulls, including 0 of 1,307 CLOSED orders created since 2026-06-01.**

**Verdict: reliable enough to key money reporting on for post-cutover data, provided**
1. every read uses `{$ifNull: ['$deliveredOn','$createdAt']}` so legacy null rows fall back and never vanish; and
2. it is understood that `deliveredOn` means *"when someone marked it delivered"*, not *"when the box reached the door"* — a rider closing at 00:10 for a 23:50 handover moves that order to the next day. **That is the same convention cash reconciliation and rider incentives already use**, so it is at least consistent.

**Optional 5-line hardening (same pass, needs a yes/no — do NOT include silently):** the pre-hook already reads the pre-update document three lines later (`orders.schema.js:298-306`, `.select("status")`). Move the `deliveredOn` stamp **below** that read, add `deliveredOn` to the `.select(...)`, and stamp only when the **stored** doc has none. **No behaviour change today; removes the foot-gun permanently.**

### 8.4 Half 1 — the attribution basis: ONE shared expression, ONE pass

Put it in **one exported helper** in the repository and use it in **both** `computeAndSaveSnapshot` and `getLiveProfit`:

```js
const useDeliveryBasis = { $or: [
  { $eq: ['$paymentMethod', paymentMethod.COD] },                     // 0
  { $eq: [{ $ifNull: ['$deliveryType', 'now'] }, 'scheduled'] },      // §15 default trap
]};
const attributionDate = { $cond: [useDeliveryBasis, { $ifNull: ['$deliveredOn', '$createdAt'] }, '$createdAt'] };
```

The day query becomes a **superset match on two indexed ranges, then a filter on the computed field**:

```js
[ { $match: { status: DELIVERED /* CLOSED=1 */,
      $or: [ { createdAt:   {$gte: dayStart, $lte: dayEnd} },
             { deliveredOn: {$gte: dayStart, $lte: dayEnd} } ] } },
  { $addFields: { attributionDate } },
  { $match: { attributionDate: {$gte: dayStart, $lte: dayEnd} } },
  projectOrderTotals,   // unchanged, lines 39-89
  { $group: { _id: '$storeId', ... } } ]   // unchanged
```

**Why one pass over two hand-written mutually-exclusive predicates:** the rule exists in exactly one place, so **disjointness is structural** — an order has exactly one attribution date by construction. Two hand-written predicates would drift the day someone adds a fourth order type, and orders would be double-counted or dropped. The same expression is reusable **verbatim** by `getLiveProfit`, which is mandatory (hazard 5) and where drift would bite hardest.

**Performance:** the `$or` of two bounded ranges is still index-eligible (planned as an index-union of two IXSCANs plus dedup), and the outer `$match` is a plain range on real fields, **not `$expr`**.

> 🚨 **NEVER put the computed field inside the FIRST `$match` via `$expr` — that IS a full collection scan.**

**INDEX GAP (route to aabha-dba):** `{status:1, createdAt:-1}` exists (`orders.schema.js:243`, whose comment says it is specifically for cross-store profit analytics), but there is **no cross-store `{status:1, deliveredOn:-1}`** — only `{storeId:1, status:1, deliveredOn:-1}` (`:253`), and the snapshot job runs across all stores with **no `storeId`**. **The delivery leg needs `{status:1, deliveredOn:-1}`.**

### 8.5 Half 2 — re-runnable: a rolling trailing window in the nightly job, NOT an event

```
windowDays = 7
lowerBound = max(today_IST − 7 days, CUTOVER)     // hard clamp — see hazard 4
for day from lowerBound to yesterday_IST:  await computeAndSaveSnapshot(day.toDate())
```

- **Trigger:** the existing `0 1 * * *` IST schedule (`scheduler.js:18`). No new infra, no queue.
- **Bound:** 7 days, never earlier than the cutover, **never today**.
- **Why 7 is generous:** from the dump, of CLOSED orders created in Jun/Jul 2026 ~13% closed on a later calendar day, and only ~1% more than 5 days later. It also silently repairs any night the cron was down.
- **Cost:** 7 small aggregations instead of 1, once a night.

**Why NOT the `order-closed` event.** It is a technically sound trigger (`packages/shared/events/emitter.js:9` → `orderHandler.orderClosed3P_1P`, fired from `orders.schema.js:343-353` via `queueOrderEvent`, which is genuinely post-commit — `packages/shared/utils/order-event.utils.js:30-67` patches `commitTransaction` and drops the queue on abort). But it would fire a cross-store aggregation **per delivered order**, most of them recomputing *today*, which the live tile already covers — **zero benefit for the cost**. The only case it uniquely helps is an order closing now that belongs to a past day: a minority of a minority, and waiting until 01:00 for that is fine on a profit report. And **two writers to the same `(date, storeId)` row means racing bulkWrites**, whereas the nightly loop is single-writer. It can be added on top later without changing anything else.

**Also add one small thing:** a super-admin `POST /admin/analytics/profit/recompute?date=YYYYMMDD` (clamped to `>= cutover` and `<= yesterday`) so an operator can repair a day **without a deploy**.

**SAFETY PROOF — `computeAndSaveSnapshot` IS safe to re-run for an arbitrary past day.** The only collection touched is `orders` (`:242`); the only fields read are `storeId`, `status`, `createdAt` and `items[].{salePrice, costPrice, quantity}` (`:37-88`, `:242-260`). **No `$lookup`, no item-master read, no store config, no warehouse cost** — so the sale-time `orders.items.costPrice` snapshot is the only cost input and **the money invariant is untouched.**

What CAN change between runs:
1. **`status`** — a CLOSED order can be moved to UN_DELIVERED / ADMIN_CANCELED / REFUND_SUCCESS by an admin (`packages/admin/src/routes/order/controller.js:611-623`), so a re-run can legitimately make a past day go **down**.
2. **`items`** — **cannot** change after CLOSED. Every item-edit path is gated to ongoing statuses only (admin edit `:182-192` and `:350-356`; picker short-pick requires `status === PICKING`, `packages/picking/src/routes/task/controller.js:347`; both funnel through `orderEditUtils.applyItemEdit`, `packages/shared/utils/order-edit.utils.js:88`).

> **Once an order is CLOSED its money is frozen; the only thing that can move is whether it is still CLOSED.**

Tell users: *"figures for the last 7 days may still adjust"*, and expose the existing `computedAt` (`profit-snapshots.schema.js:23`).

### 8.6 FIVE HAZARDS — each with the exact rule

1. **`allTime` double-count — CONFIRMED, currently dormant, and the recompute is what ARMS it.** `profit-snapshot.repository.js:191` `getSnapshotSum({storeId})` has **no date bound**, and `:198` does `allTime: addBuckets(allSnap, todayLive)`. Any snapshot row dated **today** is counted twice.
   **RULES (do both):** the recompute loop must never write a row dated today (upper bound = yesterday); **AND** change `:191` to `getSnapshotSum({storeId, to: yesterdayEnd})` as belt-and-braces. `week` (`:186`), `month` (`:189`) and `getProfitRange` (`:213-215`) already clamp to `yesterdayEnd` — **only `allTime` is exposed.**
2. **Stale rows — upsert-only, never deletes.** `:262` is `if (results.length === 0) return 0;` and `:265-280` is `updateOne … upsert:true` with `$set` only. Refund the last remaining order of a day and re-run: the aggregation returns zero rows, the function returns early, and **the old row survives forever with the old money.** Same per store.
   **RULE — delete-and-rebuild the day, per store:** compute the results, then `deleteMany({date: dayStart, storeId: {$nin: resultStoreIds}})`, then upsert. A missing row and a zero row are identical to `getSnapshotSum` (it sums), so deleting is clean. Guard the `bulkWrite` against an empty ops array (Mongoose throws) — **but do NOT skip the delete when results are empty; that is the whole bug.**
3. **IST duplicate-row.** `:4` `TZ='Asia/Kolkata'`; `:238-240` `moment.tz(targetDate, TZ).startOf('day')/.endOf('day')`; the row key is `dayStart` (`:267`). **`dayStart` is IST midnight expressed as a UTC instant = 18:30 UTC of the previous calendar date** — proved from the dump: a row carries `date = 1754418600000 ms = 2025-08-05T18:30:00Z = 2025-08-06 00:00 IST`. The unique index is `{date:1, storeId:1}` (`profit-snapshots.schema.js:28`), so a key built at a different instant does **not** error — it inserts a **second row for the same business day**, and `getSnapshotSum` happily adds both.
   **RULES:** always call `computeAndSaveSnapshot(day.toDate())` and let it derive `dayStart` itself; **never construct a `{date: ...}` filter or key by hand anywhere** — not in the cron, not in the manual endpoint, not in tests. Also fix the wrong comment at `profit-snapshots.schema.js:9` (`// midnight UTC of the day` — it is **IST** midnight; that comment is exactly how this class of bug gets written).
4. **Cutover-seam double count — NEW and the nastiest.** Cutover 4 Aug; a COD order created 3 Aug, delivered 5 Aug. The post-cutover rule puts it on 5 Aug. If the rolling window ever reaches back to 3 Aug and recomputes it under the **old** rule, that order — now CLOSED — also lands on 3 Aug. **Counted twice.**
   **RULE:** the window's lower bound is `max(today − N, CUTOVER)`; **days before the cutover are never recomputed, ever.** One rule buys both the no-double-count guarantee and the user's "do not recompute history" constraint.
5. **The live tile must use the same basis, or orders still disappear.** `getLiveProfit` (`:97-101`) is `createdAt`-only. If only the snapshot changes basis, a COD order created yesterday and delivered today is in **neither** yesterday's snapshot **nor** today's live tile — the same bug in a new costume.
   **RULE: one shared attribution expression used by `computeAndSaveSnapshot` AND `getLiveProfit`. This is the single most important implementation detail of Half 1.**

### 8.7 Cutover mechanism — a CONSTANT, not a DB value

```js
PROFIT_ATTRIBUTION_CUTOVER = '2026-08-04'   // IST date, resolved with moment.tz(..., TZ).startOf('day')
```
Living next to the profit repository or in `shared/constants`, used by `computeAndSaveSnapshot`, `getLiveProfit` and the window's lower bound. **Set it to the day it actually deploys.**

**Why not `APP_CONFIG` / store config:** a DB-stored cutover can be edited by anyone with the config screen, and moving it **silently rewrites what past numbers mean** — precisely what the constraint forbids. It would also have to be per-store to be meaningful, multiplying the seam. A constant is code-reviewed, greppable, pinned to a deploy and shows up in the diff — **it cannot be silently forgotten**, which is the stated bar.

**What the backend must expose so the admin UI can label the seam** (all additive, §15-safe) — on `GET /admin/analytics/profit` (`packages/admin/src/routes/analytics/controller.js:297-343`, fields slot into the `res.json` at `:315-322`):

```jsonc
"attribution": {
  "cutoverDate": "2026-08-04",
  "beforeCutover": "order_date",
  "afterCutover": "delivery_date_for_cod_and_scheduled",
  "label": "Up to 3 Aug 2026 profit is counted on the order date. From 4 Aug 2026, COD and scheduled orders count on the delivery date; other prepaid orders still count on the order date. All days are IST."
},
"provisional": { "fromDate": "2026-07-27", "reason": "last 7 days may still adjust" },
"timezone": "Asia/Kolkata"
```

**UI requirement (data-driven, nothing hardcoded in React):**
- Extend the existing caption at `haper-admin/src/pages/Profits/ProfitPage.tsx:262` (today it reads *"DELIVERED orders only · Past days from snapshots · Today is live"*) to append `attribution.label` and "· times are IST".
- On the custom-range card, show a warning badge when the chosen range **crosses** `cutoverDate` ("this range mixes two counting rules"); same one-line note on week/month/allTime tiles that span it.
- Add `attribution` and `provisional` as **optional** fields to `ProfitData` in `haper-admin/src/pages/Profits/profit.ts:11-19` so old payloads still render.

### 8.8 Blast radius (grepped, complete)

**Backend readers:** `packages/admin/src/routes/analytics/controller.js:297-343` (`GET /admin/analytics/profit`, **the only endpoint**); `packages/admin/__tests__/order-cogs-profit.test.js` (existing suite — calls `getLiveProfit` at `:56`, `:67` and `computeAndSaveSnapshot` at `:75`; **must stay green**); `packages/cron/src/jobs/daily-profit-snapshot.js` (the writer). **Nothing else — no user/delivery/picking/auth consumer.**

**Front end:** `haper-admin/src/pages/Profits/ProfitPage.tsx` (super-admin only, `:193`, `:245`) and `profit.ts` / `profit.test.ts` (pure helpers).

**Numbers that will NOT change but will now legitimately DISAGREE with the profit page — say so in the plan and in the UI copy:** the dashboard order tiles (`packages/shared/repositories/order.repository.js:1196-1226`, CLOSED by `createdAt`); the product COGS report (`:2538-2543`, `successStatuses` + `createdAt`); analytics revenue (`getRevenueMetrics` / `getRevenueTrend`, `createdAt`-based — the ProfitPage caption at `:270-274` already explains that gap and should be **extended, not replaced**).

**Two things that will now AGREE BETTER — worth stating, it supports the decision:** cash reconciliation already keys COD on `deliveredOn` (`packages/shared/repositories/cash-reconciliation.repository.js:40-51`) and rider incentives already use `deliveredOn` for the payout month (`packages/shared/repositories/delivery-incentives.repository.js:29,56`). **So "COD counts on the delivery date" is not a new invention — it makes profit match the money the business already reconciles that way.**

### 8.9 Tests — its OWN file, not folded into the feature's tests

In-memory Mongo only, per package (`cd packages/admin && NODE_ENV=test npx jest`, `cd packages/cron && NODE_ENV=test npx jest`). There is an existing home to model on: `packages/admin/__tests__/order-cogs-profit.test.js` (helpers `closedOrder()`, `line()` at `:20-34`). Add a **dedicated** `packages/admin/__tests__/profit-attribution.test.js` plus job-level cases in `packages/cron/__tests__/`.

**A. Basis**
1. prepaid RAZORPAY, no `deliveryType`, created D delivered D+2 → counts on **D**.
2. COD created D delivered D+2 → counts on **D+2** and NOT on D.
3. **scheduled + RAZORPAY booked D delivered D+3 → counts on D+3 — the feature's regression test; without it the whole feature is invisible.**
4. scheduled + COD → delivery date (proves the OR).
5. legacy COD with `deliveredOn: null` → falls back to `createdAt`, does not vanish (guards the 2,836 real rows).
6. order with `deliveryType` **absent**, read via `.lean()` → treated as `'now'` (**the §15 trap, third occurrence**).
7. non-CLOSED never counted: OPEN, UN_DELIVERED, ADMIN_CANCELED, REFUND_SUCCESS.
8. live/snapshot agreement: a COD order delivered today is in the today tile, then in that day's snapshot after roll-over — **never both, never neither**.

**B. Re-runnability**
9. run twice → one row, identical numbers.
10. compute D, close another order attributed to D, re-run → same row, counts go **UP**.
11. move an order out of CLOSED → re-run → row goes **DOWN**.
12. **compute D with one order, refund it so D is empty, re-run → the row is removed/zeroed, not left stale. THIS CASE FAILS ON TODAY'S CODE (`:262`).**
13. two stores, B's orders all refunded → B cleaned, A untouched.
14. key stability: compute the same IST day from a 23:00 IST Date and a 00:30 IST Date → **still one row**.
15. IST boundary: `deliveredOn = 2026-08-04T18:29:00Z` → 4 Aug; `...T18:31:00Z` → 5 Aug.

**C. Cutover**
16. a pre-cutover day computes on the OLD basis, **byte-identical** to today's output.
17. the window never touches a pre-cutover day — assert **no write at all**.
18. a cross-seam order appears in **exactly one** snapshot row across the whole collection.
19. `GET /admin/analytics/profit` returns `attribution.*` and existing fields are unchanged (response-shape backward compat).

**D. Job**
20. `windowDays=7` writes D−7…D−1 and **never today**.
21. three missed nights → one run backfills all three.
22. `allTime` regression: with a today-dated row deliberately present, the tile must **not** double-count.

**E. Test guide — its own file.** `haper-misc/test-profit-snapshot.md`, separate from the feature guide **because the fix is independently revertable**: place a COD order, close it the next day, check yesterday's tile before and after the 01:00 run, check the cutover label renders, check a range crossing the cutover shows the warning. ✅/❌ steps + *"deploy needed: backend + admin"*.

### 8.10 Sizing and why it is its own slice

**Medium.** One shared attribution expression · edits to three functions in `profit-snapshot.repository.js` · one cron job rewritten as a loop · one constant · ~4 additive response fields · one caption + one badge in the admin UI · one index for aabha-dba · ~22 tests · one test guide · optionally 5 lines in `orders.schema.js`.
**No migration, no data backfill, no schema change to `profit_snapshots`, no change to `orders.items.costPrice`.**

**It fits inside phase 1 but only as its own commits and its own test file**, because:
- it changes numbers on a **live super-admin report**, so it must be revertable **alone** without unwinding the feature;
- three of its four parts (re-runnability, the stale-row bug, the `allTime` double-count) have **nothing to do with scheduled delivery** and are needed regardless;
- the scheduled-delivery-specific part is literally **one clause** in one expression, which can land dark **before** the feature exists, because with scheduling off no order carries the field.

**Order: land the profit fix as commit 1 of phase 1, with the cutover set to the day it actually deploys, then build the feature on top.**

> 🔴 **A DECISION FOR THE USER (§12 Q1), do not decide it silently:** pre-cutover days stay under-counted **forever** (≥67 orders / ₹9,665 revenue / ₹1,158 profit over the 9 cron days as of the 14 July dump, more since). Filling that hole is a **one-off backfill under the OLD basis (`createdAt`) for pre-cutover days only** — it changes no definitions but does move already-reported numbers **upward**. Explicit yes/no required.

---

## 9. Admin & store-admin work (spec §11) — NOW THE BIGGER HALF

Chanchal's design is the binding spec for this section. Reuse is by existing path — **almost nothing here is a new pattern.**

### 9.1 What is reused (do not invent new patterns)

- Tab strip: `haper-admin/src/pages/StockAlerts/StockAlertsDashboard.tsx:147-162, 437-444` — **the only tab pattern in the app**.
- Table row idiom `thStyle` / `tdStyle`: `OrdersList.tsx:520-529`.
- Status pill colours: `src/utils/orders.ts:140` — **UNCHANGED**. The scheduled chip sits **beside** the status pill, never replaces it.
- Pill recipe (dot + WORD + tint, **never colour alone**): `src/components/common/MaintenanceBadge.tsx`.
- Stat cards: `OrdersList.tsx:165-178`, `OrderBoard.tsx:913`. Amber info-strip structure: `OrderBoard.tsx:322-343`.
- Settings page shell `.cfg-page` / `.cfg-group` / `.cfg-card` / `Field` / `SaveBar` / `CardSkeleton`: `src/pages/Config/ConfigSettings.tsx:633-720, 729-941`. Plus `Switch`, `ConfirmDialog`, `InfoTooltip`, `toastStore`.
- Weekday `DAYS` const + 60px label grid: `StoreModal.tsx:22-24, 565-573`.
- Nav: `src/hooks/useMenu.ts:81-90` (Sales & Orders) and `:142-151` (Settings).
- **The existing `?orderId=` deep-link mechanism at `OrdersList.tsx:61-80` — both new notifications reuse it, so NO new deep-link plumbing.**

**Only two new design tokens**, justified because amber/indigo/green/red are all already semantically claimed on order surfaces and the admin has no themed warning hue: `--scheduled-fg` (`#38bdf8` dark, `#0369a1` light) + `--scheduled-bg`. Contrast verified 7.4:1 and 6.4:1 — both AA.

### 9.2 Binding design decisions

1. **Badge.** Sits **inside the existing Status cell** as a second line under the untouched status pill, so *"OPEN + SCHEDULED 4 Aug, 12–2 PM"* reads as one sentence. **A normal row renders ZERO extra DOM.** Below 1024px the chip drops to just `SCHEDULED` (the full slot is still in the Date cell). **After release the chip goes quiet** (transparent, bordered, secondary text) and reads `Slot 12–2 PM today` — the slot stays visible for the order's whole life.
2. **Tabs** sit **above** the filter block. **RECOMMENDATION: render the tab strip only if `schedulingEnabled === true || scheduledCount > 0`** — so with scheduling off (every store today) the Live tab is not merely *indistinguishable* from today's list, **it IS today's list**. That makes the §15 backward-compat guarantee **structural rather than cosmetic.** The Scheduled tab groups by date with sticky group headers, sorted nearest-date-first then slot-start then `createdAt`; the sort dropdown is hidden and replaced by static `Sorted by slot time`; the two date inputs filter on **slot date** and are relabelled `Slot from` / `Slot to`.
3. **Inverted timer** — five phases with exact strings (booked far out / releasing soon / released & live / release overdue / slot missed).
   **The red rule, explicitly: a scheduled row may turn red on exactly two conditions — release more than 15 minutes late, or the slot window ended undelivered. NEVER on age.**
   > 🚨 **Once released, age is measured from `releasedAt`, not `createdAt`, EVERYWHERE (list, board, SLA).** Miss this and a released 5-day-old booking shows "5d" and goes red the instant it becomes normal. **Chanchal flags this as the single easiest thing to get wrong in the feature.**
   Countdown ticks client-side **every 30s**, not every second.
4. **Ops board.** Un-released scheduled orders excluded from the buckets **AND** from `totals.breach/warn/ok` **AND** from the 48h stale-orders banner. A new **calm sky-coloured** strip: *"12 orders are waiting for their delivery slot. Next release 8:00 AM (2 orders)."* linking to `/orders?tab=scheduled`. A `Waiting for slot` StatBox **only when count > 0**. Released scheduled orders sit in their normal bucket with SLA measured from `releasedAt`.
5. **Dashboard: do BOTH** — exclude un-released scheduled orders from every "needs attention" figure (including the `ongoing` tally at `OrdersList.tsx:88` and the funnel `placed` bucket), **AND** add a separate `Scheduled ahead` tile that renders **only when `schedulingEnabled || count > 0`**, so today's dashboard is **byte-identical**. Loading shows a **skeleton, never `0`** (which reads as real); on error the tile is **hidden** rather than showing a wrong number.
6. **Two notifications with DISTINCT collapse tags** — `sched-book-<orderId>` and `sched-release-<orderId>`. *Same-tag pushes collapse on Android, and the release alert — the one that means ACT — would silently replace the booking one.* Booking push deep-links to `/orders?tab=scheduled&orderId=…`, release push to `/orders?orderId=…`. Plus a third, cheap one: a **"held on delivery day"** push for the maintenance case (§3.9).
7. **Day view** at `/orders/day`, nav item `Day Plan`, shown only when the store has scheduling on. Slot-group cards with a capacity bar that **always shows the literal `11 / 15 booked` text, never bar-only**, `role="progressbar"`. Date bar with Today/Tomorrow buttons **carrying their counts** so both loads are visible without switching. Default = **Today** (RECOMMENDATION — spec §11.6 says "tomorrow's", so **confirm**). `?date=` in the URL. Past slots collapsed with `Done · 6 delivered`. Refresh via the existing `useOrderEvents` SSE hook with the same **800ms debounce** as `OrdersList.tsx:142-146` — **not 30s polling**.
8. **Slot-settings page** at `/slot-settings` under Settings, gated on `STORE_CONFIG.VIEW` / `EDIT`.
   **Deviation from ConfigSettings, stated and justified: ONE sticky page-level save bar, not per-card saves** — slot length, the weekday grid and store hours are interdependent, and per-card saving would let a manager save a grid that contradicts an unsaved slot length. Eight plain-language sections.
   **The weekday grid:** rows = weekdays **with the store's own hours printed next to each day name** (which is what makes greyed cells self-explanatory); columns = slots generated from slot length; cells = toggle chips **with a check mark** so on/off is never colour-only; closed cells hatched and not tickable; per-row All/None; per-column toggle; a **`Copy Monday to all days`** action (the biggest time-saver); and **a plain-English summary line under the grid — `Mon–Sat: 9–11 AM, 12–2 PM, 4–6 PM · Sun: 9–11 AM` — which is the verification step that removes the need for a manual.**
   Below 900px it becomes a **7-row accordion**; **never horizontally scroll a matrix on a phone.**
   Validation: scheduling ON with **zero ticked slots blocks save**.

**Accessibility requirements (part of done):** `role="tablist"/"tab"`, `aria-selected`, arrow-key navigation and roving tabIndex (**the StockAlerts original lacks this — add it here**); every chip is icon/dot **+ word**, never colour alone; ≥44×44 touch targets on ≤768px; countdown lines that change **meaning** live in `aria-live="polite"` while the ticking text itself does not; visible focus rings (current inputs set `outline:none` with no replacement — **fix on any control this feature touches**); `prefers-reduced-motion` on the shimmer.

### 9.3 The 16 backend data requirements — THIS IS THE BACKEND WORK SPLIT

**Per order (list + board + detail), all nullable/defaulted**
1. `deliveryType` — **emitted on every order**; serialize `'now'` **explicitly** rather than letting `.lean()` leave it `undefined`.
2. `slot.start`, `slot.end`.
3. `releaseAt`, `releasedAt` — drives both the chip variant **and** the re-anchored age.

**Orders list `GET /admin/order/order-list`**
4. New param `deliveryView=live|scheduled|all` with **server default `all`** for backward compatibility. The admin sends `live`/`scheduled` explicitly. `live` = today's list **minus** `deliveryType==='scheduled' && releasedAt == null`.
5. `scheduledCount` — total un-released scheduled orders for the store scope, **ignoring the page's filters**, on every response. (It answers *"is there anything waiting?"*, not *"how many match my filter?"*)
6. `schedulingEnabled` from `store.config` — decides whether the tab strip renders at all. *(Or the admin reads it from the store object it already holds — confirm which is cheaper.)*
7. With `deliveryView=scheduled`, `fromDate`/`toDate` filter on **slot start**, not `createdAt`; default sort slot-start ascending.
8. Aggregates for group headers and summary cards: per-date `count` + `sum(totalAmount)` plus `nextRelease: {at, count}`. **Computing these client-side is wrong — the list is paginated at 20.**

**Ops board `GET /admin/order/board/live`**
9. Exclude un-released scheduled orders from `buckets`, `totals` **AND** the `staleCount` calculation.
10. New `scheduledWaiting: {count, nextReleaseAt, nextReleaseCount}`.
11. For **released** scheduled orders, `sla.ageMinutes` computed from `releasedAt`, not `createdAt`.

**Dashboard**
12. New `scheduledUpcoming: {count, value, nextSlotStart}`, and the existing open/ongoing/funnel-placed figures must exclude un-released scheduled orders.

**Day view — new endpoint `GET /admin/order/scheduled/day?date=YYYY-MM-DD&storeId=`**
13. Returns `slots: [{start, end, capacity, booked, releaseAt, released, orders: [{_id, orderId, customerName, area, itemCount, totalAmount, paymentMethod, paymentStatus, status, releasedAt}]}]` plus `day: {orderCount, value, slotCount, busiestSlot}` plus `isBlackout`, `schedulingEnabled`.
14. Counts for the Today/Tomorrow buttons.

**Slot settings — new CRUD**
15. `GET` / `PUT /admin/store/:id/slot-config` returning the whole scheduling block **plus the store's `time` (opening hours per weekday)** so the grid can grey out closed cells **without a second call**. **The 7-day ceiling and the "slot inside opening hours" rule must be enforced server-side, not only in the form.**

**Notifications**
16. Two distinct pushes with **distinct collapse tags** and `data.orderId` + `data.tab`.

---

## 10. Backward compatibility (spec §15) — HARD REQUIREMENT

**Nothing in this feature may change existing behaviour.** User-stated, and the project rule.

**THE STRUCTURAL GUARANTEE: scheduling is OFF by default for every store**, so with it off **no scheduled order can exist and every change here is a no-op on live data.** No migration, no backfill. Enable one store at a time.

| Rule | Why | How it is enforced here |
| --- | --- | --- |
| New order fields nullable/defaulted, never required | Old Android builds decode a missing key to `null`, not the Kotlin default | §4.1; every client field declared `String? = null` / `decodeIfPresent` |
| **No new order status code** | Old builds map an unknown status to "Failed" and drop it from tracking. **The single most important constraint in the feature** | Scheduled orders stay at `OPEN`. No enum change anywhere |
| **Every consumer must default `deliveryType`** | Old orders have no such field, and **`.lean()` does NOT apply schema defaults — reads return `undefined`, not `"now"`.** The same trap is already documented in the store schema for `maintenance` (`stores.schema.js:112-116`) and `giftWithPurchaseEnabled` (`:122-128`). **This would be the THIRD time.** | One resolver util for store scheduling config (§4.4). For orders: **serialize `deliveryType` explicitly on every response** (requirement 1 in §9.3) and use `{$ifNull: ['$deliveryType','now']}` in every aggregation (§8.4) |
| **Guards fail TOWARDS today's behaviour** | *A scheduled order picked early is a bad day; a normal order never picked is a lost customer.* | The pick-task guard skips **only** when it can positively see `deliveryType === 'scheduled' && !releasedAt`; anything ambiguous creates the task. Same rule for the batch-expiry check: `expiresAt == null` means *unknown → do not flag*, not *flag everything* |
| No response shape, field name or enum changes | Android, iOS, web, picker and delivery all decode existing payloads unchanged | Everything additive; `deliveryView` defaults to `all`; `attribution`/`provisional` are optional fields |
| `expectedDelivery` stays untouched | Writing the slot into it would mark every on-time scheduled delivery **late** on the KPI | Review gate: `expectedDelivery` must not appear in the diff |
| Admin list/dashboard filters are additive | With no scheduled orders in existence, the Live tab returns exactly what the order list returns today | Tab strip **not rendered** when `schedulingEnabled === false && scheduledCount === 0` (§9.2.2) — the guarantee is structural, not cosmetic |

### The ONE deliberate exception

**Moving profit to the day of delivery (§8) is not backward compatible** — it changes what past numbers mean. **Resolution: apply the new basis from a cutover date forward; do not recompute history.** Every number already seen stays as it was. The cost is a seam in the reports, which must be **labelled in the admin UI, not switched silently** (§8.7).

---

## 11. Phased plan

Launching at **7 days**, **prepaid only**, **delivery only**. Legend: 🟦 backend · 🟪 admin · 🌐 web · 🤖 Android · 🍎 iOS · 🛵 delivery · 📦 picker.

**Per-app split at a glance**

| App | Weight | Work |
| --- | --- | --- |
| 🟦 backend | **Heavy** | profit fix · schema + indexes · scheduling config + resolver · slot generation + capacity counter · booking branch · change/cancel · release cron · capacity-reconcile cron · pick-task guard · the 16 admin data requirements · notifications |
| 🟪 admin | **Heavy — now the bigger half** | dedicated slot-settings page · Live/Scheduled tabs · badge + inverted timer · ops board · dashboard tile · day view · profit page caption + seam badge |
| 🌐 web | Medium | checkout card, slot picker, order screen, `isCancellable` fix |
| 🤖 Android | Medium | same, plus the `isCancellable` branch and countdown suppression |
| 🍎 iOS | Medium | same; the decoder is the risk |
| 🛵 delivery | Tiny | one slot chip on the rider card |
| 📦 picker | **ZERO** | a released order looks completely normal. Confirmed by search — `haper-picker/.../data/model/Models.kt` models a **pick task**, not an order |

---

### PHASE 0 — the no-op guards. **Much smaller than revision 1.**

**Why it is safe:** nothing yet can create a scheduled order, and every guard tests for a positive `deliveryType === 'scheduled'`, so **every existing order and every existing path behaves exactly as today.**

**Depends on:** nothing. **Blocks:** everything.

| # | Task | Files |
| --- | --- | --- |
| 0.1 | New order fields (§4.1, **including `batchAllocations[].expiresAt`**) + the two partial indexes (§4.2) | `packages/shared/models/orders.schema.js` |
| 0.2 | **Pick-task choke-point guard** + **the `.select()` fix at line 138** (verified line number) | `packages/shared/utils/pick-task.utils.js:132`, `:138` |
| 0.3 | Reconcile cron: the `$or` exclusion **and** the `releasedAt` window (both halves of §3.4) | `packages/cron/src/jobs/pick-task-reconcile.js:46`, `:130` |
| 0.4 | `assignDeliveryBoy` + `reassignDeliveryBoy` filters for un-released scheduled | `packages/admin/src/routes/order/controller.js:1024`, `:1091` |
| 0.5 | Persist `expiresAt` through `sellFEFO` into `batchAllocations` at checkout (additive; §7.3 step 1) | `packages/shared/repositories/item.repository.js:954-958` · `packages/user/src/routes/order/controller.js:130-139` |
| 0.6 | Create both test-guide skeletons | **new** `haper-misc/test-scheduled-delivery.md` · **new** `haper-misc/test-profit-snapshot.md` |

**Verified by:** `cd packages/<pkg> && NODE_ENV=test npx jest` for **shared, user, admin, cron, picking**. **Every existing test must stay green with no edits.** New unit test: `ensurePickTaskForOrder` returns `null` for `{deliveryType:'scheduled', releasedAt:null}`, creates a task once `releasedAt` is set, **and creates a task for an order with no `deliveryType` field at all** (the fail-towards-today rule). Plus a test asserting `deliveryType` and `releasedAt` are actually present on the projected document — **that is the one that catches the `.select()` omission.** `explain()` on **DEV** proving the release query uses `sched_release_queue` (IXSCAN, not COLLSCAN).

**Rollback:** every item independently revertible.

---

### PHASE 1 — the feature end-to-end. 🟦 backend + 🟪 admin (settings + list + board + dashboard + day view) + 🌐 web

**Depends on:** Phase 0 deployed.
🔴 **MUST DEPLOY TOGETHER: backend + admin slot-settings page.** Without it **nobody can turn the feature on for a store.** Web can lag by hours, not by a release.

#### 1A — The profit-snapshot fix. **COMMIT 1. Its own commits, its own test file. Lands dark.**
| # | Task | Files |
| --- | --- | --- |
| 1A.1 | `PROFIT_ATTRIBUTION_CUTOVER` constant, set to the actual deploy date (§8.7) | `packages/shared/constants/` or next to the profit repo |
| 1A.2 | **One shared attribution expression**, used by BOTH `computeAndSaveSnapshot` and `getLiveProfit` (§8.4, hazard 5) | `packages/shared/repositories/profit-snapshot.repository.js:97-101`, `:242-260` |
| 1A.3 | **Delete-and-rebuild the day, per store** (hazard 2) + `getSnapshotSum` clamped to `yesterdayEnd` at `:191` (hazard 1) | same file `:191`, `:262-280` |
| 1A.4 | Nightly job becomes a **7-day rolling loop**, lower bound `max(today−7, CUTOVER)`, never today (§8.5, hazard 4) | `packages/cron/src/jobs/daily-profit-snapshot.js` |
| 1A.5 | Super-admin `POST /admin/analytics/profit/recompute?date=YYYYMMDD`, clamped | `packages/admin/src/routes/analytics/{router,controller}.js` |
| 1A.6 | `attribution` / `provisional` / `timezone` on `GET /admin/analytics/profit` (additive) | `packages/admin/src/routes/analytics/controller.js:297-343`, `res.json` at `:315-322` |
| 1A.7 | Fix the wrong comment at `profit-snapshots.schema.js:9` (`// midnight UTC` → **IST**) | `packages/shared/models/profit-snapshots.schema.js:9` |
| 1A.8 | 🟪 ProfitPage caption extension + cross-seam warning badge + optional `ProfitData` fields | `haper-admin/src/pages/Profits/ProfitPage.tsx:262`, `:270-274` · `profit.ts:11-19` |
| 1A.9 | 🗄️ **Index `{status:1, deliveredOn:-1}` cross-store** — route to aabha-dba | `packages/shared/models/orders.schema.js` |
| 1A.10 | **Dedicated** test file + job tests (§8.9, ~22 cases) | **new** `packages/admin/__tests__/profit-attribution.test.js` · `packages/cron/__tests__/` |
| 1A.11 | Fill in `haper-misc/test-profit-snapshot.md` | misc |
| 1A.12 | *(optional, needs Q2)* `deliveredOn` re-stamp hardening | `packages/shared/models/orders.schema.js:294-306` |

#### 1B — Backend feature
| # | Task | Files |
| --- | --- | --- |
| 1B.1 | `store.config.scheduling` schema + validator with server-side clamps (**`maxDaysAhead ≤ 7`**, `maxOrdersPerSlot ≤ 200`, blackout cap ~60 + past-date prune) | `packages/shared/models/stores.schema.js` |
| 1B.2 | **The scheduling settings RESOLVER util** (the `.lean()` trap). Every consumer calls it; nothing reads `store.config.scheduling.*` directly | **new** `packages/shared/utils/scheduling.utils.js` |
| 1B.3 | **The canonical `buildSlot(store, dateStr, slotKey)` util** + slot generation (weekday config × opening hours × blackout × lead time). **`moment.tz` only — do NOT copy `store/controller.js:16-18`** | same file |
| 1B.4 | `slot_capacity` model + 3 indexes + `claimSeat` / **`releaseSlotClaim`** repository | **new** `packages/shared/models/slot-capacity.schema.js` · **new** `packages/shared/repositories/slot-capacity.repository.js` |
| 1B.5 | `GET /user/order/slots` | `packages/user/src/routes/order/{router,controller,validator}.js` |
| 1B.6 | Booking: scheduled branch in `placeOrder` — **wrapped in `session.withTransaction`**, pre-generated order `_id`, seat claim inside the transaction, `slot`/`releaseAt`, **normal `sellFEFO` exactly as today**, 422 + `code` on rejection | `packages/user/src/routes/order/controller.js:162-341` |
| 1B.7 | **`releaseSlotClaim` wired into ALL SEVEN lifecycle points** (§5.2), **including the abandonment cron — the new break** | `order/controller.js` (`:360-412`, `:622-742`) · `razorpay/controller.js:168-190` · `admin/order/controller.js:894-914` · **`cron/jobs/payment-initiated-orders.js:65-78`** |
| 1B.8 | Cancel: branch the 60-second window on `deliveryType`; enforce slot − 8h + not-released | `packages/user/src/routes/order/controller.js:651-653` |
| 1B.9 | `PATCH /user/order/:id/slot` — the **predicate-guarded** single update, claim-new-then-release-old, **`releaseAt` recomputed in the same transaction** | `packages/user/src/routes/order/{router,controller,validator}.js` |
| 1B.10 | **The release cron** — CAS claim, maintenance re-check, slot-expired terminal path, **batch-expiry DETECTION (§7.3)**, `{readPreference:'primary'}`, `.limit(50)` sorted by `releaseAt`, post-commit pick task + notifications. **No stock movement.** | **new** `packages/cron/src/jobs/scheduled-release.js` + `packages/cron/src/scheduler.js` |
| 1B.11 | `slot-capacity-reconcile` cron, every 10 min, both directions, **every repair logged at ERROR** | **new** `packages/cron/src/jobs/slot-capacity-reconcile.js` + scheduler |
| 1B.12 | Late-webhook rule (§3.11) | `packages/user/src/routes/razorpay/controller.js:54-109` |
| 1B.13 | **The 16 admin data requirements** (§9.3) — order list `deliveryView` + `scheduledCount` + aggregates; board exclusions + `scheduledWaiting` + `releasedAt`-anchored SLA; dashboard `scheduledUpcoming` + exclusions; **new day endpoint**; **slot-config CRUD** | `packages/admin/src/routes/order/controller.js:85-115`, `:1024`, `:1091`, `:1258-1287` · `packages/shared/repositories/order.repository.js:1197, 1200, 1209, 1220, 1225` · `packages/admin/src/routes/store/*` |
| 1B.14 | Account-deletion **message** names the scheduled order + slot + cancel path (**rule unchanged**) | `packages/user/src/routes/profile/controller.js:14-21` |
| 1B.15 | Notifications: **two admin pushes with distinct collapse tags** + the maintenance-hold push + **the two customer reminders (evening before, one hour before)** — **all net-new; release is OPEN→OPEN so `order-status-changed` never fires** | `packages/shared/constants/notification.constant.js` + a new reminder cron + the release job |

#### 1C — Admin front end (the bigger half)
| # | Task | Files |
| --- | --- | --- |
| 1C.1 | 🟪 **Dedicated slot-settings page** `/slot-settings` — 8 sections, weekday grid, **one sticky page-level save bar**, plain-English summary line, mobile accordion, validation | **new** `haper-admin/src/pages/SlotSettings/*` · `src/hooks/useMenu.ts:142-151` |
| 1C.2 | 🟪 Live/Scheduled tabs (rendered only when `schedulingEnabled \|\| scheduledCount > 0`), date grouping, relabelled date filters | `haper-admin/src/pages/Orders/OrdersList.tsx` (tab pattern from `StockAlertsDashboard.tsx:147-162`) |
| 1C.3 | 🟪 Scheduled chip inside the Status cell + **inverted timer with the two-condition red rule** + **age re-anchored on `releasedAt`** | `OrdersList.tsx`, `src/utils/orders.ts` (colours **unchanged**) |
| 1C.4 | 🟪 Ops board: exclusions, calm sky strip, `Waiting for slot` StatBox, `releasedAt`-based SLA | `haper-admin/src/pages/Orders/OrderBoard.tsx:316`, `:322-343` |
| 1C.5 | 🟪 Dashboard: exclusions **and** the `Scheduled ahead` tile (skeleton on load, hidden on error) | `haper-admin/src/pages/Dashboard.tsx:105-114` · `OrdersList.tsx:88` |
| 1C.6 | 🟪 **Day view** `/orders/day` — slot cards, capacity bar with literal text, Today/Tomorrow with counts, `?date=`, SSE refresh with the existing 800ms debounce | **new** `haper-admin/src/pages/Orders/OrderDay.tsx` · `useMenu.ts:81-90` |
| 1C.7 | 🟪 Two new design tokens + accessibility pass (roving tabIndex, focus rings, `aria-live`, `prefers-reduced-motion`) | admin theme + touched components |

#### 1D — Web
| # | Task | Files |
| --- | --- | --- |
| 1D.1 | 🌐 DELIVERY TIME card (two-row radio list, expands in place), date strip, slot list, payload fields | `haper-web/pages/Checkout.tsx` (next to the existing `deliveryMode` toggle at `:361-373`; payload at `:234`) |
| 1D.2 | 🌐 API + types | `haper-web/services/api.ts` (`getSlots`, `changeSlot`, near `:458`) · `haper-web/types.ts` (`Order` `:378`, `PlaceOrderRequest` `:411`) |
| 1D.3 | 🌐 Order screen slot card + **`isCancellable` fix at `OrderDetail.tsx:142`** (respect `scheduleActions.canCancelNow`) + change-slot route | `haper-web/pages/OrderDetail.tsx` · optional banner `OrderTracking.tsx:127` |
| 1D.4 | Fill in `haper-misc/test-scheduled-delivery.md` end-to-end | misc |

**Verified by:** backend jest per package (in-memory Mongo only) · admin `npx vitest` — green means **still exactly the 5 known-failing OrderDetailsModal tests, not zero** — plus eslint **no worse than the 113-problem baseline** · web `tsc --noEmit` + `vite build` (**eslint is not usable in haper-web**).

**Ship gate:** ship web, **watch ONE real store book ONE real slot, THEN freeze the API contract.** Web goes first because it has the fewest users, no app-store review, no old builds in the wild, and `tsc`-only verification.

---

### PHASE 2 — 🤖 Android

**Depends on:** Phase 1 shipped **and the contract frozen** after the real-slot smoke test.

| # | Task | Files |
| --- | --- | --- |
| 2.1 | **Extract a new `ScheduleSlotPicker` composable into its own file** — `CheckoutScreen.kt` is **802 lines and one flat `@Composable`** | **new** `haper-android/.../ui/screens/checkout/ScheduleSlotPicker.kt` |
| 2.2 | Wire it into checkout | `.../ui/screens/checkout/CheckoutScreen.kt` (call site `:202`) |
| 2.3 | `placeOrder(...)` gains two params **with defaults** (`deliveryType: String? = null, slotId: String? = null`) **so `OrderViewModelTest.kt` keeps compiling** | `.../orders/OrderViewModel.kt:149` |
| 2.4 | New **nullable** fields + `PlaceOrderRequest` extension | `.../data/model/OrderModels.kt:49` |
| 2.5 | 🚨 **`isCancellable` — the risky bit.** Two rules now live in one property. **Keep the branch EXPLICIT** (`if (deliveryType == "scheduled") … else …`) or a normal order inherits a scheduled cancel window | `.../data/model/OrderModels.kt:154` |
| 2.6 | Suppress the 60-second free-cancel countdown for scheduled | `.../orders/OrderDetailScreen.kt` (`CancelOrderWithCountdown` ~`:965`) |
| 2.7 | Order screen slot card, orders-list chip, make `OrderSuccessScreen.kt:87` conditional | `OrderDetailScreen.kt`, `OrdersScreen.kt`, `OrderSuccessScreen.kt` |
| 2.8 | API service + **extend the EXISTING `ApiContractTest.kt`, don't bypass it** | `.../data/api/ApiService.kt`, `.../data/api/ApiContractTest.kt` |

**Verified by:** `./gradlew assembleDebug` + the existing unit tests.

---

### PHASE 3 — 🍎 iOS + 🛵 rider chip

**Depends on:** Phase 1 (contract). Independent of Phase 2. **Can safely lag** — iOS has no production build yet (per the comment at `packages/user/src/routes/order/controller.js:23`).

| # | Task | Files |
| --- | --- | --- |
| 3.1 | 🍎 **THE DANGEROUS FILE.** New fields go in `CodingKeys` **AND** use `decodeIfPresent` | `haper-ios/haper/Models/OrderModels.swift` (`Order.init(from:)` `:81`, `CodingKeys` `:126`) |
| 3.2 | 🍎 **The regression test that matters:** a fixture for a scheduled order **AND** a fixture for a PRE-FEATURE order, asserting **both** decode | `haper-ios/haperTests/Fixtures` |
| 3.3 | 🍎 Delivery-time section between Address (`:59`) and Wallet (`:115`) | `haper-ios/haper/Views/CheckoutView.swift` |
| 3.4 | 🍎 ViewModel + order screen + suppress the 60-second countdown | `ViewModels/OrderViewModel.swift:149`, body dict `:160` · `Views/OrderDetailView.swift` · `Models/OrderModels.swift:155` |
| 3.5 | 🛵 One slot chip on the rider card. **Ask the backend for a pre-formatted `slotLabel`** — the rider app should not own slot formatting for one chip | `haper-delivery/.../ui/components/DeliveryOrderCard.kt:92` · `OrderModels.kt:66` (one nullable field) |

---

### PHASE 4 — Deferred

- **Batch re-allocation at release (§7.4)** — gated behind the costPrice decision.
- **COD switch-on.**
- **"Items to reserve" per-day roll-up** on the day view (Chanchal C-OPEN b) — needs a new aggregation.
- **"Committed for future slots" per item** next to on-hand stock, then (only much later) wired into `getLowStockItems` — that function drives automatic purchase requests and a wrong number there **spends real money**.
- Per-day capacity cap (as opposed to per-slot).
- Real-money refunds to source (Razorpay refund API).
- A one-off **pre-cutover profit backfill** if the user says yes (Q1).

---

## 12. Regression risk list

**The order checkout path is the single most critical path in the product.** Every row is a thing that works today and must keep working unchanged.

| # | What could break | How it breaks, concretely | The guard | How the guard is verified |
| --- | --- | --- | --- | --- |
| 1 | **The checkout path itself** (`placeOrder`, `packages/user/src/routes/order/controller.js:162-341`) | The scheduled branch adds a shared document to a **manual** transaction that does not retry → two customers booking the same slot within ~100 ms cause a WriteConflict and **a normal customer's checkout errors out** | Wrap **only the scheduled branch** in `session.withTransaction`. The "now" path keeps its manual `startTransaction` at `:164` / `commitTransaction` at `:340` **byte-for-byte**. `deliveryType` is optional and defaults to `"now"`, so an old build's request is **byte-identical** and takes no new branch | `cd packages/user && NODE_ENV=test npx jest` — **every existing checkout test passes with no edits.** Add a concurrency test: two simultaneous claims on a cap-1 slot → exactly one 201, one 422 |
| 2 | 🆕 **Orphaned slot-capacity claims → a slot permanently "Full" with ZERO real orders** | `payment-initiated-orders.js:65-78` writes PAYMENT_CANCELLED and nothing else. 15 abandoned payment sheets and the 12–2 PM slot is dead forever | One shared `releaseSlotClaim(order, session)` called from **all seven** exit points (§5.2), **including the abandonment cron and the `payment.failed` restock block** | Integration per lifecycle row. Plus `slot-capacity-reconcile` **logging every repair at ERROR** — a repair firing in normal operation is a bug report, not housekeeping |
| 3 | 🆕 **Held stock diverges from the physical shelf → a store admin "finds" phantom stock and stocks it in, so the same units get sold twice** | System says 7, shelf has 12 (5 booked for Thursday). Today that gap lasts minutes; now it lasts days | The §11.6 **day view is the mitigation and is load-bearing** — "committed for future slots: 5" must be visible next to on-hand. Documented prominently in the test guide as an **operational** risk | Manual walkthrough in `test-scheduled-delivery.md`: book 5 units for Thursday, confirm the day view names them, confirm the store admin is told **not** to stock-in a correction |
| 4 | 🆕 **The picker is asked to pick an expired lot** | `stockOutFEFO` (`store-batch.repository.js:161-189`) takes soonest-expiry first **and does not even skip already-expired lots**. A booking made today can be allocated a lot that expires before its slot | **Phase 1 = DETECT AND FLAG** (§7.3): persist `expiresAt` on `batchAllocations`, compare to the slot start at release, create the pick task **and** raise an admin alert + picker note. **No re-allocation, no cost change** | Unit: allocation expiring before the slot → task created **and** alert raised. Legacy allocation with `expiresAt: null` → **no flag**, task created (fail-towards-today) |
| 5 | **Picker queue flooding + a warning every 60 seconds per order** | `pick-task-reconcile` (every 60 s, `scheduler.js:17`) backfills a task for an un-released order, then re-warns at `:76` once a minute for up to 7 days | Choke-point guard in `ensurePickTaskForOrder` (`pick-task.utils.js:132`) **+ the `.select()` fix at `:138`** + the `$or` cron predicate | Unit: returns `null` for `{deliveryType:'scheduled', releasedAt:null}`; **creates a task once `releasedAt` is set**; **creates a task for an order with no `deliveryType` at all**. Plus a test asserting the projected document actually contains `deliveryType`/`releasedAt` — **the one that catches the `.select()` omission** |
| 6 | **A released order loses its safety net and is NEVER delivered** | `pick-task-reconcile` windows on `createdAt − 7 days` (`:130`). A booking at the edge of the 7-day ceiling is on the boundary on release day; the post-commit `ensurePickTaskForOrder` is fire-and-forget with swallowed errors → **no task, ever** | The `$or` window: scheduled orders windowed on `releasedAt` | Integration: order with `createdAt` 7 days ago, `releasedAt` = now, no task → the cron creates one |
| 7 | **Over-booked slots** | Count-then-insert cannot be made safe in MongoDB (no predicate/gap locks) — both readers see 14, both insert, both commit, no conflict. Real count 16 | `$addToSet` guarded on `orderIds.{cap-1}: {$exists:false}` **evaluated under the document write lock**, inside the order transaction. Unique index `slot_identity` makes two docs for one slot impossible | Concurrency test at cap 1. Plus a unit test that the **identity key is the string pair**, never a Date |
| 8 | 🆕 **A released 5-day-old booking instantly shows "5d" and goes red the moment it becomes normal** | Age is measured from `createdAt` everywhere in the admin | **Once released, age is measured from `releasedAt` — list, board AND SLA.** Chanchal names this *the single easiest thing to get wrong* | Unit on the SLA helper with a released scheduled fixture: `ageMinutes` must be ~0 at `releasedAt` |
| 9 | **Every scheduled order is a red "SLA breach" from minute 7** | `admin/order/controller.js:85-115` — `OPEN:{warn:3,breach:6}` **MINUTES**, `now − createdAt` at `:101-103`; inflates `totals.breach` (`OrderBoard.tsx:316`) | `sla: null` (or a `scheduled` flag) for un-released | Unit on the SLA helper with an un-released scheduled fixture |
| 10 | **The ops board hides a booking on the very day it must be picked** | `STALE_CUTOFF_HOURS = 48` at `:1258-1272`, pure `createdAt` — a booking made >48h ahead is **removed from the board** exactly when it needs picking, and also triggers *"N stale orders… Clean them up"* (`OrderBoard.tsx:322-339`) | Exclude un-released scheduled from **both** `matchBase` (`:1261`) and `staleCountMatch` (`:1278`); add back at `releasedAt`; anchor staleness on `releasedAt` | Admin vitest; manual check on the board with a seeded scheduled order. **⚠️ If this is deferred, the new sky-coloured board strip is WRONG on day one** — see Q9 |
| 11 | **Dashboard shows phantom "unattended" orders** | `order.repository.js:1197` `countDocuments({status:OPEN})` has **no date bound**; rendered at `Dashboard.tsx:105-114`; mirrored client-side at `OrdersList.tsx:88` | `$or` exclusion + a separate `scheduledUpcoming` figure; mirror on the FE | Repository unit tests; admin vitest |
| 12 | **Analytics silently drop every pre-existing order** | Writing `{deliveryType: "now"}` anywhere. Old orders have **no such field** → excluded from every report, list and cron. **This is the one that will bite** | Only ever `{deliveryType: {$ne:"scheduled"}}` or `{$in:["now", null]}`, and `{$ifNull:['$deliveryType','now']}` in aggregations. `successStatuses` is **left untouched** — 14 consumers plus two payment-webhook guards (`razorpay/controller.js:110`, `:166`) | **Grep the diff for the literal `deliveryType: "now"` as a review gate.** Repository tests seeded with documents that have **no** `deliveryType` field |
| 13 | 🆕 **The `.lean()` defaults trap — THIRD occurrence in this project** | `StoreRepository.getById` uses `.lean()` → defaults NOT applied → `config.scheduling` reads `undefined` on every existing store. Already bit `maintenance` (`stores.schema.js:112-116`) and `giftWithPurchaseEnabled` (`:122-128`). Same trap on `order.deliveryType` in every aggregation | One resolver util for store config; **nothing reads `config.scheduling.*` directly.** `deliveryType` **serialized explicitly** on every order response; `$ifNull` in every aggregation | Unit: a store document with no `config.scheduling` resolves to full defaults with `enabled:false`. Unit: an order document with no `deliveryType`, read via `.lean()`, is treated as `'now'`. **Review gate: grep for `config.scheduling` outside the resolver** |
| 14 | 🆕 **`allTime` profit double-count** | `getSnapshotSum({storeId})` at `profit-snapshot.repository.js:191` has **no date bound**, and `:198` adds `todayLive`. **The recompute is what ARMS this dormant bug** | Loop upper bound = yesterday, **AND** clamp `:191` to `yesterdayEnd` | Test 22: with a today-dated row deliberately present, the tile must not double-count |
| 15 | 🆕 **A stale profit row survives a refund forever** | `:262` returns early on an empty result and the ops are upsert-only. Refund the last order of a day, re-run, and the old money stays | **Delete-and-rebuild the day, per store**, before upserting. Do **not** skip the delete when results are empty | Test 12 — **this case FAILS on today's code** |
| 16 | 🆕 **A duplicate profit row for one business day** | The row key is IST midnight expressed as a UTC instant (18:30 UTC of the previous date). A hand-built key inserts a **second row** for the same day; the unique index `{date:1, storeId:1}` does not error, and `getSnapshotSum` adds both | **Always `computeAndSaveSnapshot(day.toDate())`; never construct a `{date:…}` key by hand** — not in the cron, not in the endpoint, not in tests | Tests 14 and 15 (23:00 IST vs 00:30 IST → one row; the 18:29/18:31 UTC boundary) |
| 17 | 🆕 **Cutover-seam double count** | COD created 3 Aug, delivered 5 Aug. New rule → 5 Aug. If the window recomputes 3 Aug under the **old** rule it also lands there. Counted twice | Window lower bound = `max(today − N, CUTOVER)`. **Pre-cutover days are never recomputed, ever** | Tests 17 and 18 (no write at all before the cutover; a cross-seam order appears in exactly one row collection-wide) |
| 18 | 🆕 **The live profit tile drifts from the snapshot** | `getLiveProfit` (`:97-101`) is `createdAt`-only. Change only the snapshot and a COD order created yesterday and delivered today is in **neither** | **One shared attribution expression used by both functions.** The single most important detail of Half 1 | Test 8: never both, never neither |
| 19 | **Old Android builds break** | A non-null Kotlin field decodes a missing key to `null` and crashes | `GsonBuilder().setLenient()` (`NetworkModule.kt:172`) drops unknown keys, so **new fields cannot throw**. Every new field declared `val deliveryType: String? = null`, **never** `= "now"`, following the commented precedent at `OrderModels.kt:87`, `:96`. `OrderStatus.from()` (`:298`) maps unknown → FAILED; **keeping status OPEN sidesteps it entirely** | `./gradlew assembleDebug` + `ApiContractTest.kt` **extended, not bypassed** |
| 20 | 🚨 **The iOS all-or-nothing decoder — THE ONE LINE THAT CAN CAUSE A P1** | `Order` has a hand-written `init(from:)` (`OrderModels.swift:81`). A single `try container.decode(String.self, forKey: .deliveryType)` on a non-optional would **blank the ENTIRE orders list for every customer whose history predates the feature** — the comment at `:85-89` spells this out | New fields go in `CodingKeys` (`:126`) **AND** use `decodeIfPresent` | **Required regression test:** a fixture for a scheduled order **AND** a fixture for a pre-feature order, asserting **both** decode. Non-negotiable |
| 21 | **The on-time-delivery KPI silently changes meaning** | Writing the slot start into `expectedDelivery` (`orders.schema.js:221`) redefines "on time" for a whole class of orders — and it is overwritten at rider-assign anyway | **`expectedDelivery` is not touched.** Spec §7 already struck it | Grep the diff for `expectedDelivery` — it must not appear |
| 22 | **Timezone off-by-one wipes out the booking window** | Between **00:00 and 05:30 IST** the UTC date is the previous day, so a UTC-built "today + N days" strip **starts on a date already in the past**. An admin day view on UTC days is wrong for that whole window — **exactly when the morning-shift manager opens it** | The five rules (§5.5). **One canonical `buildSlot`.** Server rejects any client-sent slot that doesn't match a server-generated one | Unit tests with the clock frozen at **01:00 IST** and **23:30 IST**, asserting the same IST calendar day. Review gate: no `new Date().getDay()`, no `.toISOString().split('T')[0]`, no `toLocaleString` round-trip |
| 23 | **Prod migration safety** | An `updateMany({}, {$set:{…}})` across the whole `orders` history would be the riskiest thing in this feature | **No migration is needed and none should be run.** Every new field is defaulted; guards test for a positive `'scheduled'`; legacy documents behave correctly by construction | Test with documents that have **none** of the new fields — they must behave exactly as today. Prod is user-driven and manual; nothing here asks for it |
| 24 | **Slot capacity taken too late → money for a slot that filled** | On prepaid, the order is created **before** the Razorpay sheet opens and the customer can sit in it for minutes | **Capacity is claimed at ORDER CREATION, not at payment success.** The success webhook does **nothing** to the seat | Integration: create a scheduled prepaid order, assert the seat exists **before** any webhook |
| 25 | **A stale app screen books a dead slot** | App backgrounded 20 minutes with a slot selected, then pays | (1) refetch slots on foreground — all three clients already have the hook (Android `LaunchedEffect` `CheckoutScreen.kt:70`, web `useEffect` `Checkout.tsx:62`, iOS `.onAppear`); if the selected `slotId` is gone, **CLEAR the selection** and show the inline message — **never silently re-select a neighbour**; (2) the server re-validates at booking regardless. **Verified: no client caches the cart or checkout state on disk**, so **no client can resurrect a stale slot** | Manual test in the guide; the 422 + `code` path covers the server side |
| 26 | **Restocked units lose their real expiry (pre-existing, amplified)** | Every restock merges returned units into the **LEGACY catch-all** batch at the item's *current* cost (`item.repository.js:978-1000`), so a cancelled 7-day-old booking returns units whose real expiry is lost | **Out of scope for phase 1.** Documented as a known gap in the test guide; feeds the phase-2 return-to-lot primitive | Nothing to verify — it is a documented, unchanged pre-existing behaviour |

---

## 13. Open questions for the user

**Money / data**
1. 🔴 **Pre-cutover profit backfill — YES or NO?** Pre-cutover days stay under-counted **forever**: ≥**67 orders / ₹9,665 revenue / ₹1,158 profit** across the 9 cron days as of the 14 July dump, more since. Filling it is a **one-off backfill under the OLD basis (`createdAt`) for pre-cutover days only** — it changes no definitions but **does move already-reported numbers upward.** (§8.10)
2. **`deliveredOn` re-stamp hardening — include the optional 5 lines or not?** No behaviour change today; it permanently removes a foot-gun where a future `findOneAndUpdate` writing `status: CLOSED` on an already-CLOSED order would silently move that order's profit to a different day. (§8.3)
3. **Batch re-allocation (phase 2) — which cost is the truth?** Booking-day cost (spec §2) or actually-consumed cost? **Phase 2 cannot start without this**, because re-allocating rewrites `orders.items.costPrice` after the sale, which is exactly what §14 exists to prevent. (§7.1 item 4)
4. **Should a store admin be allowed to EDIT a scheduled order days before its slot?** It now works correctly (stock adjusts both ways), so this is purely a **product** policy question, not a correctness one. (§5.4)
5. **COD switch-on criteria** — the setting exists from day one but ships OFF. When does it get enabled? Non-blocking; decide after the feature is live.

**Chanchal's design questions**
6. **Day-view default date** — she recommends **Today** with Tomorrow's count on its button; spec §11.6 says "tomorrow's". **Confirm.**
7. **An "items to reserve" per-day roll-up** (total quantity per item across the day) is the literal answer to *"what do I buy"*. She recommends a **second pass**, since it needs a new aggregation. Phase 1 or phase 4?
8. **Two new nav items (`Day Plan`, `Delivery Slots`)** — acceptable, or fold Day Plan in as a **third tab** on `/orders`?
9. 🔴 **Is the ops-board / dashboard / funnel exclusion IN PHASE 1, or a follow-up?** These touch shared backend queries. **If it is a follow-up, the new ops-board banner is wrong on day one** (it would say "12 waiting" while those 12 are also still in the buckets and the stale count). Chanchal's recommendation: phase 1.
10. **`scheduledCount` scope for super admins on "All stores"** — she recommends summing across stores and showing store names in the group rows. **Confirm the endpoint aggregates that way.**
11. **The 15-minute grace before a stuck release turns red** — **if the release cron interval is longer than 5 minutes, raise the grace to 3× the interval.** What interval do we want? (Plan assumes every 1–5 minutes.)
12. **A warmer "nearly gone" amber** for dates with 1–2 slots left would need an **extra backend field**; not specced. Flag if wanted.

*(Settled by revision 2, no longer open: store pickup — delivery only · dedicated admin settings page — yes · reminder pushes — yes, evening before + one hour before · the free-gift contradiction — gone, reserving at booking is now consistent · the 60-second cancel countdown suppression — settled · slot validation before the payment sheet — settled, capacity is claimed at order creation.)*

---

## 14. Follow-ups explicitly OUT of scope

| # | Item | Why it is out |
| --- | --- | --- |
| 1 | **`getRevenueTrend` UTC bucketing bug** — `packages/shared/repositories/order.repository.js:2055-2065`. The `week` / `year` / `month` branches use `$isoWeekYear` / `$isoWeek` / `$year` / `$month` with **no `timezone: TZ`**, so an order placed 1 Jan 03:00 IST reports in December | Real pre-existing bug, **not caused by this feature — but it WILL be blamed on it.** Ticket it now so the attribution is on record |
| 2 | **`toLocaleString` weekday round-trip** — `packages/user/src/routes/store/controller.js:16-18` | Correct today only by coincidence of V8's date parser. **The slot generator must NOT copy it** — that guard is in scope; the cleanup itself is not |
| 3 | **Duplicate / expensive indexes on `orders`:** `schema.index({storeId:1})` at `:245` is a pure prefix duplicate of five other compound indexes and costs a write on every insert; `schema.index({orderId:"text"})` at `:232` is a **text index** on a field that already has a unique constraint — the most expensive index type to maintain, for an exact-match ID lookup | Removal candidates in a tuning pass, **with a usage check first**. Route to **aabha-dba** |
| 4 | **LEGACY-batch restock loses expiry** — `item.repository.js:978-1000` merges returned units into the catch-all batch at today's cost | Pre-existing; amplified by 7-day holds but not caused by them. Feeds the phase-2 return-to-lot primitive |
| 5 | **Per-day capacity cap** (as opposed to per-slot) | Not requested; the per-slot cap covers launch |
| 6 | **Real-money refunds to source** (Razorpay refund API) | Signed-off decision is wallet-only. Spec §10.3 already names this as a later upgrade |
| 7 | **"Committed for future slots" wired into `getLowStockItems`** | Now much less urgent — held stock already lowers `items.quantity`, so replenishment is **correct**. Any future "committed demand" view is a display nicety, and automating it would spend real money on a number nobody has trusted yet |

---

## 15. Definition of done

**Not "the new tests pass" — the FULL existing suite must be green.**

| Repo | Command | What "green" means |
| --- | --- | --- |
| `haper-backend` | `cd packages/<pkg> && NODE_ENV=test npx jest` for **shared, user, admin, cron, picking, delivery** | **Zero failures. In-memory Mongo ONLY — never the real DB.** Run from the package dir so the per-package in-memory setup fires. `packages/admin/__tests__/order-cogs-profit.test.js` must pass **with no edits** |
| `haper-admin` | `npx vitest` + `npx eslint .` | **Vitest, not Jest.** Green = **still exactly the 5 known-failing `OrderDetailsModal` tests (react-router context), not zero.** eslint = **no worse than the 113-problem baseline** |
| `haper-web` | `npx tsc --noEmit` && `npx vite build` | **eslint is NOT usable in this repo** (not installed; the lint script targets a nonexistent `src/`). Do not report "lint clean" |
| `haper-android` | `./gradlew assembleDebug` + unit tests | Includes the extended `ApiContractTest.kt` |
| `haper-ios` | build + `haperTests` | **Must include the pre-feature-order decode fixture** (risk 20) |
| `haper-delivery` | `./gradlew assembleDebug` | |
| `haper-picker` | — | **Zero work. Nothing to verify.** |

**Also required before the work is considered done:**
- ✅ `/Users/office/Documents/haper/haper-misc/test-scheduled-delivery.md` exists and is complete — ✅/❌ walkthrough steps, edge cases, and what deploy each part needs. **Includes the operational warnings:** held stock vs the physical shelf (risk 3), and LEGACY-restock expiry loss (risk 26).
- ✅ `/Users/office/Documents/haper/haper-misc/test-profit-snapshot.md` exists **as a separate file** — the profit fix is independently revertable and must be independently testable.
- ✅ Every caller of everything touched has been grepped (`packages/shared/*` models, schemas, constants, utils, and all API response shapes).
- ✅ Every new backend field is **nullable or defaulted**. No response shape changed. No enum changed.
- ✅ An `explain()` on **DEV** proves the release query uses `sched_release_queue` (**IXSCAN, not COLLSCAN**), and that the profit day query uses an index union rather than a COLLSCAN.
- ✅ **Review gates run on the diff:** no literal `deliveryType: "now"` predicate · no `expectedDelivery` write · no direct `config.scheduling.*` read outside the resolver · no hand-built `{date: …}` profit-snapshot key · no `new Date().getDay()` / `.toISOString().split('T')[0]` / `toLocaleString` round-trip · **`pick-task.utils.js:138` includes `deliveryType` and `releasedAt` in the `.select()`** · every attribution read goes through the one shared expression.
- ✅ **No migration was run.** None is needed.
- ✅ Work landed **directly on `dev`**, staged file-by-file, off a fresh re-base. `main` untouched.

---

*End of plan. Rewritten for spec revision 2 on 2026-08-02. Nothing in this document has been implemented. Awaiting user approval.*
