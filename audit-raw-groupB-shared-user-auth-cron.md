# Backend Code Quality Audit — shared / user / auth / cron

Read-only audit. Scope: `packages/shared`, `packages/user`, `packages/auth`, `packages/cron`.
Every finding below was verified against the working tree at the stated file:line.
Committed `coverage/` output was excluded from all counts and greps.

**Headline:** the single most consequential finding is cross-package and is recorded under
`## Package: auth` → **AUTH-1**. `packages/auth` is documented in six separate source comments as
"frozen — do not port fixes back there", but it is still listed in **both** PM2 manifests, so the
un-hardened twin of the customer login flow is a live, public, unauthenticated endpoint.

---

## Package: shared

### Findings — Quality / Cleanliness

**Dead money-handling twin: `orderClosed` is exported but never wired** | **High** |
`packages/shared/events/order.handler.js:39` (dead) vs `:76` (live)

```js
// order.handler.js:39
orderClosed: async (order, OrderModel, UserModel, WalletModel, LogModel) => { ... }
// order.handler.js:76
orderClosed3P_1P: async (order, OrderModel, UserModel, WalletModel, LogModel) => { ... }
// emitter.js:9 — only ONE of them is registered
eventEmitter.on('order-closed', orderHandler.orderClosed3P_1P);
```

Verified: a repo-wide grep for `orderClosed` returns only `emitter.js:9`, the two definitions
themselves, and two test files that call `orderClosed3P_1P` directly. `orderClosed` has **zero**
callers and zero listeners. `"order-closed"` is emitted from exactly one place
(`models/orders.schema.js:606`), and `orderClosed3P_1P` is its only listener.

Why it matters: both functions are referral-cashback / wallet-credit code, i.e. real money. They
have already diverged — the dead one pays a flat 5% (`:48`), the live one pays 3% on first order
and 1% after (`:118`), and the live one additionally mints the invoice number, enforces the monthly
cap, and claims the order idempotently. The dead twin has none of that. A future "fix the referral
rate" change that lands in the twin at `:39` would pass review, pass tests, and silently do nothing
in production.

Recommendation: delete `orderClosed` (`:39`–`:74`). If it must be retained for history, it belongs
in git, not in the module export.

---

**Registered event listener with an empty body** | **Low** |
`packages/shared/events/login.handler.js:2-7`

```js
loggedIn: async (userId, UserRepo) => {
    try {
    } catch (err) {
        console.error('Error in logged-in event - ', err);
    }
},
```

Wired at `events/emitter.js:19` and fired on every successful OTP login
(`packages/auth/src/routes/otp/controller.js:113`, `packages/user/src/routes/auth/otp/controller.js`).
The try block is empty — the handler is a no-op wrapped in error handling for code that does not
exist. Recommendation: remove the handler and the `emit("logged-in", ...)` call sites, or implement
the intended last-login stamp.

---

**Debug handler wired into the production emitter** | **Low** |
`packages/shared/events/test.handler.js:1-5`, registered at `events/emitter.js:8`

```js
greet: (name) => { console.log(`Hello, ${name}!`); }
```

Nothing anywhere emits `'greet'` (verified by grep across all seven packages). A `console.log`
scaffold is loaded into the event bus of every running service. Recommendation: delete the file and
the `emitter.js:8` registration.

---

**Developer smoke-test script shipped inside the dependency layer** | **Low** |
`packages/shared/scripts/test-email.js:1-19`

A `#!/usr/bin/env node` SMTP smoke test whose usage block instructs the reader to run it "from repo
root **with prod env loaded**" and shows inline `SMTP_USER=... SMTP_PASS=...`. It is not referenced
by any `package.json` script. A one-off operator tool does not belong in the shared library every
service imports. Recommendation: move to the repo-root `scripts/` directory alongside the migration
runner.

---

**Overly long modules** | **Medium** |
`packages/shared/repositories/order.repository.js` (3,070 lines),
`packages/shared/repositories/item.repository.js` (1,542),
`packages/shared/utils/discount.utils.js` (1,021)

`order.repository.js` alone is ~10% of the package's 29k source lines and mixes customer order
listing, delivery-boy feeds, admin analytics aggregations (`:654`, `:725`, `:1220`, `:1286`), and
serviceability polygon bootstrapping (`:322`). Any change to it touches a file six other packages
import. Recommendation: split by consumer along the seams that already exist in the file
(customer reads / operational reads / analytics aggregations).

---

**Hardcoded OTP defaults in committed config** | **Medium** |
`packages/shared/config/index.js:56-57`

```js
userRegistration: process.env.OTP_FOR_USER_REGISTRATION || "995518",
orderCompletion:  process.env.OTP_FOR_ORDER_COMPLETION  || "898444",
```

`userRegistration` is **dead** — grep shows it is read only by test files now; the live OTP paths
deliberately removed the master-code fallback (`packages/user/src/routes/auth/otpCache.js:15-18`:
"there is deliberately no master/static fallback"). `orderCompletion` is still live, read at
`packages/delivery/src/routes/order/controller.js:241` (out of scope, but the constant is owned
here). A literal fallback value means a missing env var silently yields a known, committed,
universally-valid code rather than a boot failure. Recommendation: delete the dead
`userRegistration` key; make `orderCompletion` env-required with no literal default.

### Findings — Reusability / DRY

**`round2` money rounding is redefined 10 times with 3 different semantics** | **High** |
8 definitions in `shared`, 2 in `user`

```js
shared/utils/order-edit.utils.js:36      const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
shared/utils/discount.utils.js:121       const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
shared/utils/unit-price.utils.js:94      const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;   // no Number()
shared/utils/gift.utils.js:52            const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;        // no EPSILON, null→0
shared/repositories/stock-movement.repository.js:50  (Number(n) || 0) + EPSILON
shared/repositories/store-batch.repository.js:43     (v == null || NaN) ? v : ...   // no EPSILON, null passthrough
shared/repositories/warehouse-batch.repository.js:31 (same null-passthrough variant)
user/src/routes/order/controller.js:193  const round2 = ...
user/src/routes/cart/controller.js:32    const round2 = ...
```

Three genuinely different behaviours for the same-named function: EPSILON-corrected vs not, and
`null → 0` vs `null → null` vs `null → 0` via `Number(null)`. The comment at
`user/src/routes/order/controller.js:188-192` marks this as load-bearing for payments — the summed
value is multiplied by 100 and sent to Razorpay, which rejects a non-integer paise amount. It also
sits directly on the `costPrice` 2dp money invariant. Ten copies means a correctness fix reaches one
call path and the other nine keep the old behaviour.

Recommendation: one exported `money.round2` in `shared/utils` with a single documented null policy;
replace all ten. This is the highest-value DRY fix in the scope because it is money, not style.

---

**`const TZ = "Asia/Kolkata"` redefined in 20 files** | **Low** |
13 in `shared` (e.g. `utils/gift.utils.js:29`, `repositories/order.repository.js:11`), 7 in `cron`
(e.g. `src/scheduler.js:21`, `src/jobs/account-purge.js:25`)

The project's business timezone is a single fact with 20 copies, and the quoting even differs
(`"Asia/Kolkata"` vs `'Asia/Kolkata'`). It has not drifted yet, which is luck. Recommendation:
export from `shared/constants/general.constant.js`.

### Findings — Best Practices

**`packages/shared/package.json` declares ZERO dependencies** | **High** |
`packages/shared/package.json:1-8` (entire file)

```json
{ "name": "shared", "version": "1.0.0", "description": "", "main": "index.js",
  "author": "Mr Verma", "license": "ISC" }
```

No `dependencies` key at all. Verified that shared actually requires, at minimum: `mongoose`
(every model), `jsonwebtoken` + `crypto` (`utils/jwt.utils.js:1-2`), `ioredis`
(`utils/distributed-cache.utils.js:36`), `node-cache` (`:1`), `moment-timezone`
(`events/order.handler.js:1`), plus `@aws-sdk/client-s3`, `razorpay`, `firebase-admin`,
`nodemailer`, `pdfkit`, `sharp`, `axios`, `bcryptjs`. Every one of these resolves purely by npm
workspace hoisting from the root `package.json`.

Why it matters: this is the dependency-inversion layer that all six other packages consume, and it
declares no contract. Nothing stops a root-level dependency bump or removal from breaking shared
with no signal; `npm ls` cannot show what shared needs; and the package is not independently
installable or testable. It is also inconsistent with its own consumers — `packages/user`,
`packages/auth` and `packages/cron` all correctly declare `"shared": "^1.0.0"`.

Recommendation: declare shared's real runtime dependencies, pinned to the versions already
resolved at the root, and keep the root as the single place versions are bumped.

---

**`require: true` typo disables required-validation (two occurrences)** | **Medium** |
`packages/shared/models/users.schema.js:11`, `packages/shared/models/wallet.schema.js:7`

```js
// users.schema.js:11
sType: { type: Number, enum: Object.values(UserConstants.accountType), require: true },
// wallet.schema.js:7
_id: { type: mongoose.Types.ObjectId, require: true, ref: "users" },
```

Mongoose's option is `required`, not `require`; the unknown key is silently ignored, so `sType` is
not enforced. This is not theoretical — the downstream damage is already documented in the login
path at `packages/auth/src/routes/otp/controller.js:55-62`: accounts exist with an unset `sType`,
and the original `sType`-scoped lookup missed them, fell through to `create()`, and crashed on the
phone unique index with E11000, "blocking login for anyone whose account wasn't sType=PHONE".

Recommendation: fix both to `required: true`, but **audit existing rows first** — flipping it on a
collection that already contains `sType`-less documents will start rejecting writes to them.

---

**`logs` collection has no indexes, no TTL, and stores raw request headers** | **Medium** |
`packages/shared/models/log.schema.js:4-11` (no `schema.index()` anywhere in the 12-line file)

```js
{ type: Number, ..., userId: ObjectId, meta: Mixed }, { timestamps: { createdAt: true } }
```

Two consequences. (1) Growth: `LogRepository.add` is called on every Razorpay webhook —
success **and** failure — at `packages/user/src/routes/razorpay/controller.js:29`, `:40`, `:245`,
with `body: req.body` and, in two of the three, `header: req.headers`. That persists the
`x-razorpay-signature` header into an unbounded, never-expiring collection. (2) Reads: the referral
audit trail writes `type` + `userId` rows here (`events/order.handler.js:66-70`) and any lookup by
those fields is a full collection scan.

Recommendation: add `{ userId: 1, type: 1, createdAt: -1 }` and a TTL index on `createdAt` for the
webhook log types; stop persisting `req.headers` (keep an explicit allow-list of header names).

---

**All six JWT secrets are derived from one env var by string concatenation** | **Medium** |
`packages/shared/config/index.js:24-33`

```js
jwtSecret:                       process.env.JWT_SECRET,
jwtSecretRefresh:                process.env.JWT_SECRET + "_ReFrEsH_9999_",
jwtSecretForDeliveryBoy:         process.env.JWT_SECRET + "_DeLiVeRy_2223_",
jwtSecretForAdmin:               process.env.JWT_SECRET + "_aDmIn_2122_",
jwtSecretForPicker:              process.env.JWT_SECRET + "_PiCkEr_3301_",
```

The stated intent (comment at `:29-31`) is audience separation — a picker token must not replay as
an admin token — and the distinct salts do achieve that. But the salts are public constants in the
repository, so the derivation offers **no** key isolation: one `JWT_SECRET` disclosure yields the
admin, rider, picker, customer and refresh signing keys simultaneously, and rotating any one of them
is impossible without invalidating all sessions everywhere at once.

Recommendation: separate env vars per audience (keep the current derivation as a documented
fallback during rollout so no session is invalidated at cutover).

---

**`authenticateAdmin` is the only auth middleware with no account-status check** | **Medium** |
`packages/shared/utils/jwt.utils.js:304-328`

`authenticate` (user) checks status at `:146-152`, `authenticateDeliveryBoy` at `:199-226`,
`authenticatePicker` at `:267-291` — each with a 60s cache, and each documented with the reason
("without this, a deactivated rider keeps a valid access token for up to 24 hours").
`authenticateAdmin` has no equivalent block: it verifies the signature and fingerprint at
`:312-321`, then `req.user = user; next();`. With `jwtExpiryForAdmin: "1d"`
(`config/index.js:38`), a deactivated or deleted admin retains full access for up to 24 hours.
Admin privileges are the highest in the system, so this is the one place the check is most needed.

Recommendation: mirror the picker implementation against the admins collection.

---

**No logging library; 129 raw `console.*` calls in shared alone** | **Medium** |
shared 129, cron 87, user 58, auth 10 (non-test source). No `winston` / `pino` / `bunyan` anywhere.

Severity and format are carried by convention only — `console.log` is used for genuine errors
(`packages/cron/src/connections/mongo.js:20`: `console.log(\`Mongo Error - ${error}\`)`) while
`console.error` is used for routine summaries (`scheduler.js:70`). There is a per-request
correlation id (`utils/requestId.js`, surfaced in the morgan format string) but nothing propagates
it into these log lines, so a CloudWatch search by request id will not find them. Recommendation:
introduce one structured logger in shared with `requestId` bound, and migrate the error paths first.

---

**`refCode` uniqueness is check-then-create against a unique index** | **Low** |
`packages/shared/models/users.schema.js:71-84`

```js
uniqueRefId = crypto.randomBytes(3)...toUpperCase();
const existingUser = await mongoose.models.users.findOne({ refCode: uniqueRefId });
```

A read-then-write loop guarded by a unique index at `:63`. Two concurrent signups can generate the
same 6-hex-char code, both see no existing user, and the loser gets an E11000 the signup path treats
as a failure. `packages/user/src/routes/auth/otpCache.js:55-58` already handles this — it rethrows
any E11000 that isn't on `phone`, explicitly naming "the randomly minted refCode" as a genuine
failure. 24 bits of entropy makes a collision unlikely but not negligible at scale. Recommendation:
catch E11000 on `refCode` inside the hook and retry the generation loop.

### Findings — Architecture

**Order lifecycle events fire only on `save` / `findOneAndUpdate`** | **High** |
`packages/shared/models/orders.schema.js:500` (pre-save), `:527` (pre-findOneAndUpdate),
`:578` (post-findOneAndUpdate); emit at `:606`

```js
// orders.schema.js:606 — the ONLY emit site for "order-closed"
queueOrderEvent(session, "order-closed", doc, mongoose.models.orders, mongoose.models.users, ...);
```

Confirmed: the hooks are registered on `save` and `findOneAndUpdate` only. Mongoose does not run
document middleware for `updateOne`, `updateMany`, `bulkWrite` or `findByIdAndUpdate`-via-`updateOne`.
Any path that closes an order through those methods silently skips referral cashback, invoice-number
minting, the customer push notification, and pick-task cancellation — with no error surfaced.

Current blast radius is contained but the gap is real: `OrderModel.updateOne` is already used at
`events/order.handler.js:90`, `:186`, `:225` and `cron/src/jobs/scheduled-release.js:235`. Those
four are deliberate and none of them writes `status` to CLOSED, so nothing is broken *today*. The
hazard is that nothing enforces that invariant — the next `updateOne` that touches `status` inherits
a silent failure mode.

Additionally, the model layer top-level-imports the event/util layer
(`orders.schema.js:8` → `utils/order-event.utils`), which is what forces the lazy-require
workarounds in `events/emitter.js:16`, `events/order.handler.js:7-11` and `utils/jwt.utils.js:35-42`.

Recommendation: (a) add a guard so status writes cannot bypass the hooked methods — the cleanest
version is a repository-level `closeOrder()` chokepoint that is the only thing allowed to write
CLOSED; (b) at minimum, document the constraint in the schema next to the hooks so the next
`updateOne` author sees it; (c) longer term, move the emit out of the schema into that chokepoint,
which also dissolves the model→events import cycle.

---

**Repositories mix data access with business rules** | **Medium** |
e.g. `packages/shared/repositories/order.repository.js:4-5`, `:93-95`, `:111`, `:212-220`

The "repository" layer defines and applies policy, not just queries — which order statuses count as
ACTIVE vs PAST for the customer list (`:212-220`), which statuses mean "no longer holds its slot
seat" (`:4-5`), which are "never-placed" payment-lifecycle states (`:111`). This is genuine domain
logic living in the persistence layer, and it is the reason there is no service layer anywhere in
the codebase: controllers call repositories directly, so policy had to go somewhere. It does at
least keep the rules in one shared place rather than duplicated per package.

Recommendation: not worth a rewrite. Do extract the status-set constants (`ACTIVE_LIST_STATUSES`,
`HIDDEN_FROM_LIST_STATUSES`, `NOT_SPENT_STATUSES`) into `constants/order.constant.js` so the policy
is declared where the enum lives and the repository only applies it.

### Summary counts — shared

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 4 |
| Medium | 8 |
| Low | 5 |
| **Total** | **17** |

---

## Package: user

### Findings — Quality / Cleanliness

**`order/controller.js` is 2,609 lines with ~1,800 lines of logic above the exports** | **High** |
`packages/user/src/routes/order/controller.js:1-1805` (helpers), `:1806` (`module.exports`)

The HTTP handlers start at line 1806. Everything before it is business logic living in a controller
file: pricing (`calculatePricing:195`), inventory reservation
(`prepareOrderItemsAndInventory:219`), slot/schedule policy (`buildScheduleActions:115`,
`scheduleChangeDeadline:79`), customer response sanitisation (`sanitizeOrderForCustomer:154`),
coupon-checkout error mapping (`couponCheckoutError:391`), and client-version compatibility mapping
(`clientKnowsPickStatuses:30`, `presentOrderStatus:45`).

Individual handlers are also long: `cancel` is 267 lines (`:2035-2301`), `changeSlot` 263
(`:2302-2564`). Other controllers in the package are far smaller (cart 635, profile 589, wallet 48),
so this is one file, not a house style.

Why it matters: none of this logic is reachable from another package or testable without an HTTP
request, and the order flow is the highest-risk code in the product. Recommendation: extract to
`shared/utils` (pricing, schedule policy — the delivery and admin packages need the same rules) and
to a local `src/services/order.service.js` for the rest, leaving handlers as validate → call → respond.

---

**Dead endpoint whose entire body is commented out** | **Low** |
`packages/user/src/routes/razorpay/controller.js:262-273`

```js
cancel: async (req, res, next) => {
    try {
        // const userId = req.user._id;
        // const { cartId, orderId } = req.body;
        // await CartRepository.changeStatus(userId, cartId, OrderConstants.orderStatus.OPEN);
        // await OrderRepository.delete(orderId);
        return res.status(200).json({ msg: "Acknowledged", data: {} });
```

`cancel` is not mounted (`router.js:11-12` exposes only `/webhook` and `/order/:orderId`), so it is
fully dead. Alongside it, `validator.validateOrderAndSuccess` (`validator.js:10-19`) is defined and
exported but never referenced by the router, and `validator.js:28-46` is a further 19 lines of
commented-out validators. `router.js:9` also carries a commented-out `router.use(jwtUtils.authenticate)`.

Recommendation: delete `cancel`, the unused validator, and the commented blocks. If the
commented-out `authenticate` line reflects a real decision (the webhook must stay unauthenticated
because Razorpay calls it), state that as a one-line comment instead of leaving disabled code.

---

**Rate-limit comment contradicts the code** | **Low** |
`packages/user/index.js:29-31`

```js
windowMs: 5 * 60 * 1000, // 5 minutes
max: 1000, // Limit each IP to 100 requests per windowMs
```

`max` is 1000, the comment says 100 — copy-pasted from `packages/auth/index.js:41` and not updated.
The 10x discrepancy matters because `packages/user/src/routes/auth/router.js:9-11` explicitly
reasons about this exact number when justifying its per-route limiters. Recommendation: fix the
comment.

### Findings — Reusability / DRY

**`round2` reimplemented locally instead of imported from shared** | **Medium** |
`packages/user/src/routes/order/controller.js:193`, `packages/user/src/routes/cart/controller.js:32`

Both are byte-identical to `shared/utils/order-edit.utils.js:36` and
`shared/utils/discount.utils.js:121`. Cart and checkout must agree on the displayed total to the
paisa — they currently do, by coincidence of identical copy-paste. See the shared-package DRY
finding for the full picture and the recommended fix.

**Otherwise: `user` reuses shared well.** Sampled imports show the package consistently pulls
`repos`, `constant`, `utils`, `model` from shared rather than reimplementing
(`connections/mongo.js:2-8`, `middleware/geo.js:1-4`, every controller header). Local additions
(`routes/auth/otpCache.js`, `middleware/geo.js`) are genuinely user-specific. The one structural
duplication is the auth twins — see AUTH-1.

### Findings — Best Practices

**CORS origin is a literal string that looks like a wildcard, with `credentials: true`** | **High** |
`packages/user/index.js:54-60` + `packages/shared/config/index.js:117`

```js
// config/index.js:117
corsOrigin: process.env.CORS_ORIGIN || "*.haper.in",
// user/index.js:55-59
cors({ origin: config.corsOrigin, methods: "...", credentials: true })
```

The `cors` package treats a string `origin` as an **exact** string comparison — it does not glob.
So the default value `"*.haper.in"` matches no real origin, and browser CORS is effectively closed
for every web client (the mobile apps are unaffected; they don't enforce CORS). Conversely, if
`CORS_ORIGIN` is set to `"*"` in any environment, `credentials: true` alongside a wildcard is
rejected by browsers outright — so both the default and the obvious "fix" are broken.

Contrast `packages/auth/index.js:16-27, 58-79`, which does this correctly with a validator function
that parses the URL, checks the protocol, and matches `hostname === "haper.in" || endsWith(".haper.in")`.
Two services in the same repo, same requirement, two implementations, one of them wrong.

Recommendation: lift auth's `isAllowedCorsOrigin` into `shared/utils` and use it in both services.
This one is worth fixing before haper-web goes live, since it will present as an unexplained
browser-only failure.

---

**The same error handler is registered twice per request path** | **Medium** |
`packages/user/src/routes/index.js:2,33` and `packages/user/index.js:16,76`

```js
// src/routes/index.js:33  — inner, inside the /user router
router.use(errorHandler);
// index.js:76             — outer, app level
app.use(errorHandler);
```

Both point at the same `src/middleware/error.js`. Express stops at the first error handler that
responds, so the inner one handles everything under `/user` and the outer one only ever sees the
404 synthesised at `index.js:66-73`. Harmless today, but it means "where is this error formatted?"
has two answers, and adding per-scope behaviour to one of them produces a shape that depends on
which route threw. Recommendation: keep only the app-level registration.

---

**Webhook failure path persists raw request headers, including the signature** | **Medium** |
`packages/user/src/routes/razorpay/controller.js:29-34` and `:245-249`

```js
await LogRepository.add(LogConstant.logType.WEBHOOK_ERROR, null, {
    body: req.body,
    header: req.headers,     // includes x-razorpay-signature
});
```

The signature verification itself is correct — `razorPayUtils.validateWebHook(req.rawBody || req.body, ...)`
at `:26`, with `rawBody` preserved by the `express.json` verify hook at `index.js:38-42`. The issue
is only the logging: the full header bag lands in the unindexed, un-TTL'd `logs` collection (see the
shared finding). Recommendation: log an explicit allow-list of header names.

---

**Store/geo resolution is driven by string path-prefix matching in middleware** | **Medium** |
`packages/user/src/middleware/geo.js:16-47`

```js
if (req.method === "PATCH" && req.baseUrl === "/user" && (req.path === "/profile" || req.path === "/profile/")) {
...
if (req.baseUrl === "/user" && (req.path.startsWith("/auth") || req.path.startsWith("/config") || ...))
...
if (req.baseUrl === "/user" && req.path.startsWith("/order") && req.path !== "/order/place") {
```

`getGeoAndStore` runs before all `/user` routes (`index.js:64`) and decides per-route whether a store
is required using hardcoded path strings, including the trailing-slash special case at `:16` and the
single-route exception at `:45`. Renaming or adding a route silently changes its auth-adjacent
behaviour, and the rules are invisible from the route definitions themselves.

Recommendation: invert it — make store resolution an opt-in middleware attached to the routers that
actually need it (`/order/place`, `/cart`, `/item`, `/home`, `/store`, `/coupon`) rather than a
global with an exception list.

### Summary counts — user

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 2 |
| **Total** | **8** |

---

## Package: auth

### Findings — Architecture

**AUTH-1 — The "frozen" auth fork is still deployed in prod and dev** | **Critical** |
`ecosystem.config.js:19-22` and `ecosystem.dev.config.js:25-28`

```js
// ecosystem.config.js:19
{ name: "Haper_Prod_Auth", script: "packages/auth/index.js", ...commonConfig },
// ecosystem.dev.config.js:25
{ name: "Haper_Dev_Auth",  script: "packages/auth/index.js", ...commonConfig },
```

Six source files in `packages/user` carry the header *"Copied from packages/auth/... during the
auth-ownership migration. **packages/auth is frozen — do not port fixes back there**"*
(`user/src/routes/auth/otp/controller.js:1`, `.../google/controller.js:1`,
`.../refresh/controller.js:1`, `.../otp/validator.js:1`, `.../otpCache.js:3`,
`user/src/routes/auth/router.js:8`). `packages/auth/src/routes/index.js:10-11` confirms the
migration is real and partial — the admin-family login was moved out and its mount deleted.

But "frozen" was never a deployment state. PM2 still starts it in both environments, so
`packages/auth`'s customer OTP and Google login endpoints are live and publicly reachable. Every
hardening applied to the `user` twin is therefore **absent from a running production service**. The
concrete deltas, each verified by `diff`:

| Hardening present in `user` | State in the live `auth` fork |
|---|---|
| Single-use OTP (`otpCache.js:26-34` burns the code on success) | **Absent.** `auth/.../otp/controller.js:45-47` reads the code and never deletes it — it stays replayable for its full TTL (`smsOtpExpiry`, default 2 min), unlimited times, across `/otp/login` **and** `/google/verify-phone`. |
| Atomic resend cooldown via `setIfNotExists` (`user/.../otp/controller.js:31-40`) | **Absent.** `auth/.../otp/controller.js:14-25` is a read-then-write on `_LAST_SENT`; concurrent requests for the same phone all read stale state and all send an SMS. Real money — each send is billed. |
| Per-route limiters: 3/15min per (phone,IP), 20/15min per IP for OTP; 10 + 30 for login (`user/src/routes/auth/router.js:21-98`) | **Absent.** Only the blanket `apiLimiter` (100/15min, `auth/index.js:39-43`) plus the in-controller counter at `:21-25`, which is itself a non-atomic `get`→`set` (`:14`, `:24`). |
| Exact indexed email lookup (`user/.../google/controller.js:38-43`) | **Absent.** `auth/.../google-auth/controller.js:34-37` builds `new RegExp(\`^${email.trim()}$\`, "i")` from unescaped user input on an anonymous endpoint — an unindexed collection scan, and `.` in the submitted address matches any character. |
| Race-safe signup that converts E11000-on-phone into a read-back (`otpCache.js:47-63`) | **Absent.** `auth/.../otp/controller.js:96-104` calls `create()` bare; a concurrent duplicate surfaces as a 500. |
| Joi-normalised query handed to the controller (`user/.../otp/validator.js:40-45`) | **Absent.** `auth/.../otp/validator.js:30` validates but passes the raw `req.query` through, so `" 9876543210"` becomes a different cache key and sidesteps the cooldown. |
| 5xx message masking in the error middleware (`user/src/middleware/error.js:54-63`) | **Absent** — see AUTH-3. |

Recommendation, in order: (1) **decide whether `packages/auth` should still be serving traffic.**
If the migration is complete, remove both PM2 entries and delete the package — that closes all seven
gaps at once and is the cheapest fix by a wide margin. (2) If old app builds still call it, it is
not frozen, it is unmaintained: port the single-use OTP, the atomic cooldown and the regex fix
immediately, and put a sunset date on it. (3) Either way, replace the "frozen" comments with the
actual status, because six files currently tell a maintainer not to fix a live service.

### Findings — Best Practices

**AUTH-2 — Error middleware overrides CORS with the raw request Origin** | **High** |
`packages/auth/src/middleware/error.js:53-54`

```js
res.set("Access-Control-Allow-Origin", req.header("Origin"));
res.set("Access-Control-Allow-Credentials", true);
```

This runs on every handled error and reflects **whatever Origin the client sent**, unconditionally —
bypassing the careful allow-list at `auth/index.js:16-27, 58-79` that this same service defines.
Combined with `Allow-Credentials: true`, any origin can read the body of an error response from the
login service. Error bodies here are not empty: `:59` returns `error.message`, unmasked (AUTH-3).

Note the same two lines exist in `packages/user/src/middleware/error.js:43-44`, so the issue is
shared; it is filed here because auth is where the credentials live. Flagged as an
architecture/best-practice finding per scope — navjot-security owns the full assessment.

Recommendation: delete both lines. The `cors` middleware already sets these headers correctly for
allowed origins, including on error responses.

---

**AUTH-3 — Two error handlers with different response shapes; the inner one leaks 5xx detail in production** | **High** |
`packages/auth/index.js:95-100` (outer) vs `packages/auth/src/routes/index.js:15` → `src/middleware/error.js` (inner)

```js
// auth/index.js:95-100 — outer: masks in production, shape { error }
const message = process.env.NODE_ENV === 'production' ? "An unexpected error occurred." : err.message;
res.status(statusCode).json({ error: message });

// auth/src/middleware/error.js:55-60 — inner: NO masking, shape { code, error, data, message }
res.status(error.statusCode || 400).json({ code: ..., error: err.name, data: null, message: error.message });
```

Every `/auth/*` route error hits the inner handler, so the production masking in `index.js` is dead
code for all real traffic. Raw `error.message` reaches the client — for a 5xx that is whatever the
driver produced: mongo index names, file paths, replica-set topology.

The `user` twin fixed exactly this (`user/src/middleware/error.js:54-63`, with the rationale written
out: *"its message is whatever the driver/runtime produced — mongo index names, file paths,
replica-set topology"*) and the fix was never ported, per AUTH-1. The twin also defaults unhandled
errors to 500 (`:25`); auth defaults to **400** (`:55`), so genuine server crashes are reported to
clients and to monitoring as client errors.

Recommendation: port `user/src/middleware/error.js` wholesale (or delete the package per AUTH-1),
and remove the now-redundant outer handler.

---

**AUTH-4 — Cart logic inside the auth service's error middleware** | **Low** |
`packages/auth/src/middleware/error.js:43-45`

```js
if (err?.message && typeof err.message === "string" && err.message.startsWith("LIMIT_EXCEEDED:")) {
    res.set("X-Cart-Notice", "LIMIT_EXCEEDED");
}
```

`packages/auth` has no cart routes — its entire surface is health, google, otp, refresh
(`src/routes/index.js:8-13`). Copy-paste residue from the user service. Recommendation: delete.

---

**AUTH-5 — Refresh endpoint checks neither the token blacklist nor account status** | **Medium** |
`packages/auth/src/routes/refresh/controller.js:13-31` (and identically
`packages/user/src/routes/auth/refresh/controller.js:14-31`)

The handler verifies the signature (`:13`) and the device fingerprint (`:21-26`), then mints a new
access token from the refresh token's own payload (`:29-30`). It never calls
`jwtUtils.isBlacklisted` (exported at `jwt.utils.js:356`) and never re-reads the user's status.

Consequence: a refresh token survives logout — `jwtUtils.expire()` blacklists the *access* token
only (`jwt.utils.js:342-355`), so the matching refresh token keeps minting new access tokens for the
remainder of its 30-day life (`config/index.js:35`). Deleted accounts are caught downstream
(`authenticate` checks status at `jwt.utils.js:146-152`), so the exposure is bounded, but "log out"
does not actually end the session.

Also note `:29` copies `avatar` and `name` out of the 30-day-old refresh token into the new access
token, so a user who changes their name keeps the stale one until they re-login.

Recommendation: check `isBlacklisted(refreshToken)` before issuing, and blacklist the refresh token
on logout. Re-read `name`/`avatar` from the database rather than trusting the old payload.

---

**AUTH-6 — `connectDb` failure does not stop the service** | **High** |
`packages/auth/src/connections/mongo.js:19-21` (identical in `user` at `:128-130` and `cron` at `:19-21`)

```js
} catch (error) {
    console.log(`Mongo Error - ${error}`);
}
```

The error is logged at `log` level and swallowed. `await connectDb()` at `auth/index.js:102` then
resolves normally, `app.listen()` runs at `:106`, and the service comes up healthy-looking with no
database. Under PM2 with `autorestart: true` there is no crash to restart from — it just serves
errors indefinitely. The health endpoint will not catch it either (`src/routes/health/controller.js`
does not probe the connection).

This is the same code in all three in-scope services, so a cluster-wide connectivity blip leaves
every service "up" and broken. Recommendation: rethrow, and let the top-level
`start().catch()` exit non-zero so PM2 restarts with backoff. Log at `console.error`.

---

**AUTH-7 — OTP rate-limit counter is a non-atomic read-modify-write on an unnamespaced key** | **High** |
`packages/auth/src/routes/otp/controller.js:14-25`

```js
let reqCount = await distributedCacheUtils.get(phoneNumber);          // raw phone as the cache key
...
if (reqCount && reqCount >= 2) return res.status(429)...
await distributedCacheUtils.set(phoneNumber, (reqCount || 0) + 1, smsUserReqExpiry * 60);
```

Three problems. (1) `get` → compare → `set` is not atomic; N concurrent requests all read the same
count and all pass. (2) The cache key is the bare phone number with no prefix — every other key in
the same Redis namespace uses one (`bl_`, `ustatus_`, `uver_`, `<phone>_OTP`), so this is the one key
that can collide with an unrelated value. (3) The threshold `2` is a bare magic number with no
constant or comment, while the *cooldown* period is also a magic `2 * 60 * 1000` at `:17`.

The `user` twin fixed (1) by claiming the cooldown atomically with `setIfNotExists`
(`user/src/routes/auth/otp/controller.js:31-40`, comment: *"SMS costs money, and a check-then-act on
the old `_LAST_SENT` timestamp let concurrent requests for the same phone all read stale state and
all send"*). Not ported — see AUTH-1. Recommendation: use `INCR` with TTL, prefix the key, and name
the constants.

### Summary counts — auth

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 4 |
| Medium | 1 |
| Low | 1 |
| **Total** | **7** |

---

## Package: cron

### Findings — Best Practices

**CRON-1 — `account-purge` can loop forever on a persistently failing row** | **High** |
`packages/cron/src/jobs/account-purge.js:38-80`

```js
do {
    batch = await UserModel.find({ status: DELETED_SOFT, deletedAt: { $lte: cutoff } })
        .select({ _id: 1, phone: 1, email: 1 }).limit(BATCH).lean();     // BATCH = 50
    if (!batch.length) break;
    for (const u of batch) {
        try { await UserModel.updateOne({ _id: u._id }, { $set: { status: DELETED_PERMANENT, ... } });
              ... totalPurged++;
        } catch (perUserErr) {
            console.error(`[account-purge] failed to purge ${u._id}: ${perUserErr.message}`);   // swallow, continue
        }
    }
} while (batch.length === BATCH);
```

The loop has no cursor and no offset — it relies entirely on each iteration's `updateOne` moving
rows *out* of the query predicate. The per-row catch at `:76-79` deliberately keeps going on failure
("Don't stop the batch for one bad row"), but a failing row stays `DELETED_SOFT`. If 50 rows fail
(one bad row plus a backlog, or any systemic cause — a validation error, a write concern timeout, a
failover), the next `find` returns the same 50, `batch.length === BATCH` is true, and the job spins
in a tight loop issuing 50 failing writes per pass, forever. It is inside the outer `try`
(`:28`) so nothing terminates it, and PM2 sees a healthy process.

Systemic causes are realistic here: `$set: { phone: null, email: null }` interacts with the partial
unique indexes on those fields (`users.schema.js:61-62`), and `$unset: { deletedAt: "" }` runs
against a collection where the `require: true` typo (see shared) means documents may be missing
required-ish fields.

Recommendation: track `_id`s that failed this run and exclude them from the next `find`
(`_id: { $nin: failedIds }`), plus a hard iteration cap. Escalate to `console.error` and stop the
job once failures exceed a threshold — a purge that cannot purge is a compliance issue, not a
retry-forever one.

---

**CRON-2 — Cron's Mongo connection registers itself as the User service** | **Medium** |
`packages/cron/src/connections/mongo.js:9-11`

```js
dbSafetyUtils.assertSafeMongoDbUri(config.mongoDbUri, { appName: config.cronApp });   // cronApp
const dbClient = await mongoose.connect(config.mongoDbUri, {
    appName: config.userApp,                                                          // userApp (!)
```

The safety guard is told `cronApp` but the driver is told `userApp` (`config/index.js:4` = `"UserService"`).
Copy-paste from `packages/user/src/connections/mongo.js:17`, which is the only other place that
string appears. Consequence: in Atlas the cron process's queries are attributed to the User service —
so a slow nightly aggregation or a runaway cursor from a cron job looks like customer-facing traffic
in the profiler, and connection-count alerts point at the wrong process. Recommendation:
`appName: config.cronApp`.

---

**CRON-3 — Jobs are scheduled at require-time, before the DB connection is established** | **Medium** |
`packages/cron/index.js:4-10`

```js
const { connectDb } = require("./src/connections/mongo");
require('./src/scheduler.js');       // line 5 — registers all 15 cron.schedule() calls immediately

const start = async () => {
    await connectDb();               // line 8 — runs after
```

`require` executes `scheduler.js` synchronously at line 5, and `scheduler.js:23-24` schedules two
jobs at `* * * * *`. `connectDb()` at line 8 is awaited afterwards. In practice the first tick lands
on the next minute boundary, so a fast connect wins — but nothing guarantees it. A slow DNS
resolution or a paused Atlas cluster produces jobs firing against a disconnected mongoose, and
because `connectDb` swallows its error (AUTH-6) that state is permanent for the process's lifetime.

Recommendation: move `require('./src/scheduler.js')` inside `start()`, after `await connectDb()`.
Three-line change.

---

**CRON-4 — Cron reads from secondaries** | **Medium** |
`packages/cron/src/connections/mongo.js:12` — `readPreference: "secondaryPreferred"`

Writes always route to the primary, so correctness of the writes is fine; the risk is on the
candidate-selection reads. A job that reads a stale document from a lagging secondary and then acts
on it can do duplicate or wrong work. `scheduled-release.js` is aware of this and pins its
transaction with `{ readPreference: 'primary' }` (`:227`) — which is exactly the right fix and
proves the concern is real. Other jobs that select candidates and then mutate them do not:
`pick-task-reconcile.js` (backfills pick tasks for OPEN orders, runs every minute),
`payment-initiated-orders.js` (cancels abandoned prepaid orders), `account-purge.js`,
`return-approval-expiry.js`.

Note this connection also inherits the known repo-wide `secondaryPreferred` → `autoIndex: false`
behaviour (documented at `packages/user/src/connections/mongo.js:50-56`); `cron` has no
`ensureIndexesFor` call, unlike `user`. Known issue, flagged for completeness.

Recommendation: pin candidate-selection reads in the mutating jobs to `primary`, following the
pattern `scheduled-release.js` already established.

---

**CRON-5 — No distributed lock; single-instance PM2 is the only thing preventing double-fire** | **Medium** |
`ecosystem.config.js:44-50` (`instances: 1, exec_mode: 'fork'`), `packages/cron/src/scheduler.js:23-78`

The correctness of the whole cron package rests on that PM2 config. `shared/utils/lockUtils.js`
exists and provides a Redis `SET NX` lock with a token, but it is used **only** by
`cart.repository.js:155` and `:333` — no cron job takes a lock. The risk is not hypothetical: it is
one `instances: 2` edit, one blue/green overlap, or one manual `node packages/cron/index.js` on the
box away.

Credit where due — the mitigation is well done *per job*, and idempotency is clearly a considered
concern: `scheduled-release.js:15-30` documents a compare-and-set claim and is explicit that
"`cron.schedule` gives node-cron no re-entrancy protection"; `scheduled-reminders.js:12-28` reasons
through two designs and picks the atomically-guarded one; `auto-replenishment.js:26-27` and
`coupon-hold-sweeper.js:17-21` both state their idempotency argument. But node-cron also has no
overlap protection *within a single process*: `inventory-evaluation-sweep.js` runs every 15 minutes
and re-evaluates every group across every store with no guard at all (the whole file is 22 lines),
and `daily-profit-snapshot.js` recomputes a rolling window of days with no run lock.

Recommendation: wrap `cron.schedule` in a small helper that takes a Redis lock keyed on the job name
(TTL ≈ 2x the expected runtime) and skips the tick if held. `lockUtils` needs only a generalised key
signature — it is currently hardcoded to `lock:${userId}:${itemId}` (`lockUtils.js:4`).

---

**CRON-6 — Job failures are invisible outside the log file** | **Medium** |
every job's outer catch, e.g. `account-purge.js:78-80`, `auto-replenishment.js:74-76`,
`daily-profit-snapshot.js:80-83`, `inventory-evaluation-sweep.js:19-21`

Every job swallows its top-level error into `console.error` and returns normally. There is no
alerting, no failure counter, no metric, and no non-zero exit. PM2 merges all output into one file
(`ecosystem.config.js:11-13`, `merge_logs: true`), so a nightly job that has been failing for a week
looks identical to one that has been succeeding.

The impact is quantified in the codebase itself: `daily-profit-snapshot.js:12-16` records that a
silent gap in this job cost "67 orders, ₹9,665 of revenue and ₹1,158 of profit lost across the nine
days the job had run" before anyone noticed. The rolling-window rewrite fixed *that* job's
recoverability, but the detection gap it exposed is unaddressed everywhere else.

Recommendation: a shared job wrapper that records last-run/last-success/duration/error per job name
to a small collection, surfaced on an admin screen. Cheap, and it turns every one of these silent
failures into something visible.

---

**CRON-7 — `inventory-daily-digest` issues N+1 queries per store per group** | **Low** |
`packages/cron/src/jobs/inventory-daily-digest.js:11-27`

```js
const storeIds = await InventoryGroupRepository.listStoresWithRedGroups();
for (const storeId of storeIds) {
    const redGroups = await InventoryGroupRepository.listRedGroupsForStore(storeId);
    for (const group of redGroups) {
        const items = await InventoryGroupRepository.getActiveItemsForGroup(group._id, ...
```

One query per store, then one per group. At today's store count (1, with Chapra coming) this is
immaterial; it scales linearly with stores × red groups and runs once daily at 09:00, so it is a
watch-item, not a problem. Recommendation: leave it; revisit past ~20 stores.

---

**CRON-8 — Env var read directly instead of through the shared config module** | **Low** |
`packages/cron/src/jobs/inventory-reservation-expiry.js:11`

```js
const EXPIRY_DAYS = Number(process.env.RESERVATION_EXPIRY_DAYS) || 7;
```

Every other tunable in the codebase goes through `shared/config/index.js`; this one reaches for
`process.env` directly at module load, so it is absent from `.env.example`'s effective inventory and
invisible to anyone reading the config file to learn what is tunable.
`return-approval-expiry.js` names `RETURN_PENDING_APPROVAL_EXPIRY_DAYS` in its header comment with
the same pattern. Recommendation: move both into `shared/config`.

### Findings — Quality / Cleanliness & Architecture

**Cron is the best-documented package in this scope** | *(no action)*

Worth recording as a positive baseline: `scheduled-release.js:1-30`, `scheduled-reminders.js:1-28`,
`coupon-hold-sweeper.js:1-28`, `product-master-reconcile.js:1-25` and `return-approval-expiry.js:1-26`
each open with a header that states what the job does, why it exists, its idempotency argument, and
what it deliberately does *not* do ("Read-only: it never 'fixes' stock automatically (a silent
auto-correct could mask a real bug)" — `inventory-batch-reconcile.js:11-13`). Several record the
alternatives considered and why they were rejected. This is the standard the rest of the repo should
be held to, and it is why most of the findings above are infrastructural rather than logical.

One structural note: `scheduler.js:63-77` defines `slotCapacityReconcileJob` inline in the scheduler
rather than in `src/jobs/`, breaking the one-file-per-job convention the other 14 follow. The reason
is documented at `:53-62` (it wraps a shared repository function whose file was out of scope to
edit), which is a fair call — but it now means one job lives somewhere nobody will look for it.
Recommendation: move it to `src/jobs/slot-capacity-reconcile.js`, keeping the comment.

### Summary counts — cron

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 5 |
| Low | 2 |
| **Total** | **8** |

---

## Common patterns across shared / user / auth / cron

### Is `shared/` a real dependency-inversion layer, or a dumping ground?

**Verdict: genuinely well-factored and genuinely well-used — but undeclared and over-broad.**

What works. Sampling imports across all three consumers, the destructure-from-`shared` pattern is
followed consistently and nothing meaningful is reimplemented locally:
`cron/src/jobs/*.js` pull `repos` / `model` / `constant` / `utils`; `user/src/middleware/geo.js:1-4`
and every user controller do the same; `auth` imports `jwtUtils`, `smsUtil`, `distributedCacheUtils`,
`UserRepository`. Crucially, `shared` does **not** reach back into app-specific concerns — grep found
no `req`/`res`/`express` usage in `shared/repositories` or `shared/models` (the only hits were the
word "express" inside prose comments). The direction of dependency is correct. The layering
(`constants` → `models` → `repositories` → `utils` → `events`) is consistent, and `index.js:1-8`
exposes exactly five named namespaces.

Three real weaknesses:

1. **The contract is undeclared** — `packages/shared/package.json` lists no dependencies at all
   (shared High #1). A dependency-inversion layer that does not declare its own dependencies is one
   root-level `npm uninstall` away from breaking six packages with no warning.
2. **Utilities are not deduplicated *within* shared** — 8 copies of `round2` and 13 of `TZ` live
   inside the shared package itself. The consumers are disciplined about importing from shared;
   shared is not disciplined about importing from itself.
3. **The layer has no boundary rule** — `shared/utils` has grown to 44 modules
   (`utils/index.js:1-45`) spanning geocoding, PDF invoices, S3, Razorpay, SMS, email, HTML
   sanitisation and inventory evaluation. Nothing is *wrong* there, but with no stated criterion for
   what earns a place in shared, "shared" is on a path to meaning "everything". Worth writing down
   the rule now (consumed by ≥2 packages, no HTTP/request coupling) while it is still true.

### Cross-cutting patterns

**A. Fork-and-freeze without decommissioning.** The `auth` → `user` auth migration produced a
hardened twin and left the un-hardened original running in prod (AUTH-1). The comments say "frozen";
the PM2 manifests say "deployed". Every fix applied to one side since then is a gap on the other.
*Lesson worth institutionalising: "frozen" must mean removed from the deployment manifest, or it
means "unmaintained and live".*

**B. Copy-paste as the reuse mechanism, in three separate places.** `round2` (10 copies, 3
semantics), `TZ` (20 copies), and `connections/mongo.js` (3 near-identical copies carrying the same
swallowed-error bug and, in cron's case, a wrong `appName` from the copy-paste). All three would be
caught by the same habit: when about to duplicate, put it in shared.

**C. Errors are logged, never raised.** The dominant idiom across all four packages is
`try { ... } catch (e) { console.error(e) }` with execution continuing. It is right for genuinely
best-effort work (telemetry at `jwt.utils.js:97-99`, cache writes at `:67-69`) and wrong for
the boot path (AUTH-6: three services start with no database) and for jobs (CRON-6: a week of
failures is invisible). There is no logger, no severity discipline — `console.log` is used for a
Mongo connection failure, `console.error` for a routine success summary — and no alerting anywhere
in scope. *If one investment is made off this audit, make it this one:* a structured logger plus a
cron run-ledger converts an entire class of silent failures into visible ones, and the
profit-snapshot incident (₹9,665 lost over nine unnoticed days) is the proof that the class is
expensive.

**D. Two error handlers per service, with divergent shapes.** Both `auth` and `user` register their
error middleware twice — once inside `src/routes/index.js` and once at app level. In `auth` the two
handlers produce *different JSON shapes* and only the unreachable one masks 5xx detail in production
(AUTH-3). Clients therefore see a response envelope that depends on which layer caught the error.

**E. Business logic settles wherever there is room.** There is no service layer anywhere in scope.
Controllers call repositories directly, so policy has ended up split between 1,800 lines of
pre-export helpers in `user/src/routes/order/controller.js` and status-policy constants inside
`shared/repositories/order.repository.js`. Both are defensible local choices; together they mean
there is no single place to look for "the rules".

**F. Where the codebase is strong.** Worth stating plainly, because it shapes what is worth fixing:
the hard concurrency work is done well and documented. Compare-and-set claims
(`scheduled-release.js`), post-commit event queueing to survive transaction rollback
(`order-event.utils.js:1-21`), explicit index-build verification with a feature kill-switch rather
than a hard exit on the customer-facing API (`user/src/connections/mongo.js:105-125`), and
fail-open-to-constants config reads on the money path (`order.handler.js:14-28`) are all
better-than-average engineering with the reasoning written down. The findings above are
overwhelmingly about *infrastructure and hygiene* — deployment state, dependency declarations,
logging, duplication — not about the core transactional logic, which is sound.

### Recommended order of work

| # | Action | Severity addressed |
|---|---|---|
| 1 | Decide the fate of `packages/auth` — remove from both PM2 manifests, or un-freeze and port the seven gaps | Critical (AUTH-1), 4 High |
| 2 | Make `connectDb` failures fatal in all three services | High (AUTH-6) |
| 3 | Bound the `account-purge` loop; exclude failed `_id`s | High (CRON-1) |
| 4 | One `round2` in shared; replace all ten call sites | High (money) |
| 5 | Delete the dead `orderClosed` twin | High (money) |
| 6 | Fix `user`'s CORS to use auth's validator function, lifted into shared | High |
| 7 | Remove the reflected `Access-Control-Allow-Origin` from both error middlewares | High (AUTH-2) |
| 8 | Declare `packages/shared`'s dependencies | High |
| 9 | Structured logger + cron run-ledger with alerting | Medium, unlocks visibility for all of the above |
| 10 | Guard order-status writes behind a hooked chokepoint; document the `updateOne` gap in the schema | High (silent cashback/notification skip) |

---

## Overall summary counts

| Package | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| shared | 0 | 4 | 8 | 5 | 17 |
| user | 0 | 2 | 4 | 2 | 8 |
| auth | 1 | 4 | 1 | 1 | 7 |
| cron | 0 | 1 | 5 | 2 | 8 |
| **Total** | **1** | **11** | **18** | **10** | **40** |
