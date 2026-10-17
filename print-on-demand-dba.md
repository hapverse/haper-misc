# Print on Demand — DBA review (data model, indexes, purge, consistency)

Owner: aabha-dba · 2026-10-12 · Read-only review: no DB was touched, no code changed.
Inputs: `plans/print-on-demand-plan.md` (§3), `haper-backend/packages/shared` models/utils,
`packages/{user,admin,cron}/src/connections/mongo.js`. Where the plan and the brief differ,
the brief wins. The main difference is retention: files are purged **24 h after delivery**,
not after 7 days.

## 0. Decisions in one screen

1. Use a new `print-jobs` collection. **No TTL index.** Files are deleted by the cron, and
   the job record stays (the order history needs it).
2. Add a `filesState` field (`LIVE`, then `PURGING`, then `PURGED`) next to `filesPurgedAt`.
   It gives purge a crash-safe, guarded state machine and a clean partial index (§4).
3. Decide purge eligibility for ordered jobs by **pulling** the order's status in the cron.
   Do not have the delivery, cancel and refund code paths stamp `purgeAfter`. Pulling adds
   zero new writers to the money and delivery code.
4. Make the Print Queue read **paid = order `status: OPEN`**, from `orders`, using the
   existing index. Do not add a "PAID" job status that the Razorpay capture paths would
   have to remember to set (§3.3).
5. Indexes get built **only** if `PrintJobModel` goes into `mongoIndexUtils.ensureIndexesFor`
   in user + admin `mongo.js` **and** both pre-create lists **and** both `__tests__/setup.js`.
   The orders collection gets **no new index**.
6. Every read in the job flow (upload, then edit options, then quote, then checkout) must go
   to the **primary**. A secondary read just after upload returns 404 (§5).

---

## 1. Schema — `print-jobs` (`shared/models/print-jobs.schema.js`, `{timestamps:true, versionKey:false}`)

| Field | Type | Req / default | Notes |
|---|---|---|---|
| `userId` | ObjectId | required | owner |
| `storeId` | ObjectId | required | fixed at upload. Checkout requires it to equal the order's store |
| `status` | String enum `UPLOADED, ORDERED, PRINTED, REJECTED, CANCELLED, EXPIRED` | required, default `UPLOADED` | job lifecycle. "Paid" is **not** a job status (§3.3) |
| `orderId` | ObjectId | default `null` | set only by the claim (§5) |
| `orderDisplayId` | String | default `null` | "HP…" |
| `file.originalName` | String (trim, max 200) | required | PII-ish: the customer named it. Never copy it into analytics (§6) |
| `file.mimeType` | String enum pdf/jpeg/png | required | from sniffing the magic bytes, not from the client |
| `file.sizeBytes` | Number (int) | required | |
| `file.sha256` | String | required | lets you spot duplicate uploads. Not unique |
| `file.sourceKey`, `file.printKey` | String | required | S3 **keys** in the private bucket. Never URLs |
| `file.pageCount` | Number (int ≥1) | required | pages of the normalised A4 PDF |
| `options.sides` | String enum `SINGLE, DOUBLE` | default `SINGLE` | |
| `options.copies` | Number int 1–50 | default 1 | |
| `options.pageRange` | String | default `null` | `"1-3,7"` |
| `options.colour`, `options.paper` | String | default `BW`, `A4_PLAIN` | |
| `quote` | `{selectedPages, billableSides, sheets, pricePerSide, amount, costPerSide, gstRate, configVersion}`, all Number except configVersion | default `null` | server-computed. **Frozen at claim** and never recomputed after. Rupees with 2 decimals, the same convention as `orders.price` |
| `consent.acceptedAt` | Date | **required, no default** | A default would let a forgotten call site record consent that was never given |
| `consent.textVersion` | String | required, no default | which consent text the customer saw |
| `printedAt` | Date | default `null` | |
| `printedBy` | `{adminId, email}` | default `null` | |
| `rejection` | `{code, note, by, at}` | default `null` | |
| `reprints` | `[{at, by, reason}]` | default `[]` | **capped** with `$push: {$each:[x], $slice:-20}` |
| `downloadCount` | Number | default 0 | |
| `lastDownloadedAt` | Date | default `null` | |
| `downloads` | `[{at, adminId}]` | default `[]` | **capped** at `$slice:-20`. The full audit trail goes to `admin_audit_logs` via `auditUtils.logAtomic` (that table is append-only and already queried) |
| `filesState` | String enum `LIVE, PURGING, PURGED` | required, default `LIVE` | the purge state machine |
| `purgeAfter` | Date | required | draft: `createdAt + 24h`. After claim: `claimedAt + 14d` hard ceiling (§4) |
| `purgeStartedAt`, `filesPurgedAt` | Date | default `null` | |
| `purgeAttempts` | Number | default 0 | |
| `purgeLastError` | String | default `null` | for alerting |

Document size is about 1.2–1.8 KB.

### Additive fields on existing collections (no backfill)

- **`orders.orderType`**: String, **no schema default**. Set only on print orders (`"print"`).
  Read it only with the positive test or `$ne` (the plan already says this). Leaving out the
  schema default keeps grocery order documents byte-identical to today.
- **`orders.items[].lineType`, `printJobId` (ObjectId), `print` ({fileName, pages, copies, sides,
  pageRange})**: also **no schema default**. With `default: null`, Mongoose would write 3
  extra null keys on every line of every grocery order (about 2.6 lines per order) for no
  benefit. Android Gson already decodes a missing key as null, so clients need no change.
  No index on `printJobId`: you go from a job to its order through `print-jobs.orderId`.
- **`stores.config.print`**: a nested block that **defaults to OFF**. Readers must test
  `store.config?.print?.enabled === true`, because `.lean()` on old store documents does not
  fill in schema defaults. Store prices as Numbers. Keep `configVersion` (an int that goes up
  on every edit) so a frozen quote can be traced to the price list it used.

---

## 2. Indexes

| Name | Keys | Options | Serves |
|---|---|---|---|
| `job_order` | `{orderId:1}` | `partialFilterExpression:{orderId:{$type:"objectId"}}` | jobs for an order (queue, receipt, release, purge). Drafts (orderId null) take no index space |
| `job_user_recent` | `{userId:1, createdAt:-1}` | — | "My print jobs" list; the rate-limit fallback count; account-purge |
| `job_store_status` | `{storeId:1, status:1, createdAt:1}` | — | admin filters such as history and "printed today", oldest first |
| `job_purge` | `{filesState:1, purgeAfter:1}` | `partialFilterExpression:{filesState:{$in:["LIVE","PURGING"]}}` | the purge cron (§4). It shrinks itself: a purged job leaves the index |

- **No TTL index.** TTL deletes the Mongo document, which is exactly what we must keep, and it
  never deletes the S3 object, which is exactly what we must remove. The privacy deletion has
  to be the explicit cron purge. The only backstop is the S3 lifecycle rule.
- **No unique index.** Claim-once comes from the guarded update in §5, not from an index.
  That is why a missing index here is a speed problem, never a correctness problem.
  Optional: if clients send an upload retry key, add a unique partial index on
  `{userId:1, clientUploadId:1}`. Not needed for v1, because a duplicate draft is harmless and
  gets purged after 24 h.
- `$in` inside `partialFilterExpression` needs MongoDB 6.0 or later. The cluster already runs
  coupon-redemptions with the same construct, so this is safe.
- Queries only use a partial index if they repeat its filter **literally**. The purge query
  must include `filesState: {$in:[...]}` or `filesState: "LIVE"`. The order lookup must
  include `orderId: <ObjectId>`, which satisfies `$type` automatically.

---

## 3. Getting the indexes built + rollout order

### 3.1 Where to register the model (all six places are required)

1. `packages/user/src/connections/mongo.js`: add to the **pre-create** list, because the
   checkout transaction writes `print-jobs` and MongoDB cannot create a collection inside a
   transaction. Also add to **`ensureIndexesFor([...])`**.
2. `packages/admin/src/connections/mongo.js`: add to the pre-create list, because
   reject/printed/download writes are audit-logged through `logAtomic`, which runs **inside**
   `session.withTransaction`. Also add to `ensureIndexesFor`.
3. `packages/user/__tests__/setup.js` and `packages/admin/__tests__/setup.js`: these hold a
   separate hard-coded copy of the same list. Skip them and the tests never build the indexes.
4. Cron does not need it. It only writes outside transactions, and user/admin boot first.
5. After `ensureIndexesFor`, add `mongoIndexUtils.missingIndexes(PrintJobModel, specs)` that
   compares full specs (key + partialFilterExpression), not names. Make it **log only**: no
   kill switch, because correctness does not depend on these indexes. Never `process.exit`
   (PM2 would restart-loop).

`schema.index()` on its own does **nothing**. Every service connects with
`secondaryPreferred`, which silently forces `autoIndex:false`.

### 3.2 Rollout

1. Ship backend with `stores.config.print.enabled` missing or false on every store. The first
   boot of user/admin creates the empty collection and builds the 4 indexes instantly.
2. Check on **dev**: `db["print-jobs"].getIndexes()` should list 5 (including `_id`), and the
   boot log should have no `[mongo] index build FAILED`. Then run `explain()` on the queue,
   my-jobs and purge queries and confirm IXSCAN.
3. Deploy the cron with the purge job **before** turning on any store. A dry-run log line
   with "0 candidates" proves it is wired.
4. User creates the private S3 bucket, the lifecycle rule and the IAM policy (§4.4).
5. Enable one store, then the clients.

The orders collection needs no index step. Nothing new on `orders` is queried by a new key
(§6).

### 3.3 Print Queue query (it reads `orders`, not job status)

"Paid" means the order has reached `OPEN`. That transition belongs to the existing capture
paths: webhook, payment-status poll and reconcile. A separate job-level `PAID` flag would be
a second copy of that fact which each of those paths has to remember to set. Miss one, and a
paid customer's print never appears in the queue. So:

```js
// step 1: existing index {storeId:1, status:1, createdAt:-1}; orderType is a residual filter on a tiny set
orders.find({ storeId, status: OPEN, orderType: "print" }).sort({ createdAt: 1 }).limit(100)
// step 2: job_order index
printJobs.find({ orderId: { $in: ids } })
```

Tabs: "To print" = OPEN, "Printed, waiting for rider" = PACKED, and so on, all using the same
index. At about 50 orders per store per day, step 1 touches a few dozen documents. Read
`primary` here so a just-paid order shows up immediately; the volume is trivial.

---

## 4. Purge design (DB + S3 consistency)

### 4.1 When files are due

| Job situation | Due when | Decided by |
|---|---|---|
| `UPLOADED` draft, never ordered | `purgeAfter` (= upload time + 24 h) | pass A |
| Released by an unpaid-order expiry, so back to `UPLOADED` | the release sets `purgeAfter = now + 24h` | pass A |
| Order `CLOSED` (delivered) | `order.deliveredOn + 24h` | pass B |
| Order CANCELED / ADMIN_CANCELED / FAILED / PAYMENT_FAILED / PAYMENT_CANCELLED / REFUND_*, or job REJECTED | `order.updatedAt + 24h` | pass B |
| Order stuck (`UN_DELIVERED`, never closed, or a cron bug) | ceiling: `purgeAfter` = claim + 14 d | pass A |
| Account deleted | now: `account-purge` sets `purgeAfter = now` on all of that user's LIVE jobs. It does no S3 work itself; there is one purge code path | pass A |

`UN_DELIVERED` is **not** treated as terminal, because a redelivery needs the printout. It
falls to the 14-day ceiling.

### 4.2 Queries (cron `print-file-purge.js`, every 15–60 min, batch ≤ 100)

```js
// Pass A: due by time (index job_purge)
printJobs.find({ filesState: { $in: ["LIVE", "PURGING"] }, purgeAfter: { $lte: now } }).limit(100)

// Pass B: ordered jobs whose order is finished (index job_purge, a set of a few hundred rows at most)
printJobs.find({ filesState: "LIVE", orderId: { $type: "objectId" } }, { orderId: 1 }).limit(500)
// then orders.find({ _id: { $in: orderIds } }, { status, deliveredOn, updatedAt })
// and keep only those terminal + 24 h
```

Reading candidates from a secondary is fine. A stale read can only see an *older* order
state, and that only delays a purge. It can never purge early, because the guarded write
below re-checks the job on the primary.

### 4.3 Per job (idempotent, crash-safe)

```
1. findOneAndUpdate(
     { _id, filesState: {$in:["LIVE","PURGING"]},
       // draft path only: the guard must also hold the race with checkout
       ...(isDraft ? { status: "UPLOADED", orderId: null, purgeAfter: {$lte: now} } : {}) },
     { $set: { filesState: "PURGING", purgeStartedAt: now,
               ...(isDraft ? { status: "EXPIRED" } : {}) } },
     { writeConcern: { w: "majority" } })          → null means someone else got it; skip
2. S3 DeleteObjects([sourceKey, printKey])          → check the per-key Errors[] (see trap below)
3a. success: updateOne({ _id, filesState: "PURGING" },
              { $set: { filesState: "PURGED", filesPurgedAt: now, purgeLastError: null } })
3b. failure: updateOne({ _id }, { $inc: { purgeAttempts: 1 }, $set: { purgeLastError: msg } })
    The row stays PURGING, so the next run retries it.
```

- **Order matters: S3 delete first, then mark PURGED.** If it fails between steps, the
  database still says "files may exist", and the next run deletes again. Deleting a missing
  key is a success. The reverse order would leave a row saying PURGED with the customer's
  Aadhaar still sitting in S3.
- **Checkout race.** Step 1 for a draft flips `UPLOADED` to `EXPIRED` with a guard. The claim
  in §5 also requires `status:"UPLOADED"`, so exactly one side wins. If purge wins, checkout
  gets a 409: "your file expired, please upload again". Checkout should also refuse jobs whose
  `purgeAfter` is less than 20 min away (the payment window plus a margin), so a customer
  doesn't pay at 23 h 59 m and lose the file.
- **Download endpoint.** It must check `filesState === "LIVE"` before signing a URL. A signed
  URL issued just before a purge stays valid for at most 5 min. That is acceptable.
- **S3 traps:**
  - `DeleteObjects` returns **HTTP 200 even when individual keys failed**. Inspect `Errors[]`.
  - If the private bucket has **versioning ON**, a delete only adds a "delete marker" and the
    file is still recoverable, which is a privacy failure. Keep versioning **off**, or add
    `NoncurrentVersionExpiration: 1 day`.
- **Alerting.** Log loudly and send it to the existing digest when `purgeAttempts ≥ 3`, or when
  a row is LIVE more than 24 h past `purgeAfter`.

### 4.4 S3 lifecycle backstop (user sets this up in AWS)

Expire the `print/` prefix after **14 days**. The plan says 30; 14 matches the DB ceiling and
halves the worst-case exposure. The rule also catches **orphans**: the upload writes to S3
before inserting the document, so if the insert fails and the best-effort delete also fails,
the object is left behind. Lifecycle expiry is asynchronous (it can lag by about a day), so
it is a backstop only and never the primary purge.

---

## 5. Read/write concern: claim, attach, release

- **Claim (attach to an order).** Run it inside the checkout `session.withTransaction(fn,
  { readPreference:"primary", readConcern:{level:"snapshot"}, writeConcern:{w:"majority"} })`:
  ```js
  updateMany({ _id:{$in: uniqueIds}, userId, storeId, status:"UPLOADED", orderId:null,
               filesState:"LIVE", purgeAfter:{$gt: now+20min} },
             { $set:{ status:"ORDERED", orderId, orderDisplayId, quote:<frozen>, purgeAfter: now+14d } },
             { session })
  ```
  Abort unless **`matchedCount === uniqueIds.length`**. Do not rely on `modifiedCount`: with
  `timestamps:true`, Mongoose always modifies `updatedAt`, so it is only correct because of
  the guard. De-duplicate `jobIds` first, and cap the list at 10. Two concurrent checkouts on
  the same job produce a WriteConflict. `withTransaction` retries the loser, which then
  matches 0 and gets a 409.
- **The job reads before the claim must use the primary:** `findById(...).read("primary")` in
  PATCH options, quote and the checkout pre-checks. Otherwise a secondary that is a few
  hundred ms behind returns 404 "job not found" right after upload. The same applies to the
  admin "printed" and "reject" actions and their read-after-write list refresh.
- **Release** (the unpaid order expired, or payment creation failed): a guarded
  `updateMany({orderId, status:"ORDERED"}, {$set:{status:"UPLOADED", orderId:null,
  orderDisplayId:null, quote:null, purgeAfter: now+24h}})` with `w:"majority"`. Run it only
  **after** the order's own guarded transition to PAYMENT_CANCELLED succeeded. That way a late
  Razorpay capture, which hits an order that is no longer PAYMENT_INITIATED, cannot leave a
  paid order pointing at a released job.
- **Mark printed / reject:** guarded on the current status, for example
  `{_id, status:"ORDERED"}` → PRINTED. The "all jobs of this order printed, so move the order
  to PACKED" step is a separate guarded order update, `{_id, status: OPEN}`, so it is safe to
  repeat.

---

## 6. Impact on the `orders` collection (grep findings)

Volume: this **doubles order growth**. Grocery today is about 50 orders/day; print adds up to
50/day. That is still about 36k documents/year, which is trivial for the 14 existing
indexes. **No new order index is needed.** Every new `orderType` filter rides along on an
existing `storeId`/`status` index.

Places that need a print-aware filter:

| Where | Problem | Fix |
|---|---|---|
| `shared/repositories/order.repository.js` ~L832 (dashboard top-10 inventory), ~L2777 and ~L2911 (top-sellers / item sales) | `$group` on `"$items.itemId"` (per store) or `CROSS_STORE_KEY` (all stores; `$toString` of null is null). **Every print line falls into one `_id:null` bucket.** With quantity 1 per job and 50/day, it can reach the top 10, and its `name: {$first: "$items.name"}` is a **customer's file name**, for example "B&W print · aadhaar.pdf". That leaks PII into the admin dashboard | Add `{ $match: { "items.itemId": { $ne: null } } }` right after `$unwind: "$items"`. Also make the line `name` snapshot generic ("B&W print, 6 sides") and keep the file name only in `items[].print.fileName` |
| `order.repository.js` ~L1120 (low-stock burn rate) | filters `items.itemId: {$in: ids}` | safe as is |
| `supersedeUnpaidOrders` (user order controller) | cancels **any** PAYMENT_INITIATED order | `orderType:{$ne:"print"}` (plan §5 #1) |
| `cron/pick-task-reconcile.js` | would try to build pick tasks | exclude print (plan §5 #2) |
| `order-edit.utils.consolidateItems` | merges all null `itemId` lines into one | reject edits (plan §5 #3) |
| `.populate("items.itemId")` (about 8 sites in order.repository) | null stays null; harmless on the backend | clients must render by snapshot `name` |
| Profit / COGS | reads the line `costPrice` snapshot. Correct as long as checkout stores `billableSides × costPerSide` | no change. Category or brand breakdowns that `$lookup` items will show print as "uncategorised". Label it "Print" in the UI if anyone cares |

The **unpaid-order release** cron (`unpaid-order-release.utils.js`) needs the job-release hook
from §5. Its restock already skips lines without an item.

---

## 7. Cost

Mongo storage is about 1.5 KB per job. At 50/day that is roughly 27 MB/year; across 5 stores,
about 140 MB/year. Negligible.

For S3, each job stores the original plus a normalised PDF, so roughly 2× the file size. A
typical job is 1–3 MB, so 2–6 MB live per job. Files stay roughly 1–2 days (draft 24 h, or
the order lifetime plus 24 h). Steady state at 50 jobs/day is under 1 GB stored, which costs
cents per month.

Worst case is abuse: every upload at the 20 MB cap and never ordered.

- One user at 20 uploads/hour and 60/day stores 60 × 40 MB = 2.4 GB/day. That is purged
  after 24 h, so the live footprint stays around 2.4 GB.
- Without the purge, only the 14-day lifecycle bounds it: about 34 GB per abusive user. That
  is still about $1/month, but this is why the per-user caps below matter more for CPU (PDF
  normalising in the user service) than for storage.

**Rate-limit keys (Redis).** Use the existing `distributedCacheUtils.incrWithTtl`, which is
an atomic Lua INCR+EXPIRE:

- `print:upl:{userId}:h:{yyyyMMddHH IST}`, TTL 3600 s, limit 20
- `print:upl:{userId}:d:{yyyyMMdd IST}`, TTL 26 h, limit 60
- A **DB-backed cap that does not depend on Redis**: refuse uploads when the user already has
  20 or more live drafts. That is a `countDocuments({userId, status:"UPLOADED", filesState:"LIVE"})`
  on `job_user_recent`, cheap.

`incrWithTtl` **throws** on a Redis error. Wrap it and fail open to the DB cap, because Redis
has no failover here. Also, the global `express-rate-limit` uses an in-process memory store,
so it would stop working the day a service runs 2 PM2 instances. Don't lean on it for this.

---

## 8. Risks (ranked)

1. **Indexes silently never built** if the six registrations in §3.1 are partly missed. The
   symptom is slow queries, not wrong data, which is exactly why nobody would notice.
2. **File-name PII leaking into dashboards** through the null-`itemId` bucket (§6). It is
   easy to miss because nothing errors.
3. **A paid customer's job missing from the queue** if someone later adds a job-level "paid"
   flag. Keep the queue anchored on order `status: OPEN` (§3.3).
4. **S3 versioning or a `DeleteObjects` partial failure** leaving files behind while the DB
   says PURGED. §4.3 orders the steps so the DB never claims more than S3 did; versioning has
   to be confirmed off by the user.
5. **Secondary-read 404s** in the upload, edit, quote and checkout flow, and stale admin lists
   after "Mark printed" (§5).
6. **Order growth doubles.** Harmless at this scale. Re-check the dashboard's lifetime facet
   cost once multiple stores are live.
7. The plan's `costPrice` / `gstRate` for print lines are new money semantics. GST rate is
   open question Q5. If it changes, it **must not** be back-applied to frozen quotes.

STATUS: done
OUTPUT: print-jobs schema (filesState purge state machine, no TTL) + 4 indexes, all registered via ensureIndexesFor/pre-create in user+admin+tests; pull-based purge (S3 first, then guarded DB flip); queue anchored on orders.status=OPEN; no new orders index; ~27 MB/yr Mongo, <1 GB live S3 at 50/day
NEXT: sumit-backend — implement per §1–§5 (model + repository + 6 registrations, guarded claim/release with matchedCount, primary reads, print-file-purge cron, the $ne:null match in 3 dashboard pipelines); then ved-db — explain() on dev for the queue, my-jobs and purge queries (expect IXSCAN on job_order/job_user_recent/job_purge); USER — private S3 bucket with versioning OFF + 14-day lifecycle on print/
