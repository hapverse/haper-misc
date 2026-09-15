# Backend Code Quality Audit

**Date:** 2026-09-14  
**Scope:** haper-backend, all 7 packages (admin, auth, cron, delivery, picking, shared, user)  
**Methodology:** Read-only code quality audit; architecture, security, reusability, best practices, industry standards. Not a full penetration test, though security-adjacent findings are present and flagged for specialist follow-up.

---

## Executive Summary

**Total findings:** 72 (4 Critical, 20 High, 29 Medium, 19 Low)

**Codebase health:** The project demonstrates strong discipline in transactional logic and concurrency handling — compare-and-set claims, post-commit event queueing, index-build verification, and fail-open configuration reads are all better-than-average for this complexity tier. The core money-path and order-lifecycle reasoning is sound.

The critical vulnerabilities center on deployment state, dependency hygiene, and incomplete adoption of existing controls rather than algorithmic failures. `packages/auth` is documented internally as "frozen" but still deployed and unpatched; tenant isolation bypasses exist in admin analytics; error handling is partially hardened across a three-service footprint; and a hardcoded OTP fallback in the delivery service closes orders without verification. None of these are difficult to fix individually, but several map to infrastructure and deployment processes rather than code changes.

Three structural observations:
1. **Copy-pasted bootstrap and error handling across three services** — drift has begun (admin is missing HSTS headers that delivery/picking both have), and every fix must be applied three times.
2. **Controls exist but are half-adopted** — `redactCostPrice`, tenancy-resolution helpers, and case-normalisation all have well-written implementations used by a minority of their call sites.
3. **No service layer, no distributed logging** — all orchestration and policy lives in controllers; failures are logged but not raised; and a silent 9-day revenue loss proves that this class of bug is expensive.

---

## Critical & High Findings

### Critical-1: `?storeId=` query param overrides auth-pinned store scope (cross-store profit/COGS leak)

**Severity:** Critical  
**Package:** admin  
**File:** `packages/admin/src/routes/analytics/controller.js:299-302, :520-521`

```js
// getProfitAnalytics
const { from, to, storeId: queryStoreId } = req.query;
const storeId = queryStoreId || (req.store ? String(req.store._id) : null);  // query param wins
```

`middleware/auth.js:106` correctly 403s a store-scoped admin who sends a foreign `x-store-id` header, but `controller.js` bypasses this by accepting the override via query param. The resolved `storeId` flows into `profit-snapshot.repository.js:292` and `order.repository.js:2816` with no further validation. Result: `GET /admin/analytics/profit?storeId=<other store>` returns another store's revenue, COGS and profit to a store-scoped admin.

The correct pattern already exists (`middleware/inventory-context.js:73-89 resolveStoreId()`) and is not used here.

**Fix:** Replace both resolutions with `const storeId = resolveStoreId(req, req.query.storeId);` and wrap in `try → next(error)` so 403 propagates. Add regression test: store_admin + foreign `?storeId` → 403.

---

### Critical-2: `crossStore=true` discards store scope on VIEW_OPERATIONS-gated endpoint

**Severity:** Critical  
**Package:** admin  
**File:** `packages/admin/src/routes/analytics/controller.js:480, :522` + `router.js:268-273`, `validator.js`

```js
const crossStore = req.query.crossStore === 'true' || req.query.crossStore === '1';
// downstream: const allStores = crossStore || !storeId;
// if (storeId && !allStores) { match.storeId = ...; }   // never runs when crossStore=true
```

`/item-frequency` is gated on `P.ANALYTICS.VIEW_OPERATIONS` — the baseline permission held by manager and support, not just store_admin. Appending `&crossStore=true` nullifies the store filter entirely, letting a low-privilege admin read every store's best-seller and units-sold data. Same issue with `getProductCogs` at `:522`.

**Fix:** Gate on role: `const crossStore = isSuper(req) && (req.query.crossStore === 'true' || req.query.crossStore === '1');`. For non-super caller, either ignore the flag or 403. Mirror in `getProductCogs` and drop the `|| !storeId` widening.

---

### Critical-3: Hardcoded master OTP fallback closes any order without verification

**Severity:** Critical  
**Package:** delivery  
**File:** `packages/delivery/src/routes/order/controller.js:241` consuming `packages/shared/config/index.js:55-58`

```js
// shared/config/index.js
otp: {
    userRegistration: process.env.OTP_FOR_USER_REGISTRATION || "995518",
    orderCompletion:  process.env.OTP_FOR_ORDER_COMPLETION  || "898444",
}

// delivery/src/routes/order/controller.js:241-243
const matchesMaster   = submittedOtp === otpEnv.orderCompletion;
const matchesOrderOtp = expectedOtp !== "" && submittedOtp === expectedOtp;
if (!matchesMaster && !matchesOrderOtp) { ... }  // allows either path
```

Two problems. (1) The literal `898444` is committed to the repository. If `OTP_FOR_ORDER_COMPLETION` is unset, any rider can mark any assigned order CLOSED using a public-ish constant, bypassing customer-presence proof. (2) Even when configured, the master OTP works unconditionally, is non-audited, and non-rotating. No flag on the order records which path was used, so fraudulent closes are indistinguishable from real ones.

**Fix, in priority order:**
1. Remove the `|| "898444"` and `|| "995518"` literals from `shared/config/index.js`. Fail boot if env var is missing.
2. Decide whether master OTP should exist at all. If yes, stamp `meta.closedViaMasterOtp = true` on the order and write an audit row so it is reviewable.
3. Use `crypto.timingSafeEqual` on both comparisons.
4. Rotate the value in every environment once (1) ships.

---

### Critical-4: The "frozen" auth fork is still deployed in production and dev

**Severity:** Critical  
**Package:** auth  
**File:** `ecosystem.config.js:19-22` + `ecosystem.dev.config.js:25-28`

Six source files in `packages/user` carry the header: **"packages/auth is frozen — do not port fixes back there"** (`user/src/routes/auth/otp/controller.js:1`, `.../google/controller.js:1`, `.../refresh/controller.js:1`, `.../otp/validator.js:1`, `.../otpCache.js:3`, `user/src/routes/auth/router.js:8`).

But PM2 still lists it in both `ecosystem.config.js:19` and `ecosystem.dev.config.js:25`, so `packages/auth`'s customer OTP and Google login endpoints are live and publicly reachable. Every hardening applied to the `user` twin is absent from the running service. Concrete gaps:

| Hardening in `user` | Missing from live `auth` |
|---|---|
| Single-use OTP (burns on success) | Code is replayable for its full TTL, unlimited times |
| Atomic resend cooldown via `setIfNotExists` | Non-atomic read-then-write; concurrent requests all send SMS (costs money) |
| Per-route limiters: 3/15min per (phone,IP), 20/15min per IP | Only blanket 100/15min + non-atomic in-controller counter |
| Exact indexed email lookup | Unescaped user input in RegExp on anonymous endpoint |
| Race-safe signup (E11000 handled) | Bare `create()` → 500 on concurrent duplicate |
| Joi-normalised query to controller | Raw `req.query` passed through; `" 9876543210"` bypasses cooldown |
| 5xx message masking in error middleware | Raw error.message reaches client in production |

**Fix:** (1) Decide whether `packages/auth` should serve traffic. If migration is complete, remove both PM2 entries and delete the package — closes all seven gaps at once. (2) If old builds still use it, port single-use OTP, atomic cooldown, and regex fix immediately, and set a sunset date. (3) Either way, replace the "frozen" comments with the actual status.

---

### High-1: `redactCostPrice` mounted on only 2 of 30 routers — cost data leaks via analytics

**Severity:** High  
**Package:** admin  
**File:** `packages/admin/src/middleware/redactCostPrice.js` (mounted at `routes/order/router.js:13`, `routes/items/router.js:20` only)

The policy is clear: cost data is restricted to super_admin (`middleware/permission.js:126-131`). The enforcement middleware is well-written and deep (JSON-safe clone, key strip), but it is only applied to 2 of 30 routers. Not applied to: `/admin/analytics/profit` (returns `costTotal`), `/admin/analytics/product-cogs` (literal COGS per product), and routes for warehouse, procurement, transfer, store, pos, discount-rule — all reference `costPrice` unredacted.

Since store_admin bypasses the permission system (`permission.js:31`), a store admin reads company cost data on every one of those routes — the exact outcome the control says must never happen.

**Fix:** Mount `redactCostPrice` globally in `src/routes/index.js` before the sub-router block (it is a no-op for super_admin, so global mount is safe). Remove the two per-router mounts. If a route legitimately must expose cost, make that an explicit, commented carve-out.

---

### High-2: Default `statusCode` 400 makes the production-redaction branch dead code

**Severity:** High  
**Package:** admin  
**File:** `packages/admin/src/middleware/error.js:55-63`

```js
const statusCode = error.statusCode || 400;
const clientMessage =
    process.env.NODE_ENV === "production" && statusCode >= 500
        ? "Something went wrong. Please try again."
        : error.message;
```

Anything without an explicit `statusCode` (a `TypeError`, a Mongo driver error) has none, falls back to **400**, `statusCode >= 500` is false, and the raw runtime message goes to the client in production — Mongo index names, driver internals, sometimes file paths. The redaction branch can only be reached by code that already wrote a human-safe message, making it useless.

Delivery and picking are already fixed with an explicit terminal branch (`else if (!error.statusCode) { error = new errorUtils(..., 500); }`).

**Fix:** Port delivery's `else if (!error.statusCode) → 500` branch verbatim and change the fallback from `|| 400` to `|| 500`.

---

### High-3: Axios error branch assumes `err.response` exists — throws inside error handler

**Severity:** High  
**Package:** admin  
**File:** `packages/admin/src/middleware/error.js:47-51`

```js
if (err["isAxiosError"]) {
    const exception = err["response"]["data"];   // ← undefined["data"] throws TypeError
    err["name"] = exception["error"];
    error = new errorUtils(exception["message"], exception["statusCode"]);
}
```

`isAxiosError` is `true` for network failures (timeout, DNS, ECONNREFUSED) where `err.response` is `undefined`. The deref throws inside the error-handling middleware; Express cannot route it to another handler and the client gets an HTML stack trace instead of JSON.

**Fix:**

```js
if (err.isAxiosError) {
    const exception = err.response && err.response.data;
    error = exception && typeof exception === "object"
        ? new errorUtils(exception.message || "Upstream request failed", exception.statusCode || 502)
        : new errorUtils("Upstream service unavailable", 502);
}
```

---

### High-4: `console.log(err)` dumps full error object including axios request bodies

**Severity:** High  
**Package:** admin  
**File:** `packages/admin/src/middleware/error.js:9-11`

```js
if (err.message !== "You are lost here") {
    console.log(err);  // ← full object, including err.config.data (request body with tokens/OTPs)
}
```

The error object for an axios failure carries `err.config.data` — the serialised outbound request body with tokens, OTPs, and credentials. This lands in stdout → CloudWatch, retained and broadly readable.

Also: the guard string is stale — the 404 handler throws `"Ohh!!\n You are lost"` (`index.js:180`), not `"You are lost here"`, so every 404 logs a full object.

Delivery and picking already fixed this with a sanitized record (`{ name, message, statusCode, path, method }` plus stack only in non-prod).

**Fix:** Port delivery's `logRecord` block verbatim; delete the stale string comparison.

---

### High-5: Error handler re-sets permissive CORS headers, bypassing the allowlist

**Severity:** High  
**Package:** admin  
**File:** `packages/admin/src/middleware/error.js:53-54`

```js
res.set("Access-Control-Allow-Origin", req.header("Origin"));      // ← reflects ANY origin
res.set("Access-Control-Allow-Credentials", true);
```

Unconditional — reflects whatever Origin the caller sends on every error response, overwriting the strict policy at `index.js:127-152` (`haper.in` / `*.haper.in` / `localhost:5173` only).

Delivery and picking deleted both lines.

**Fix:** Delete both lines. `cors()` already sets correct headers on error responses.

---

### High-6: Mongo connection failure is swallowed — service boots with no database

**Severity:** High  
**Package:** admin, delivery, picking  
**File:** `packages/admin/src/connections/mongo.js:157-159` (identical in delivery `:50-52`, picking `:18-20`)

```js
} catch (error) {
    console.log(`Mongo Error - ${error}`);
}
```

`connectDb()` is awaited at `index.js:192` before routes are registered and immediately before `app.listen(...)`. A caught-and-logged failure means `start()` resolves normally, the port binds, and the health check passes — while every real request 500s. Under a rolling deploy, an instance that cannot reach Atlas is indistinguishable from a healthy one.

The catch also swallows `dbSafetyUtils.assertSafeMongoDbUri` — the guard that stops tests pointing at a real cluster.

**Fix:** Log then rethrow (or `process.exit(1)`). Update `index.js`'s `start().catch(...)` to exit non-zero so PM2 restarts.

---

### High-7: Tenancy resolution is ad-hoc in ~30 route modules; the correct helper is used by 5

**Severity:** High  
**Package:** admin  
**File:** `packages/admin/src/middleware/inventory-context.js` (helpers) vs `routes/` (call sites)

`inventory-context.js` exports well-designed tenancy helpers — `resolveStoreId`, `resolveWarehouseId`, `assertStoreAccess`, `applyListScope` — with normalised comparisons, fail-closed defaults, and a 55-line precedence-rules comment.

Adoption: 5 files (`ledger`, `replenishment`, `transfer`, `warehouse`, and the middleware itself). Meanwhile the inline pattern `req.store ? req.store._id : null` appears **83 times** across `packages/admin/src`. Findings A1 and A2 are both instances of hand-rolled variants getting it wrong.

**Fix:** Treat A1/A2 as the first two of a migration. Convert route modules to `resolveStoreId(req, req.query.storeId)` / `applyListScope(req, filter)`, highest-value first (`analytics`, `order`, `items`, `pos`, `store`). Then add a lint rule that greps for the raw pattern and fails on new occurrences.

---

### High-8: Dead money-handling event listener with two divergent implementations

**Severity:** High  
**Package:** shared  
**File:** `packages/shared/events/order.handler.js:39` (dead) vs `:76` (live)

```js
// Dead: orderClosed (line 39–74)
orderClosed: async (order, ...) => { ... payout = 5%; ... }  // flat 5% referral
// Live: orderClosed3P_1P (line 76+)
orderClosed3P_1P: async (order, ...) => { ... payout = 3% first, 1% after; invoice minting; cap enforcement ... }
```

Only `orderClosed3P_1P` is registered (`emitter.js:9`). The dead twin has **zero** callers and has already diverged: flat 5% vs tiered 3%/1%, no invoice minting, no cap, no idempotent claim. A future "fix the referral rate" change landing in the dead twin would pass review and do nothing in production.

**Fix:** Delete `orderClosed` (`:39–74`). If history is needed, it belongs in git.

---

### High-9: `round2` money rounding redefined 10 times with 3 different semantics

**Severity:** High  
**Package:** shared  
**File:** `shared/utils/order-edit.utils.js:36`, `discount.utils.js:121`, `unit-price.utils.js:94`, `gift.utils.js:52`, `repositories/*`, `user/src/routes/order/controller.js:193`, `user/src/routes/cart/controller.js:32`

```js
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;      // shared A
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;                  // shared B (no EPSILON, null→0)
const round2 = (v) => Math.round((v == null || NaN) ? v : ...);                  // shared C (null passthrough)
```

Three genuinely different behaviours: EPSILON-corrected vs not, and `null → 0` vs `null → null`. The comment at `user/src/routes/order/controller.js:188-192` marks this as load-bearing — the sum is multiplied by 100 and sent to Razorpay, which rejects non-integer paise. Ten copies means a correctness fix reaches one call path and the other nine keep the old behaviour.

**Fix:** One exported `money.round2` in `shared/utils` with a single documented null policy; replace all ten. This is the highest-value DRY fix in scope because it is money, not style.

---

### High-10: `packages/shared/package.json` declares ZERO dependencies

**Severity:** High  
**Package:** shared  
**File:** `packages/shared/package.json:1-8`

```json
{ "name": "shared", "version": "1.0.0", ..., "main": "index.js", ... }
```

No `dependencies` key at all. Verified that shared actually requires: `mongoose`, `jsonwebtoken`, `crypto`, `ioredis`, `node-cache`, `moment-timezone`, `@aws-sdk/client-s3`, `razorpay`, `firebase-admin`, `nodemailer`, `pdfkit`, `sharp`, `axios`, `bcryptjs`. Every one resolves purely by npm workspace hoisting from root.

Result: this is the dependency-inversion layer that all six other packages consume, yet it declares no contract. Nothing stops a root-level dependency bump from breaking shared with no signal; `npm ls` cannot show what shared needs; and the package is not independently installable or testable. Inconsistent with its own consumers (`user`, `auth`, `cron` all correctly declare `"shared": "^1.0.0"`).

**Fix:** Declare shared's real runtime dependencies, pinned to the versions already resolved at the root.

---

### High-11: Order lifecycle events fire only on `save` / `findOneAndUpdate` — other paths silently skip callbacks

**Severity:** High  
**Package:** shared  
**File:** `packages/shared/models/orders.schema.js:500, :527, :578, :606`

Hooks are registered on `save` and `findOneAndUpdate` only. Mongoose does not run document middleware for `updateOne`, `updateMany`, `bulkWrite` or `findByIdAndUpdate`-via-`updateOne`.

Any path that closes an order through those methods silently skips referral cashback, invoice-number minting, customer push notification, and pick-task cancellation — with no error surfaced.

Current blast radius is contained (four call sites at `events/order.handler.js:90`, `:186`, `:225` and `cron/src/jobs/scheduled-release.js:235` deliberately avoid `CLOSED` writes), but the gap is real and nothing enforces that invariant.

**Fix:** (a) Add a guard so status writes cannot bypass hooked methods — best version is a repository-level `closeOrder()` chokepoint. (b) At minimum, document the constraint in the schema so the next `updateOne` author sees it. (c) Longer term, move the emit out of the schema into that chokepoint.

---

### High-12: CORS origin is a literal string that looks like a wildcard, with `credentials: true`

**Severity:** High  
**Package:** user  
**File:** `packages/user/index.js:54-60` + `packages/shared/config/index.js:117`

```js
corsOrigin: process.env.CORS_ORIGIN || "*.haper.in",   // default looks like a glob
cors({ origin: config.corsOrigin, methods: "...", credentials: true })
```

The `cors` package treats a string `origin` as an exact string comparison, not a glob. So the default `"*.haper.in"` matches no real origin, and browser CORS is effectively closed for every web client. Conversely, if `CORS_ORIGIN` is set to `"*"`, `credentials: true` alongside a wildcard is rejected by browsers outright.

Contrast `packages/auth/index.js:16-27, 58-79`, which does this correctly with a validator function that parses URLs and matches `hostname === "haper.in" || endsWith(".haper.in")`. Two services, same requirement, two implementations, one wrong.

**Fix:** Lift auth's `isAllowedCorsOrigin` into `shared/utils` and use it in both services. Worth fixing before haper-web goes live.

---

### High-13: `connectDb` failure does not stop the service (auth, user, cron)

**Severity:** High  
**Package:** auth, user, cron  
**File:** `packages/auth/src/connections/mongo.js:19-21` (identical in `user` `:128-130`, `cron` `:19-21`)

```js
} catch (error) {
    console.log(`Mongo Error - ${error}`);
}
```

The error is logged and swallowed. `await connectDb()` then resolves normally, `app.listen()` runs, and the service comes up healthy-looking with no database. Under PM2 with `autorestart: true`, there is no crash to restart from — it just serves errors indefinitely.

A cluster-wide connectivity blip leaves every service "up" and broken.

**Fix:** Rethrow and exit non-zero so PM2 restarts with backoff. Log at `console.error`.

---

### High-14: Emptied-order cancel refunds with no `computeRefundOwed` bound — double-payout risk

**Severity:** High  
**Package:** picking  
**File:** `packages/picking/src/routes/task/controller.js:72-95`

```js
const remainingFees = Math.max(0, Number(order.price) || 0);
if (prepaid && remainingFees > 0) {
    refundResult = await refundUtils.refundToWallet({ order, amount: remainingFees, ... });
}
```

The amount refunded is `order.price` with no check against what the customer actually paid. The sibling path in delivery does this check via `refundUtils.computeRefundOwed()`, which subtracts `alreadyRefunded`. Result: if the first cancel's item removal committed, the second cancel (backstop for all-OOS) re-runs the refund with no already-refunded subtraction — double-paying.

`refundToWallet` does not apply a cap internally; `cancelEmptiedOrder` is the only thing bounding the payout, and it doesn't.

**Fix:** Compute payout through the shared helper: `const owed = refundUtils.computeRefundOwed(order); const payout = Math.min(remainingFees, owed.amount);`. Add test: order where `refundedAmount` already equals captured total → `cancelEmptiedOrder` must refund 0.

---

### High-15: Error middleware overrides CORS with the raw request Origin (auth)

**Severity:** High  
**Package:** auth  
**File:** `packages/auth/src/middleware/error.js:53-54`

```js
res.set("Access-Control-Allow-Origin", req.header("Origin"));
res.set("Access-Control-Allow-Credentials", true);
```

Unconditional — reflects whatever Origin the client sent on every error response, overwriting the careful allow-list. Combined with credentials, any origin can read the body of an error response from the login service.

Same two lines exist in `packages/user/src/middleware/error.js:43-44`.

**Fix:** Delete both lines. `cors()` already sets correct headers.

---

### High-16: Error handler leaks 5xx detail in production (auth)

**Severity:** High  
**Package:** auth  
**File:** `packages/auth/src/middleware/error.js` vs `index.js:95-100`

```js
// auth/index.js:95-100 — outer: masks in production
res.status(statusCode).json({ error: process.env.NODE_ENV === 'production' ? "An unexpected error occurred." : err.message });

// auth/src/middleware/error.js:55-60 — inner: NO masking
res.status(error.statusCode || 400).json({ code: ..., message: error.message });  // raw message reaches client
```

Every `/auth/*` route error hits the inner handler, so the production masking is dead code. Raw `error.message` (Mongo index names, file paths, replica-set topology) reaches the client. The `user` twin fixed this; the fix was never ported.

**Fix:** Port `user/src/middleware/error.js` wholesale and remove the now-redundant outer handler.

---

### High-17: OTP rate-limit counter is non-atomic, unnamespaced, with magic numbers (auth)

**Severity:** High  
**Package:** auth  
**File:** `packages/auth/src/routes/otp/controller.js:14-25`

```js
let reqCount = await distributedCacheUtils.get(phoneNumber);          // bare phone, no prefix
if (reqCount && reqCount >= 2) return res.status(429)...
await distributedCacheUtils.set(phoneNumber, (reqCount || 0) + 1, smsUserReqExpiry * 60);  // read-modify-write, not atomic
```

Three problems. (1) Get-compare-set is not atomic; N concurrent requests all pass. (2) Key is bare phone with no prefix — can collide with unrelated values. (3) Threshold `2` and cooldown `2 * 60 * 1000` are bare magic numbers.

The `user` twin fixed (1) via atomic `setIfNotExists` (`user/.../otpCache.js:31-40`), noting SMS costs money and concurrency lets everyone send. Not ported.

**Fix:** Use `INCR` with TTL, prefix the key, and name the constants.

---

### High-18: `account-purge` cron job can loop forever on persistently failing row

**Severity:** High  
**Package:** cron  
**File:** `packages/cron/src/jobs/account-purge.js:38-80`

```js
do {
    batch = await UserModel.find({ status: DELETED_SOFT, deletedAt: { $lte: cutoff } }).limit(50).lean();
    if (!batch.length) break;
    for (const u of batch) {
        try { await UserModel.updateOne({ _id: u._id }, { $set: { status: DELETED_PERMANENT, ... } }); }
        catch (perUserErr) { console.error(...); }  // swallow, continue
    }
} while (batch.length === 50);   // relies on each row moving out of query predicate
```

The loop has no cursor, no offset — relies entirely on `updateOne` moving rows out. If 50 rows fail, they stay DELETED_SOFT, the next `find` returns the same 50, `batch.length === 50` is true, and the job spins in a tight loop forever. PM2 sees a healthy process.

Systemic causes are realistic: `{ phone: null, email: null }` interacts with partial unique indexes; `{ $unset: { deletedAt: "" } }` runs against docs with missing required-ish fields (see shared finding).

**Fix:** Track failed `_id`s and exclude them from the next `find` (`_id: { $nin: failedIds }`), plus a hard iteration cap. Escalate to `console.error` and stop once failures exceed threshold.

---

## Full Findings by Package

### Package: admin

**A1. `?storeId=` query param overrides auth-pinned store scope** | **Critical** | See above (Critical-1)

**A2. `crossStore=true` discards store scope** | **Critical** | See above (Critical-2)

**A3. `redactCostPrice` mounted on only 2 of 30 routers** | **High** | See above (High-1)

**A4. Default `statusCode` 400 makes production-redaction dead code** | **High** | See above (High-2)

**A5. Axios error branch assumes `err.response` exists** | **High** | See above (High-3)

**A6. `console.log(err)` dumps full error object** | **High** | See above (High-4)

**A7. Error handler re-sets permissive CORS headers** | **High** | See above (High-5)

**A8. Mongo connection failure is swallowed** | **High** | See above (High-6)

**A9. Admin connects advertising itself as `UserService`**  
**Severity:** Medium  
**File:** `packages/admin/src/connections/mongo.js:15-18`

```js
dbSafetyUtils.assertSafeMongoDbUri(config.mongoDbUri, { appName: config.adminApp });   // "AdminService" ✓
const dbClient = await mongoose.connect(config.mongoDbUri, { appName: config.userApp }); // "UserService" ✗
```

The safety assertion is tagged correctly; the actual driver connection is not. `appName` is what Atlas surfaces in slow-query logs and per-app metrics. Every expensive admin aggregation (profit tiles, COGS reports) is attributed to the customer-facing user API. Debugging an Atlas CPU spike will chase the wrong service.

**Fix:** `appName: config.adminApp`. One-word change. Same for cron → `config.cronApp`.

---

**A10. Two error handlers with two different response shapes**  
**Severity:** Medium  
**File:** `packages/admin/src/routes/index.js:68` vs `packages/admin/index.js:184-190`

Inner handler (in the router): `{ code, error, data, message, [errorType], [reason], [details] }`  
Outer handler (app level): `{ error: message }`

Delivery and picking have identical duplication, with `msg:` vs `message:` — so four distinct error envelopes across three services. Clients cannot write one error parser.

**Fix:** Pick one envelope, export from `packages/shared`, mount at app level in all three.

---

**A11. `SWAGGER_PASSWORD` read from `process.env` directly**  
**Severity:** Low  
**File:** `packages/admin/index.js:163,167`

Only direct `process.env.<SECRET>` read in all three packages; everything else goes through shared config. The fallback is silent — if unset, Swagger is skipped with no signal.

**Fix:** Move to `config.swaggerPassword`, log a warning when absent.

---

**A12. `x-store-id` header compared without case normalisation**  
**Severity:** Low  
**File:** `packages/admin/src/middleware/auth.js:53,88,106`

`Types.ObjectId.isValid()` accepts uppercase hex, but `.toString()` emits lowercase. A client sending its own store id in uppercase is 403'd.

The fix already exists in `middleware/inventory-context.js:25-27` (`normalizeId`), never back-ported.

**Fix:** Import `normalizeId` and use it on both sides.

---

**A13. Tenancy resolution is ad-hoc in ~30 route modules** | **High** | See above (High-7)

---

**A14. App bootstrap is copy-pasted across all three services**  
**Severity:** Medium  
**File:** `packages/admin/index.js`, `packages/delivery/index.js`, `packages/picking/index.js`

Byte-identical or near-identical: CORS callback, helmet config, morgan format, 404 handler, outer error handler, listen guard. Drift is already visible: admin's `helmet()` has no `hsts` block, while delivery and picking both set `maxAge: 31536000, includeSubDomains, preload`.

**Fix:** Extract `createApp({ serviceName, mountPath, routes, limiter })` into `packages/shared/http/` and have all three reduce to config + `start()`. Resolves A10 (one envelope) and A4/A6/A7 structurally.

---

**A15. Controllers reach past repository layer into Mongoose models**  
**Severity:** Medium  
**File:** 8 admin controllers: order, pos, transfer, product, discount-rule, replenishment, inventory-group, team

Controllers directly call `OrderModel.findOne()`, `ItemModel.findById()`, etc., bypassing the repository layer. Result: query shapes duplicated (`ItemModel.findOne({ _id, storeId }).select("name barcode")` in both transfer and replenishment), no single place to add tenancy filter or index-friendly projection, and controllers only testable against live Mongo.

**Fix:** Add missing repository methods (`ItemRepository.getNameAndBarcode()`, etc.) and convert. Prioritise transfer and replenishment.

---

**A16. `__permission` tag is written but never audited**  
**Severity:** Low  
**File:** `packages/admin/src/middleware/permission.js:54-56,71,93,113`

The comment asserts a boot-time audit ("does every route declare its required permission?") that does not exist. The safety net is claimed but not built.

**Fix:** Either build it (walk `router.stack`, fail on unsigned routes, ~15 lines) or delete the claim.

---

**A17. `markOrderAdmin` handler is 487 lines nested 7 levels deep**  
**Severity:** Medium  
**File:** `packages/admin/src/routes/order/controller.js:520-1006`

One `try` block handles: status-transition validation, refund clawback, per-item stock re-deduction, slot release, restock guard flags, audit write, notifications. Sibling offenders: `transfer/controller.js` (1194 lines), `procurement/controller.js` (1186), `store/controller.js` (1079), `items/controller.js` (1031).

No service layer anywhere — all orchestration lands in the controller, making compensation logic impossible to unit-test independently of HTTP.

**Fix:** Introduce `routes/<x>/service.js` for orchestration-heavy modules, move transaction bodies there. Start with `markOrderAdmin` and `cancelTransfer`.

---

**A18. Sequential per-row DB calls (N+1) in two admin endpoints**  
**Severity:** Medium  
**File:** `packages/admin/src/routes/warehouse/controller.js:99-112` and `routes/stock-alert/controller.js:34-58`

```js
for (const s of stores) {
    const wh = await WarehouseRepository.resolveServingWarehouse(s);   // one query per store
}
for (const g of groups) {
    const items = await InventoryGroupRepository.getActiveItemsForGroup(g._id, storeId);  // up to 100 serial queries
}
```

Both are `await`-in-`for`, so round-trips are serial. The `limit: 100` is hardcoded with no pagination passthrough.

**Fix:** Batch into a single `$in` query plus in-memory `Map` join (pattern: `delivery/order/controller.js:64`). Lift the 100 into a named constant and thread real pagination.

---

**Admin summary:** 2 Critical, 7 High, 6 Medium, 3 Low = **18 findings**

---

### Package: delivery

**D1. Hardcoded master OTP fallback closes any order** | **Critical** | See above (Critical-3)

**D2. Refund on emptied/cancel path not bounded by `computeRefundOwed`** | **High** |  
**File:** `packages/delivery/src/routes/order/controller.js:141-145` (correct pattern; defect is in picking P1)

Delivery does this right: `const owed = refundUtils.computeRefundOwed(order);` (captured + walletUsed − alreadyRefunded).

---

**D3. Validation failures return 403 instead of 400**  
**Severity:** Low  
**File:** `packages/delivery/src/routes/order/validator.js:38,52,60,68`

```js
if (error) return next(new errorUtils(error.message, 403));  // should be 400
```

A malformed `page` or out-of-range `lat` is a client input error (400), not authorization (403). Rider app cannot distinguish "re-login" from "bad field", so a validation regression can cause spurious logout.

Picking has the same pattern.

**Fix:** Change 403 → 400 in all validators. Check rider/picker clients for any `if (status === 403) logout()` handling.

---

**D4. `markDeliveryStatus` mixes six concerns in 250 lines**  
**Severity:** Medium  
**File:** `packages/delivery/src/routes/order/controller.js:202-453`

Performs: transition validation, OTP verification and brute-force counting, atomic status claim, stock restock with per-item error accounting, slot release, money refund, audit write, customer push, incentive upsert, address GPS backfill.

The compensation logic is careful and well-commented — `:330-343` correctly explains why refund must read the post-claim document while non-money compensations read the pre-claim snapshot. Precisely why it should not be buried 200 lines into an HTTP handler.

**Fix:** Extract `applyUndeliveredCompensations({ order, currentOrder, reason, actor })` into a service module, directly unit-testable.

---

**D5. Duplicated store-repopulation block (3×) and locally re-declared reason map**  
**Severity:** Medium  
**File:** `packages/delivery/src/routes/order/controller.js:439-446, :507-509, :573-580` and `:586-593`

Three near-identical copies of repopulation logic, one missing the `getStoreIdStr` guard. Locally re-declared enum `reasonLabels` must stay in lockstep with `DeliveryBoyConstant.rejectionReasons`; adding a reason to the constant silently produces raw snake_case in the admin push.

Also: `restockStatuses` at `:120` mirrors the admin controller's list by comment — a duplicated business rule maintained by comment.

**Fix:** Extract `repopulateStore(order)` and use in all three places. Move `reasonLabels` next to `rejectionReasons` in `shared/constants` as a `label` field. Move `restockStatuses` into shared constants.

---

**D6. Mixed error-return styles in one controller**  
**Severity:** Low  
**File:** `packages/delivery/src/routes/order/controller.js:224, :230, :527`

Direct `res.status(...).json({ msg: "..." })` vs `next(new errorUtils(...))` — roughly 10 direct returns vs 2 via handler. Direct responses skip centralized handler, so no `code` field, no sanitized logging, and no `req.log.error` entry.

**Fix:** Route all errors through `next(new errorUtils(...))` so the handler owns the envelope and logging.

---

**D7. Magic numbers: page size and port default**  
**Severity:** Low  
**File:** `packages/delivery/src/routes/order/controller.js:457` and `index.js:127`

```js
OrderRepository.getAllOrdersForDelivery(status, page, 10, ...);          // bare 10
config.deliveryPort || 3000;   // collides with admin's || 3000
```

The page size is unnamed and unconfigurable. The `3000` default collides with admin's, so two services without their port env vars fight over the same port.

**Fix:** `const DELIVERY_PAGE_SIZE = 10;` at module top. Give each service a distinct port default (delivery has `3005` precedent in picking).

---

**Delivery summary:** 1 Critical, 1 High, 2 Medium, 3 Low = **7 findings**

---

### Package: picking

**P1. Emptied-order cancel refunds with no `computeRefundOwed` bound** | **High** | See above (High-14)

**P2. Pre-transaction reads used as transaction preconditions (TOCTOU)**  
**Severity:** Medium  
**File:** `packages/picking/src/routes/task/controller.js:742-793` (`complete`), `:293-351` (`pick`)

```js
const owned = await loadOwnedTask(taskId, req);          // outside session, may read stale secondary
const pending = (owned.task.lines || []).filter((l) => l.lineStatus === PENDING);
if (pending.length) { ...return 400... }
session.startTransaction({ readPreference: "primary" });  // after the check
```

The "all lines resolved" invariant is evaluated against a pre-transaction snapshot. `loadOwnedTask` uses `secondaryPreferred`, so may be a stale replica read. Same pattern gates the money path in `pick` — the line-status check outside the session is the only thing preventing double short-pick / double refund.

**Fix:** Make the claim atomic. `PickTaskRepository.updateLine` should take the expected prior `lineStatus` in its filter and return `null` on mismatch → 409.

---

**P3. `session.endSession()` reachable twice on post-commit error path**  
**Severity:** Low  
**File:** `packages/picking/src/routes/task/controller.js:400-402` and `:467-477`

```js
await session.commitTransaction();
committed = true;
session.endSession();              // :402

try { await ...; } catch (e) {
    if (!committed) { ... }
    session.endSession();          // :475 — runs again if anything after :402 throws
}
```

`endSession()` on an ended session is a no-op in the current driver, so impact is nil; the bug is latent. It will bite when someone adds an `await` in that window.

**Fix:** Wrap in `try { ... } finally { session.endSession(); }` once (see `delivery/.../controller.js:186-188` for the pattern).

---

**P4. Six near-identical notification blocks; three defensive existence checks on a static import**  
**Severity:** Medium  
**File:** `packages/picking/src/routes/task/controller.js:423-461, :639-667, :680-718`

Six copies of the same `notificationUtils.sendUserNotification(...).catch(...)` block differing only in title/body/type. Three defensive `if (notificationUtils.sendAdminStoreNotification)` checks — truthiness checks on properties of a statically `require`d module (imported at `:3`). Either the export exists (it does) or the import is broken and every other call would fail too. Dead defensive code.

**Fix:** `const notifyUser = (order, { title, body, data }) => notificationUtils.sendUserNotification(...).catch(...)` at module top; drop the three `if` guards.

---

**P5. `markOutOfStock` is 200 lines with five separate `endSession()` exits**  
**Severity:** Medium  
**File:** `packages/picking/src/routes/task/controller.js:532-735`

Opens session at `:533` — before any validation — then must remember to `session.endSession()` on each of five validation early-returns before the transaction even starts. Controllers are 48% of this package's 816 lines.

**Fix:** Move `session = await mongoose.startSession()` to just before `session.startTransaction()`, deleting five cleanup calls. Then extract the transaction body into a service function.

---

**P6. Connection module is the least-hardened of the three**  
**Severity:** Low  
**File:** `packages/picking/src/connections/mongo.js` (23 lines, vs delivery's 55, admin's 162)

No `ensureIndexesFor` call and no `missingIndexes` visibility check. Under `secondaryPreferred`, `Model.init()` resolves having created nothing — silently. If picking-side uniqueness is index-enforced, the same silent-no-build issue applies.

This is downstream of the known repo-wide `autoIndex` issue, so noted rather than scored as new.

**Fix:** Confirm whether any picking-side uniqueness is index-enforced. If so, add the `mongoIndexUtils.ensureIndexesFor([...]) + missingIndexes(...)` pair that delivery uses.

---

**P7. Validation failures return 403 instead of 400** | **Low** | Same as D3.

---

**Picking summary:** 0 Critical, 1 High, 3 Medium, 3 Low = **7 findings**

---

### Package: shared

**SHARED-1. Dead money-handling event listener** | **High** | See above (High-8)

**SHARED-2. Registered event listener with empty body**  
**Severity:** Low  
**File:** `packages/shared/events/login.handler.js:2-7`

```js
loggedIn: async (userId, UserRepo) => {
    try {
    } catch (err) {
        console.error('Error in logged-in event - ', err);
    }
},
```

Wired at `emitter.js:19` and fired on every OTP login. The try block is empty — a no-op wrapped in error handling for code that does not exist.

**Fix:** Remove the handler and the `emit("logged-in", ...)` call sites, or implement the intended last-login stamp.

---

**SHARED-3. Debug handler wired into production emitter**  
**Severity:** Low  
**File:** `packages/shared/events/test.handler.js:1-5`, registered at `events/emitter.js:8`

```js
greet: (name) => { console.log(`Hello, ${name}!`); }
```

Nothing emits `'greet'` anywhere. A console scaffold is loaded into the event bus of every running service.

**Fix:** Delete the file and the registration.

---

**SHARED-4. Developer smoke-test script shipped inside the dependency layer**  
**Severity:** Low  
**File:** `packages/shared/scripts/test-email.js:1-19`

A `#!/usr/bin/env node` SMTP smoke test instructing the reader to run it "with prod env loaded". Not referenced by any `package.json` script. A one-off operator tool does not belong in the shared library.

**Fix:** Move to repo-root `scripts/` directory.

---

**SHARED-5. Overly long modules**  
**Severity:** Medium  
**File:** `order.repository.js` (3,070 lines), `item.repository.js` (1,542), `discount.utils.js` (1,021)

`order.repository.js` alone is ~10% of shared's 29k source lines and mixes customer order listing, delivery-boy feeds, admin analytics aggregations, and serviceability polygon bootstrapping. Any change touches a file six other packages import.

**Fix:** Split by consumer along the seams that already exist (customer reads / operational reads / analytics aggregations).

---

**SHARED-6. Hardcoded OTP defaults in committed config**  
**Severity:** Medium  
**File:** `packages/shared/config/index.js:56-57`

```js
userRegistration: process.env.OTP_FOR_USER_REGISTRATION || "995518",
orderCompletion:  process.env.OTP_FOR_ORDER_COMPLETION  || "898444",
```

`userRegistration` is dead — only read by test files now; live OTP paths deliberately removed the fallback. `orderCompletion` is still live (delivery D1). A missing env var silently yields a known, committed, universally-valid code.

**Fix:** Delete the dead `userRegistration` key. Make `orderCompletion` env-required with no literal default.

---

**SHARED-7. `round2` money rounding redefined 10 times** | **High** | See above (High-9)

**SHARED-8. `const TZ = "Asia/Kolkata"` redefined in 20 files**  
**Severity:** Low  
**File:** 13 in shared, 7 in cron

The project's business timezone is a single fact with 20 copies; quoting even differs (`"..."` vs `'...'`). Has not drifted yet, which is luck.

**Fix:** Export from `shared/constants/general.constant.js`.

---

**SHARED-9. `packages/shared/package.json` declares ZERO dependencies** | **High** | See above (High-10)

---

**SHARED-10. `require: true` typo disables required-validation**  
**Severity:** Medium  
**File:** `packages/shared/models/users.schema.js:11`, `packages/shared/models/wallet.schema.js:7`

```js
sType: { type: Number, enum: Object.values(UserConstants.accountType), require: true },  // should be 'required'
```

Mongoose's option is `required`, not `require`. The unknown key is silently ignored, so `sType` is not enforced. Already documented downstream in login path — accounts exist with unset `sType`, fall through to `create()`, and crash on phone unique index with E11000.

**Fix:** Fix both to `required: true`, but audit existing rows first — flipping it on a collection that already contains `sType`-less documents will start rejecting writes to them.

---

**SHARED-11. `logs` collection has no indexes, no TTL, stores raw request headers**  
**Severity:** Medium  
**File:** `packages/shared/models/log.schema.js:4-11`

```js
{ type: Number, ..., userId: ObjectId, meta: Mixed }, { timestamps: { createdAt: true } }
```

No schema indexes anywhere. `LogRepository.add` is called on every Razorpay webhook (success and failure) with `body: req.body` and `header: req.headers`, persisting `x-razorpay-signature` into an unbounded, never-expiring collection. Any lookup by `userId` / `type` is a full collection scan.

**Fix:** Add `{ userId: 1, type: 1, createdAt: -1 }` and a TTL index on `createdAt`. Stop persisting `req.headers` (keep an explicit allow-list).

---

**SHARED-12. All six JWT secrets derived from one env var by string concatenation**  
**Severity:** Medium  
**File:** `packages/shared/config/index.js:24-33`

```js
jwtSecret: process.env.JWT_SECRET,
jwtSecretRefresh: process.env.JWT_SECRET + "_ReFrEsH_9999_",
jwtSecretForDeliveryBoy: process.env.JWT_SECRET + "_DeLiVeRy_2223_",
// etc.
```

The salts are public constants, so the derivation offers no key isolation: one `JWT_SECRET` disclosure yields admin, rider, picker, customer and refresh keys simultaneously. Rotating any one requires invalidating all sessions.

**Fix:** Separate env vars per audience (keep the current derivation as a documented fallback during rollout).

---

**SHARED-13. `authenticateAdmin` is the only auth middleware with no account-status check**  
**Severity:** Medium  
**File:** `packages/shared/utils/jwt.utils.js:304-328`

`authenticate` (user), `authenticateDeliveryBoy`, and `authenticatePicker` all check status with a 60s cache. `authenticateAdmin` does not: it verifies the signature and fingerprint, then `req.user = user; next();`. With `jwtExpiryForAdmin: "1d"`, a deactivated or deleted admin retains full access for up to 24 hours. Admin privileges are the highest in the system.

**Fix:** Mirror the picker implementation against the admins collection.

---

**SHARED-14. No logging library; 129 raw `console.*` calls in shared alone**  
**Severity:** Medium  
**File:** shared 129, cron 87, user 58, auth 10 (non-test)

Severity and format are carried by convention only. No structured logger. A per-request correlation id exists but nothing propagates it, so a CloudWatch search by request id will not find these logs.

**Fix:** Introduce one structured logger in shared with `requestId` bound, migrate error paths first.

---

**SHARED-15. `refCode` uniqueness is check-then-create against a unique index**  
**Severity:** Low  
**File:** `packages/shared/models/users.schema.js:71-84`

A read-then-write loop guarded by a unique index. Two concurrent signups can generate the same code, both see no existing user, and the loser gets an E11000. Already handled downstream — `user/routes/auth/otpCache.js:55-58` rethrows E11000 on `refCode` and retries.

**Fix:** Catch E11000 on `refCode` inside the hook and retry the generation loop.

---

**SHARED-16. Order lifecycle events fire only on save / findOneAndUpdate** | **High** | See above (High-11)

---

**SHARED-17. Repositories mix data access with business rules**  
**Severity:** Medium  
**File:** `order.repository.js:4-5, :93-95, :111, :212-220`

The "repository" layer defines and applies policy — which order statuses count as ACTIVE vs PAST for customer list, which statuses mean "no longer holds its slot seat", which are "never-placed" payment-lifecycle states. This is domain logic living in the persistence layer. It does keep the rules in one shared place rather than duplicated per package.

**Fix:** Not worth a rewrite. Extract the status-set constants (`ACTIVE_LIST_STATUSES`, `HIDDEN_FROM_LIST_STATUSES`, `NOT_SPENT_STATUSES`) into `constants/order.constant.js` so policy is declared where the enum lives.

---

**Shared summary:** 0 Critical, 4 High, 8 Medium, 5 Low = **17 findings**

---

### Package: user

**USER-1. `order/controller.js` is 2,609 lines with ~1,800 lines of logic above the exports**  
**Severity:** High  
**File:** `packages/user/src/routes/order/controller.js:1-1805` (helpers), `:1806` (exports)

Everything before line 1806 is business logic: pricing, inventory reservation, slot/schedule policy, customer response sanitisation, coupon-checkout error mapping, client-version compatibility mapping.

Individual handlers are also long: `cancel` is 267 lines, `changeSlot` 263. Other controllers in the package are far smaller (cart 635, profile 589), so this is one file.

None of this logic is reachable from another package or testable without an HTTP request, and order flow is the highest-risk code.

**Fix:** Extract to `shared/utils` (pricing, schedule policy — delivery and admin need the same rules) and to a local `src/services/order.service.js` for the rest.

---

**USER-2. Dead endpoint whose entire body is commented out**  
**Severity:** Low  
**File:** `packages/user/src/routes/razorpay/controller.js:262-273`

```js
cancel: async (req, res, next) => {
    try {
        // const userId = req.user._id;
        // ...
        return res.status(200).json({ msg: "Acknowledged", data: {} });
}
```

`cancel` is not mounted, so it is fully dead. `validator.validateOrderAndSuccess` is defined but never referenced. `router.js:9` carries a commented-out `router.use(jwtUtils.authenticate)`.

**Fix:** Delete `cancel`, the unused validator, and the commented blocks. If the authenticate comment reflects a real decision, state that as a one-line comment instead.

---

**USER-3. Rate-limit comment contradicts the code**  
**Severity:** Low  
**File:** `packages/user/index.js:29-31`

```js
windowMs: 5 * 60 * 1000, // 5 minutes
max: 1000, // Limit each IP to 100 requests per windowMs
```

`max` is 1000, the comment says 100 — copy-pasted and not updated. The 10x discrepancy matters because `routes/auth/router.js:9-11` explicitly reasons about this exact number.

**Fix:** Fix the comment.

---

**USER-4. `round2` reimplemented locally**  
**Severity:** Medium  
**File:** `packages/user/src/routes/order/controller.js:193`, `packages/user/src/routes/cart/controller.js:32`

Both are byte-identical to shared implementations. Cart and checkout must agree on the displayed total to the paisa — they currently do by coincidence of identical copy-paste.

**Fix:** Import from shared (see SHARED-7 for the full fix).

---

**USER-5. CORS origin is a literal string that looks like a wildcard** | **High** | See above (High-12)

---

**USER-6. The same error handler is registered twice per request path**  
**Severity:** Medium  
**File:** `packages/user/src/routes/index.js:2,33` and `packages/user/index.js:16,76`

Both point at `src/middleware/error.js`. Express stops at the first handler, so the inner one handles everything under `/user` and the outer only ever sees the 404. Harmless, but "where is this error formatted?" has two answers.

**Fix:** Keep only the app-level registration.

---

**USER-7. Webhook failure path persists raw request headers, including the signature**  
**Severity:** Medium  
**File:** `packages/user/src/routes/razorpay/controller.js:29-34, :245-249`

```js
await LogRepository.add(LogConstant.logType.WEBHOOK_ERROR, null, {
    body: req.body,
    header: req.headers,     // includes x-razorpay-signature
});
```

The signature verification is correct; the issue is only the logging. The full header bag lands in the unindexed, un-TTL'd `logs` collection.

**Fix:** Log an explicit allow-list of header names.

---

**USER-8. Store/geo resolution driven by string path-prefix matching in middleware**  
**Severity:** Medium  
**File:** `packages/user/src/middleware/geo.js:16-47`

```js
if (req.method === "PATCH" && req.baseUrl === "/user" && (req.path === "/profile" || req.path === "/profile/")) { ... }
if (req.baseUrl === "/user" && (req.path.startsWith("/auth") || req.path.startsWith("/config") || ...)) { ... }
if (req.baseUrl === "/user" && req.path.startsWith("/order") && req.path !== "/order/place") { ... }
```

`getGeoAndStore` runs before all `/user` routes and decides per-route whether a store is required using hardcoded path strings, including trailing-slash special-casing and single-route exceptions. Renaming or adding a route silently changes its auth-adjacent behaviour, and the rules are invisible from the route definitions.

**Fix:** Invert it — make store resolution an opt-in middleware attached to routers that need it, rather than a global with an exception list.

---

**User summary:** 0 Critical, 2 High, 4 Medium, 2 Low = **8 findings**

---

### Package: auth

**AUTH-1. The "frozen" auth fork is still deployed** | **Critical** | See above (Critical-4)

**AUTH-2. Error middleware overrides CORS** | **High** | See above (High-15)

**AUTH-3. Error handler leaks 5xx detail in production** | **High** | See above (High-16)

**AUTH-4. Cart logic inside the auth service's error middleware**  
**Severity:** Low  
**File:** `packages/auth/src/middleware/error.js:43-45`

```js
if (err?.message && typeof err.message === "string" && err.message.startsWith("LIMIT_EXCEEDED:")) {
    res.set("X-Cart-Notice", "LIMIT_EXCEEDED");
}
```

`packages/auth` has no cart routes — its entire surface is health, google, otp, refresh. Copy-paste residue.

**Fix:** Delete.

---

**AUTH-5. Refresh endpoint checks neither token blacklist nor account status**  
**Severity:** Medium  
**File:** `packages/auth/src/routes/refresh/controller.js:13-31`

Verifies signature and device fingerprint, then mints a new access token from the refresh token's own payload. Never calls `jwtUtils.isBlacklisted` and never re-reads user status.

Consequence: a refresh token survives logout — `expire()` blacklists the access token only, so the matching refresh token keeps minting new access tokens for its full 30-day life. Also copies `avatar` and `name` out of the 30-day-old refresh token, so a user who changes their name keeps the stale one until re-login.

**Fix:** Check `isBlacklisted(refreshToken)` before issuing, and blacklist the refresh token on logout. Re-read `name`/`avatar` from the database.

---

**AUTH-6. `connectDb` failure does not stop the service** | **High** | See above (High-13)

---

**AUTH-7. OTP rate-limit counter is non-atomic** | **High** | See above (High-17)

---

**Auth summary:** 1 Critical, 4 High, 1 Medium, 1 Low = **7 findings**

---

### Package: cron

**CRON-1. `account-purge` cron job can loop forever** | **High** | See above (High-18)

**CRON-2. Cron's Mongo connection registers itself as the User service**  
**Severity:** Medium  
**File:** `packages/cron/src/connections/mongo.js:9-11`

```js
dbSafetyUtils.assertSafeMongoDbUri(config.mongoDbUri, { appName: config.cronApp });     // cronApp
const dbClient = await mongoose.connect(config.mongoDbUri, { appName: config.userApp }); // userApp (!)
```

The safety guard is told `cronApp` but the driver is told `userApp`. In Atlas, the cron process's queries are attributed to the User service. A slow nightly aggregation looks like customer-facing traffic.

**Fix:** `appName: config.cronApp`.

---

**CRON-3. Jobs scheduled at require-time, before DB connection established**  
**Severity:** Medium  
**File:** `packages/cron/index.js:4-10`

```js
require('./src/scheduler.js');       // line 5 — registers all cron.schedule() calls immediately
const start = async () => {
    await connectDb();               // line 8 — runs after
}
```

`require` executes `scheduler.js` synchronously at line 5, and `scheduler.js:23-24` schedules two jobs at `* * * * *`. `connectDb()` at line 8 is awaited afterwards. The first tick lands on the next minute boundary in practice, but nothing guarantees it. A slow DNS resolution or paused Atlas produces jobs firing against a disconnected mongoose.

**Fix:** Move `require('./src/scheduler.js')` inside `start()`, after `await connectDb()`.

---

**CRON-4. Cron reads from secondaries**  
**Severity:** Medium  
**File:** `packages/cron/src/connections/mongo.js:12` — `readPreference: "secondaryPreferred"`

Writes always route to primary, so write correctness is fine; the risk is on candidate-selection reads. A job that reads a stale document from a lagging secondary and acts on it can do duplicate or wrong work. `scheduled-release.js:227` is aware and pins its transaction with `{ readPreference: 'primary' }` — the right fix, proving the concern is real.

Other jobs (`pick-task-reconcile.js`, `payment-initiated-orders.js`, `account-purge.js`, `return-approval-expiry.js`) do not.

**Fix:** Pin candidate-selection reads in the mutating jobs to `primary`, following the pattern `scheduled-release.js` already established.

---

**CRON-5. No distributed lock; single-instance PM2 is the only thing preventing double-fire**  
**Severity:** Medium  
**File:** `ecosystem.config.js:44-50` (`instances: 1, exec_mode: 'fork'`), `packages/cron/src/scheduler.js:23-78`

Correctness rests on that PM2 config. `shared/utils/lockUtils.js` provides a Redis lock, used only by `cart.repository.js:155, :333` — no cron job takes a lock. The risk is one `instances: 2` edit, one blue/green overlap, one manual `node packages/cron/index.js` away.

Credit: per-job idempotency is well-considered — `scheduled-release.js:15-30` documents a compare-and-set claim; `scheduled-reminders.js:12-28` reasons through two designs; others state their idempotency argument. But node-cron has no overlap protection *within a single process*: `inventory-evaluation-sweep.js` runs every 15 minutes with no guard; `daily-profit-snapshot.js` recomputes a rolling window with no run lock.

**Fix:** Wrap `cron.schedule` in a small helper that takes a Redis lock keyed on the job name (TTL ≈ 2x expected runtime) and skips the tick if held.

---

**CRON-6. Job failures are invisible outside the log file**  
**Severity:** Medium  
**File:** Every job's outer catch (e.g. `account-purge.js:78-80`)

Every job swallows its top-level error into `console.error` and returns normally. No alerting, no failure counter, no metric, no non-zero exit. PM2 merges all output into one file (`merge_logs: true`), so a nightly job failing for a week looks identical to one succeeding.

The impact is quantified in the codebase itself: `daily-profit-snapshot.js:12-16` records that a silent gap cost "67 orders, ₹9,665 of revenue and ₹1,158 of profit lost across nine days before anyone noticed".

**Fix:** A shared job wrapper that records last-run/last-success/duration/error per job name to a small collection, surfaced on an admin screen. Turns every silent failure into something visible.

---

**CRON-7. `inventory-daily-digest` issues N+1 queries**  
**Severity:** Low  
**File:** `packages/cron/src/jobs/inventory-daily-digest.js:11-27`

```js
for (const storeId of storeIds) {
    const redGroups = await InventoryGroupRepository.listRedGroupsForStore(storeId);  // one per store
    for (const group of redGroups) {
        const items = await InventoryGroupRepository.getActiveItemsForGroup(group._id);  // one per group
    }
}
```

At today's store count (1, with Chapra coming) this is immaterial. It scales linearly with stores × red groups and runs once daily, so it is a watch-item, not a problem.

**Fix:** Leave it; revisit past ~20 stores.

---

**CRON-8. Env var read directly instead of through shared config**  
**Severity:** Low  
**File:** `packages/cron/src/jobs/inventory-reservation-expiry.js:11`

```js
const EXPIRY_DAYS = Number(process.env.RESERVATION_EXPIRY_DAYS) || 7;
```

Every other tunable goes through `shared/config/index.js`; this one reaches for `process.env` directly, so it is absent from `.env.example` and invisible to anyone reading the config file.

**Fix:** Move both into `shared/config`.

---

**Cron summary:** 0 Critical, 1 High, 5 Medium, 2 Low = **8 findings**

---

## Cross-Cutting Patterns

### 1. Fix-forward drift: delivery and picking were hardened, admin was not

Six pre-reported items (A4–A8, plus CORS echo) are cases where delivery and picking carry the corrected code *with comments explaining the fix*, and admin still has the original. `packages/delivery/src/middleware/error.js:5-17` is effectively a changelog of what admin still needs.

Admin is the largest, most privileged, and most internet-exposed of the three — the worst one to leave behind. **Port delivery's `error.js` to admin wholesale**; it is the single highest-value change in this report and it is nearly a copy-paste.

### 2. Security controls at partial adoption

Three separate controls exist, are well-written and well-documented, and are applied to a minority of their surface:
- `redactCostPrice` — 2 of 30 routers (A3)
- `inventory-context.resolveStoreId` / `applyListScope` — 5 of ~30 route modules (A13)
- `normalizeId` case-normalisation — used in `inventory-context.js`, not in `auth.js` (A12)

A1 and A2 are the direct consequence of unconverted call sites. **For each of the three, either finish the adoption or add a check that fails on new unconverted call sites** — a half-adopted control is more dangerous than none, because it reads as "handled."

### 3. Copy-pasted bootstrap, already drifting

`index.js` is ~85% identical across all three services (A14), and drift has begun: admin is missing the `hsts` block that delivery and picking both have. Every error-handler fix in this report has to be applied three times. **Extract `createApp()` into `packages/shared/http/`.**

### 4. Four error envelopes across three services

Admin inner: `{code, error, data, message, [errorType], [reason], [details]}`  
Delivery/picking inner: `{code, error, data, msg}`  
All three outer: `{error}`

Plus ~10 direct `res.status(...).json({msg})` returns in delivery/picking that bypass the handler entirely. **One envelope, exported from shared, mounted at app level.**

### 5. Boot proceeds on DB failure in all three services

Identical `catch { console.log(...) }` at `admin/.../mongo.js:157`, `delivery/:50`, `picking/:18` (A8). It also disarms `dbSafetyUtils.assertSafeMongoDbUri`. **Rethrow and exit non-zero.**

### 6. No service layer anywhere

Structure is uniformly `routes/<x>/{router,controller,validator}.js`; all orchestration, transaction management, money math, and notification fan-out lives in controllers. Result: 1661/1194/1186-line admin controllers, a 487-line `markOrderAdmin`, a 250-line `markDeliveryStatus`, a 200-line `markOutOfStock` — none testable below the HTTP layer. This is why transaction-boundary findings (P2, P3) are hard to see in review. **Add `service.js` to the transaction-heavy modules first** (`admin/order`, `admin/transfer`, `delivery/order`, `picking/task`).

### 7. Secrets with hardcoded fallbacks

`shared/config/index.js:56-57` ships working default OTPs (D1). Worth grepping the rest of `shared/config` for the `process.env.X || "<literal>"` pattern — if the OTPs have it, other secrets may too.

### 8. Good practice worth preserving

Not everything here is a finding:
- Money handling in POS is careful — `round2` applied to the *sum* with a comment explaining the binary-tail reason (`admin/routes/pos/controller.js:345-350`); FEFO cost snapshotted at sale; index-alignment assertion on coupon pricing.
- `redactCostPrice` redacts a JSON-safe clone with cyclic-ref reasoning documented.
- Optimistic-concurrency-via-filter is used consistently instead of transactions where contention existed, with reason recorded.
- The `// 🚨` convention marking load-bearing hazards is genuinely useful.

Protect these while fixing the rest.

### 9. Fork-and-freeze without decommissioning

The `auth` → `user` migration produced a hardened twin and left the un-hardened original running in prod. Comments say "frozen"; PM2 manifests say "deployed". Every fix applied since then is a gap on the other. **"Frozen" must mean removed from the deployment manifest, or it means "unmaintained and live".**

### 10. Copy-paste as the reuse mechanism

`round2` (10 copies, 3 semantics), `TZ` (20 copies), `connections/mongo.js` (3 near-identical copies carrying the same swallowed-error bug) — all caught by the same habit: when about to duplicate, put it in shared.

### 11. Errors are logged, never raised

The dominant idiom across all four packages is `try { ... } catch (e) { console.error(e) }` with execution continuing. Right for best-effort work (telemetry, cache writes); wrong for the boot path (services start with no database) and for jobs (a week of failures is invisible). No logger, no severity discipline, no alerting anywhere in scope.

**If one investment is made off this audit, make it this one:** a structured logger plus a cron run-ledger converts an entire class of silent failures into visible ones. The profit-snapshot incident (₹9,665 lost over nine unnoticed days) is the proof.

---

## Recommended Remediation Ownership

| Finding clusters | Specialist role | Action | Notes |
|---|---|---|---|
| Tenant isolation (A1, A2, A13), hardcoded OTP (D1) | navjot-security (audit) → sumit-backend (fix) | Re-audit A1, A2 for edge cases; define the tenancy resolution strategy; set `frontend/backend` rotation for D1 | These are the money paths |
| Error handling (A4, A5, A6, A7, A10), CORS (A7, AUTH-2, USER-5) | sumit-backend | Port delivery's error.js to admin; extract shared error envelope; fix both CORS header reflections | A10 blocks D6 |
| `packages/auth` decommissioning decision | product (decision) → sumit-backend + kiran-git (execution) | Decide: remove from both PM2 manifests and delete, or un-freeze and port seven gaps | AUTH-1 blocks AUTH-2, AUTH-3, AUTH-6, AUTH-7 |
| DB connection boot failures (A8, AUTH-6, CRON-3) | sumit-backend | Rethrow and exit non-zero in all three services; update `start().catch()` | Affects all three services |
| `packages/shared` dependency declaration and DRY | sumit-backend | Declare real dependencies in shared/package.json; consolidate `round2`, `TZ`, `connections/mongo.js` | Unblocks SHARED-1, SHARED-7, SHARED-8 |
| Tenancy helpers adoption (A12, A13) | sumit-backend | Migrate ~30 call sites to `resolveStoreId`; add lint rule | Compounds A1/A2 |
| Copy-pasted bootstrap and error handlers (A14, D4, D5) | sumit-backend | Extract `createApp()` to `packages/shared/http/`; one error envelope | High value, applies to all three services |
| Mongo index visibility (A8, P6) | sumit-backend | Confirm picking uniqueness is not index-enforced; add `ensureIndexesFor` if needed | Downstream of repo-wide `autoIndex` issue |
| Service layer extraction (A17, A18, D4, P2, P5) | sumit-backend | Move transaction bodies and orchestration out of controllers; start with `admin/order`, `delivery/order`, `picking/task` | Enables unit testing of compensation logic |
| Money invariants (P1, SHARED-1, SHARED-7) | sumit-backend | Delete dead `orderClosed`; consolidate `round2`; add test: double-cancel must refund 0 | Critical path; needs second reviewer |
| Cron idempotency and observability (CRON-1, CRON-5, CRON-6) | tejas-services | Add distributed lock wrapper; implement run-ledger with alerting; fix `account-purge` loop | Visibility is the first step |
| JWT secrets isolation (SHARED-12) | navjot-security (decision) → sumit-backend (execution) | Decide: separate env vars or acceptance of current fallback rotation model | Deployment scope |
| Logging infrastructure | sumit-backend (with tejas-services input on monitoring) | Introduce structured logger in shared with `requestId` binding; migrate error paths | Medium priority, unlocks visibility for everything above |
| Event lifecycle gaps (SHARED-16) | sumit-backend | Add `closeOrder()` chokepoint in repository; document `updateOne` constraint in schema | Prevents silent notification/cashback skip |

---

## Known-Issue Cross-References

The hardcoded master OTP finding (D1, Critical-3) is a re-confirmation of a previously-known open item: "master-OTP gate" was flagged in an earlier backend security audit and remains unresolved. Its severity and impact are stated in full above; this audit independently verified that it is still live in the committed code and in production/dev PM2 manifests.

The `autoIndex: false` issue under `secondaryPreferred` (noted in P6, CRON-4) is a known, documented platform limitation that affects multiple packages. Index-build gaps are flagged where they surface (picking connection module, cron) rather than as new findings, but their real-world impact (schema-level constraints not enforced) should inform the priority of the connection-hardening work.

---

## Summary Counts by Severity

| Severity | Count | Packages |
|---|---|---|
| **Critical** | 4 | admin (2), delivery (1), auth (1) |
| **High** | 20 | admin (7), delivery (1), picking (1), shared (4), user (2), auth (4), cron (1) |
| **Medium** | 29 | admin (6), delivery (2), picking (3), shared (8), user (4), auth (1), cron (5) |
| **Low** | 19 | admin (3), delivery (3), picking (3), shared (5), user (2), auth (1), cron (2) |
| **TOTAL** | **72** | |

---

## Overall Assessment

The codebase is sound on its core logic — money handling, concurrency, order lifecycle — and genuinely well-considered in several places. The findings are overwhelmingly about infrastructure, hygiene, and incomplete adoption of existing controls rather than algorithmic failures.

The highest-value changes are: (1) deciding the fate of `packages/auth`, (2) consolidating error handling and bootstrap across three services, (3) finishing the adoption of tenancy-resolution helpers, (4) making DB connection failures fatal, and (5) introducing structured logging + cron observability.

The pattern worth fixing immediately and institutionalising: copy-paste into shared, not into parallel implementations.
