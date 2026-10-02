# Backend Code Quality Audit — admin / delivery / picking

Scope: `packages/admin` (228 JS), `packages/delivery` (27 JS), `packages/picking` (28 JS).
Audited read-only at `/Users/office/Documents/haper/haper-backend`. Every finding below was
opened and read in the actual file; line numbers are from the current working tree.

Known-issue carve-out applied as briefed: `readPreference: "secondaryPreferred"` silently
forcing `autoIndex=false` is a pre-existing, documented platform issue — schemas relying on
implicit index builds are noted but not counted as new findings.

---

## Package: admin

### Findings — Best Practices / Security

---

**A1. `?storeId=` query param overrides the auth-pinned store scope (cross-store profit/COGS leak)**
Severity: **Critical**
`packages/admin/src/routes/analytics/controller.js:299-302` and `:520-521`

```js
// getProfitAnalytics
const { from, to, storeId: queryStoreId } = req.query;
// storeId resolution: explicit query param (super_admin) → active store header
const storeId = queryStoreId || (req.store ? String(req.store._id) : null);

// getProductCogs
const queryStoreId = req.query.storeId || null;
const storeId = queryStoreId || (req.store ? String(req.store._id) : null);
```

The comment says "super_admin", but nothing in the code checks the role. The query param wins
unconditionally over `req.store`, which `middleware/auth.js:106-115` pinned to the admin's own
store. Chain of custody:

- `middleware/auth.js:106` correctly 403s a store-scoped admin who sends a foreign
  `x-store-id` header — so the header path is safe.
- `middleware/permission.js:31` — `if (hasRole(admin, roles.STORE_ADMIN)) return true;` — grants
  STORE_ADMIN every permission unconditionally, so `requirePermission(P.ANALYTICS.VIEW_REVENUE)`
  on `routes/analytics/router.js:186` and `:215` is not a barrier.
- The resolved `storeId` flows straight into
  `shared/repositories/profit-snapshot.repository.js:292 getProfitTiles({ storeId })` and
  `shared/repositories/order.repository.js:2816 getProductCogsReport`, both of which trust it as
  the tenancy key.

Net effect: `GET /admin/analytics/profit?storeId=<other store>` returns another store's revenue,
COGS and profit to a store-scoped admin. Same for `/analytics/product-cogs`.

The correct pattern already exists in this package and is not used here —
`middleware/inventory-context.js:73-89 resolveStoreId(req, explicitId)` returns the caller's own
store and throws 403 on mismatch, normalising case on both sides.

**Why it matters:** a tenancy bypass on money data. Multi-store is the stated near-term direction
(Chapra store), so the blast radius grows with every store added.

**Fix:** replace both resolutions with
`const storeId = resolveStoreId(req, req.query.storeId);` (import from
`../../middleware/inventory-context`), and wrap the call in the existing `try → next(error)` so
the 403 propagates. Add a regression test asserting a store_admin token + foreign `?storeId` → 403.

---

**A2. `crossStore=true` discards store scope entirely on a VIEW_OPERATIONS-gated endpoint**
Severity: **Critical**
`packages/admin/src/routes/analytics/controller.js:480` (+ `:522`), `routes/analytics/router.js:268-273`,
`routes/analytics/validator.js` (`crossStore: Joi.boolean().optional()`)

```js
// controller.js:480 — getItemSaleFrequency
const crossStore = req.query.crossStore === 'true' || req.query.crossStore === '1';
```

`storeId` at `:441` is resolved correctly from `req.store` (no query override there), but
`crossStore` then nullifies it downstream:

`packages/shared/repositories/order.repository.js:2667` and `:2816`

```js
const allStores = crossStore || !storeId;
...
if (storeId && !allStores) { match.storeId = ...; }   // ← never runs when crossStore=true
```

`/item-frequency` is gated on `P.ANALYTICS.VIEW_OPERATIONS` — the *baseline* permission, held by
manager and support accounts, not just store_admin. So the lowest-privilege admin role can read
every store's best-seller / units-sold data by appending `&crossStore=true`. The Joi validator at
`validator.js` explicitly whitelists the flag, so it is not an accident of a loose schema.

`getProductCogs:522` has the same flag plus `|| !storeId`, stacked on top of the A1 override.

**Why it matters:** unauthenticated-by-role disclosure of cross-tenant sales volumes. Compounds A1.

**Fix:** gate the flag on role, not on presence:
`const crossStore = isSuper(req) && (req.query.crossStore === 'true' || req.query.crossStore === '1');`
For a non-super caller, either ignore the flag or 403. Mirror in `getProductCogs`, and drop the
`|| !storeId` widening there (a non-super caller always has a `req.store`, so `!storeId` can only
be reached by a super admin — make that explicit rather than implied).

---

**A3. `redactCostPrice` is mounted on only 2 of 30 routers — cost data leaks via analytics**
Severity: **High**
`packages/admin/src/middleware/redactCostPrice.js` (whole file),
mounted only at `routes/order/router.js:13` and `routes/items/router.js:20`

`middleware/permission.js:126-131` states the policy in the strongest terms available:

```js
/**
 * Cost price (and cost-derived stock valuation) is restricted to super_admin.
 * Store admins, managers and support must never see what the company paid for
 * an item — this is a hard role gate, NOT a permission a store_admin can be granted
 */
const canSeeCostPrice = (admin) => !!admin && hasRole(admin, roles.SUPER_ADMIN);
```

The enforcement middleware exists and is well written (deep key strip on a JSON-safe clone,
`REDACTED_KEYS = {costPrice, totalStock, totalStockValue, costPerUnit}`), but it is only applied to
`/admin/order` and `/admin/item`. Not applied to:

- `/admin/analytics/profit` → response includes `costTotal` per tile
  (`shared/repositories/profit-snapshot.repository.js:24,241,280`).
- `/admin/analytics/product-cogs` → `rows` are literally per-product COGS
  (`routes/analytics/controller.js:549-558`).
- `routes/warehouse/controller.js`, `routes/procurement/controller.js`,
  `routes/transfer/controller.js`, `routes/store/controller.js`, `routes/pos/controller.js`,
  `routes/discount-rule/controller.js` — all reference `costPrice` and all serve unredacted JSON.

Since store_admin bypasses the permission system (`permission.js:31`), a store admin reads company
cost data on every one of those routes — the exact outcome the comment says must never happen.

**Why it matters:** a security control that is 2/30 adopted reads as "enforced" to anyone auditing
the middleware file, which is how partial-adoption gaps survive.

**Fix:** mount `redactCostPrice` once, globally, in `src/routes/index.js` immediately before the
sub-router `router.use(...)` block (it is a no-op for super_admin and self-defers its role check to
`res.json` time, so a global mount is safe). Then remove the two per-router mounts. If some route
legitimately must expose cost to a non-super role, make that an explicit, commented carve-out.

---

**A4. Default `statusCode` 400 makes the production-redaction branch dead code**
Severity: **High**
`packages/admin/src/middleware/error.js:55-63`

```js
const statusCode = error.statusCode || 400;
const clientMessage =
    process.env.NODE_ENV === "production" && statusCode >= 500
        ? "Something went wrong. Please try again."
        : error.message;
```

`error` is a shallow clone of the thrown error (`:6`). Anything that is not one of the five
recognised `err.name`/`err.code` cases (a `TypeError`, a Mongo driver error, an `ECONNRESET`) has
no `statusCode`, so it falls back to **400**, `statusCode >= 500` is false, and the raw runtime
message goes to the client verbatim — in production. The redaction branch can only be reached by
code that explicitly throws `new errorUtils(msg, 5xx)`, which by definition already wrote a
human-safe message.

Delivery (`packages/delivery/src/middleware/error.js:30-35`) and picking (`:20-24`) have already
been fixed with an explicit terminal branch:

```js
} else if (!error.statusCode) {
    error = new errorUtils("Something went wrong. Please try again.", 500);
}
const statusCode = error.statusCode || 500;
```

**Why it matters:** unhandled exception text (collection names, driver internals, sometimes file
paths) reaching an authenticated-but-untrusted client, and every internal error being
misclassified as a client error in metrics/alerting.

**Fix:** port the delivery/picking `else if (!error.statusCode) → 500` branch verbatim and change
the fallback on `:55` from `|| 400` to `|| 500`.

---

**A5. Axios error branch assumes `err.response` exists — throws inside the error handler**
Severity: **High**
`packages/admin/src/middleware/error.js:47-51`

```js
if (err["isAxiosError"]) {
    const exception = err["response"]["data"];
    err["name"] = exception["error"];
    error = new errorUtils(exception["message"], exception["statusCode"]);
}
```

`isAxiosError` is `true` for network-level failures too — timeout, DNS failure, ECONNREFUSED,
ECONNRESET — and for all of those `err.response` is `undefined`. `undefined["data"]` throws a
`TypeError` *inside the error-handling middleware*, which Express cannot route to another error
handler; the request falls through to Express's default handler and the client receives an HTML
stack-trace page instead of JSON. A second deref (`exception["error"]`, `exception["message"]`)
compounds it when `response.data` is a string body.

**Why it matters:** the failure mode is worst exactly when an upstream dependency is down — i.e.
during an incident, when clean error responses matter most. Also breaks the JSON contract every
admin FE call site assumes.

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

**A6. `console.log(err)` dumps the full error object, including axios request bodies**
Severity: **High**
`packages/admin/src/middleware/error.js:9-11`

```js
if (err.message !== "You are lost here") {
    console.log(err);
}
```

The full error object for an axios failure carries `err.config.data` — the serialised outbound
request body. Admin calls out to payment and notification providers, so that body can contain
tokens, OTPs and credentials, all landing in stdout → CloudWatch, retained and broadly readable.

Delivery already fixed exactly this and documented why (`packages/delivery/src/middleware/error.js:10-16,
38-51`), logging a sanitized record `{ name, message, statusCode, path, method }` plus stack in
non-prod only. Picking mirrors it at `:26-36`.

Note the guard on `:9` is also stale: the string thrown by the 404 handler is `"Ohh!!\n You are
lost"` (`packages/admin/index.js:180`), not `"You are lost here"` — so the suppression never fires
and every 404 logs a full object too.

**Why it matters:** credential exposure in logs, plus log volume from routine 404s.

**Fix:** port delivery's `logRecord` block verbatim; delete the stale string comparison.

---

**A7. Error handler re-sets permissive CORS headers, bypassing the allowlist**
Severity: **High**
`packages/admin/src/middleware/error.js:53-54`

```js
res.set("Access-Control-Allow-Origin", req.header("Origin"));
res.set("Access-Control-Allow-Credentials", true);
```

Unconditional — it reflects *whatever* Origin the caller sends, on every error response. This
overwrites the strict policy configured at `packages/admin/index.js:127-152`
(`isAllowedCorsOrigin` → `haper.in` / `*.haper.in` / `localhost:5173` only).

It also directly contradicts a deliberate decision documented six lines above it in `index.js:148-150`:

```js
// credentials: false — the admin uses Bearer tokens in the Authorization
// header, not cookies. Leaving this off reduces CSRF surface area ...
```

Delivery and picking have already deleted both lines (see the header comment at
`packages/delivery/src/middleware/error.js:9-12`).

**Why it matters:** any origin can read admin error-response bodies cross-origin. Combined with A4
(raw messages) and A6, that is a usable information-disclosure channel.

**Fix:** delete both lines. `cors()` already sets the correct headers on error responses.

---

**A8. Mongo connection failure is swallowed — the service boots with no database**
Severity: **High**
`packages/admin/src/connections/mongo.js:157-159` (identical: `packages/delivery/src/connections/mongo.js:50-52`,
`packages/picking/src/connections/mongo.js:18-20`)

```js
} catch (error) {
    console.log(`Mongo Error - ${error}`);
}
```

`connectDb()` is awaited at `packages/admin/index.js:192`, *after* routes are registered and
immediately before `app.listen(...)`. A caught-and-logged failure means `start()` resolves
normally, the port binds, and the health check (if it doesn't touch Mongo) passes — while every
real request 500s. Under a rolling deploy an instance that cannot reach Atlas is indistinguishable
from a healthy one and will happily take traffic.

The catch also swallows `dbSafetyUtils.assertSafeMongoDbUri` (`:15`) — the guard that stops tests
pointing at a real cluster. It throws synchronously, is caught here, is logged, and the process
continues. The guard is effectively advisory.

**Why it matters:** "fail fast at boot" is the whole point of a startup connection; this converts a
loud boot failure into a silent 100%-error-rate service.

**Fix:** in all three files, log then rethrow (or `process.exit(1)`):

```js
} catch (error) {
    console.error(`[mongo] connection failed — aborting boot: ${error.message}`);
    throw error;
}
```

`index.js`'s `start().catch(...)` at `:212-216` then needs to exit non-zero so the process manager
restarts rather than serving a dead instance.

---

**A9. Admin connects to Mongo advertising itself as `UserService`**
Severity: **Medium**
`packages/admin/src/connections/mongo.js:15-18`

```js
dbSafetyUtils.assertSafeMongoDbUri(config.mongoDbUri, { appName: config.adminApp });   // "AdminService" ✓
const dbClient = await mongoose.connect(config.mongoDbUri, {
    appName: config.userApp,                                                            // "UserService" ✗
```

The safety assertion is tagged correctly; the actual driver connection is not. Verified against
`packages/shared/config/index.js:4-7` (`userApp: "UserService"`, `adminApp: "AdminService"`) and
every sibling service, all of which are self-consistent:

| service  | assert tag        | `mongoose.connect` appName |
|----------|-------------------|----------------------------|
| admin    | `adminApp` ✓      | **`userApp`** ✗            |
| user     | `userApp`         | `userApp` ✓                |
| delivery | `deliveryApp`     | `deliveryApp` ✓            |
| picking  | `pickingApp`      | `pickingApp` ✓             |
| cron     | (no assert)       | **`userApp`** ✗            |

`appName` is what Atlas surfaces in slow-query logs, profiler output, and per-app connection
metrics. Today every expensive admin aggregation (profit tiles, COGS reports, order board) is
attributed to the customer-facing user API. Anyone debugging an Atlas CPU spike will chase the
wrong service — and given the analytics queries in this package, that is the likeliest debugging
session to actually happen.

`packages/cron/src/connections/mongo.js:11` has the same mislabel (out of scope — flagging for the
colleague covering cron).

**Fix:** `appName: config.adminApp`. One-word change, no behavioural risk. Same for cron →
`config.cronApp` (add the key to shared config if absent).

---

**A10. Two error handlers with two different response shapes**
Severity: **Medium**
`packages/admin/src/routes/index.js:68` vs `packages/admin/index.js:184-190`

`src/middleware/error.js` is mounted *inside* the `/admin` router. `index.js:185-190` defines a
second, unrelated handler at app level. Anything outside `/admin` — including every 404 produced
by the `app.all("*")` catch-all at `index.js:175-182` — bypasses the real handler and gets the
app-level one.

The two shapes differ completely:

```js
// src/middleware/error.js:65-70
{ code, error, data: null, message, [errorType], [reason], [details] }
// index.js:189
{ error: message }
```

Delivery and picking have the identical duplication (`delivery/index.js:112-117`,
`picking/index.js:95-100`), and their inner handler uses `msg:` where admin's uses `message:` — so
across three services there are four distinct error envelopes.

**Why it matters:** clients cannot write one error parser. The FE almost certainly reads
`message`/`msg` and renders `undefined` for anything that hits the outer handler.

**Fix:** pick one envelope, export it from `packages/shared`, and have every service mount that one
handler at app level (after the catch-all 404) instead of inside the router.

---

**A11. `SWAGGER_PASSWORD` read from `process.env` directly, bypassing shared config**
Severity: **Low**
`packages/admin/index.js:163,167`

```js
if (process.env.SWAGGER_PASSWORD) {
    app.use("/admin/api-docs", basicAuth({ users: { admin: process.env.SWAGGER_PASSWORD }, ... }));
```

This is the only direct `process.env.<SECRET>` read in all three packages — everything else goes
through `shared/config` (verified: a grep for `process.env.` excluding `NODE_ENV` across
admin/delivery/picking `src/` returns zero hits). The fallback is silent: if the var is unset the
whole Swagger mount is skipped, which fails safe but gives no signal.

**Fix:** move to `config.swaggerPassword` in `packages/shared/config/index.js`, and log a warning
when it's absent so "api-docs 404s in staging" is diagnosable.

---

**A12. `x-store-id` header compared without case normalisation**
Severity: **Low**
`packages/admin/src/middleware/auth.js:53,88,106`

```js
if (headerStoreId && !Types.ObjectId.isValid(headerStoreId)) { ... }   // :53 — accepts UPPER hex
...
if (headerStoreId && headerStoreId !== admin.storeId.toString()) {      // :106 — raw !==
    return next(new errorUtils("Access Denied: You cannot access other stores.", 403));
}
```

`Types.ObjectId.isValid` accepts `[a-fA-F0-9]{24}`, but `.toString()` always emits lowercase. A
client sending its **own** store id in uppercase is 403'd. `:88` has the same issue for
`x-warehouse-id`.

This exact bug was found and fixed in `middleware/inventory-context.js:25-27`, which documents it:

```js
// Joi allows uppercase hex (^[a-fA-F0-9]{24}$) but String(_id) is always
// lowercase, so normalise BOTH sides or a legitimate id compares unequal.
const normalizeId = (value) => (value ? String(value).trim().toLowerCase() : null);
```

The fix was never back-ported to `auth.js`. Fails closed (403, not a bypass), so Low.

**Fix:** import `normalizeId` from `inventory-context.js` and use it on both sides of `:88` and `:106`.

---

### Findings — Reusability / DRY

---

**A13. Tenancy resolution is ad-hoc in ~30 route modules; the correct helper is used by 5**
Severity: **High**
`packages/admin/src/middleware/inventory-context.js` (helpers) vs the rest of `routes/`

`inventory-context.js` exports a well-designed, well-documented tenancy layer —
`resolveStoreId`, `resolveWarehouseId`, `assertStoreAccess`, `applyListScope` — with normalised
comparisons, fail-closed defaults, and a 55-line comment (`:98-131`) working through the
super/store/warehouse precedence rules.

Adoption (files importing any of those helpers): `ledger`, `replenishment`, `transfer`,
`warehouse`, and the middleware itself. **5 files.**

Meanwhile the inline pattern `req.store ? req.store._id : null` and its variants appear **83 times**
across `packages/admin/src`, each one re-deciding tenancy locally. Findings A1 and A2 are both
instances of a hand-rolled variant getting it wrong.

**Why it matters:** this is the root cause, not a style issue. Every unconverted call site is a
place the next tenancy bug can appear, and there is no single place to add an audit log or a test.

**Fix:** treat A1/A2 as the first two of a migration. Convert route modules to
`resolveStoreId(req, req.query.storeId)` / `applyListScope(req, filter)`, highest-value first
(`analytics`, `order`, `items`, `pos`, `store`). Then add a lint rule or a test that greps for the
raw `req.store._id` pattern in `routes/` and fails on new occurrences.

---

**A14. App bootstrap is copy-pasted across all three services**
Severity: **Medium**
`packages/admin/index.js`, `packages/delivery/index.js`, `packages/picking/index.js`

Byte-identical or near-identical across all three:

| block | admin | delivery | picking |
|---|---|---|---|
| `isAllowedCorsOrigin` | `:16-27` | `:16-27` | `:16-27` |
| helmet + mongoSanitize + hpp + no-store headers | `:108-121` | `:48-72` | `:46-64` |
| morgan format string | `:123` | `:73` | `:65` |
| `cors({ origin: ... })` callback | `:127-152` | `:74-100` | `:66-83` |
| `app.all("*")` 404 | `:175-182` | `:104-110` | `:87-93` |
| outer error handler | `:184-190` | `:112-117` | `:95-100` |
| `NODE_ENV !== "test"` listen guard | `:204-208` | `:126-130` | `:107-111` |

The drift is already visible: admin's `helmet()` has **no `hsts` block**, while delivery (`:58-62`)
and picking (`:50-54`) both set `maxAge: 31536000, includeSubDomains, preload`. So the admin panel
— the highest-value target of the three — is the one missing HSTS. That is exactly the kind of
divergence copy-paste bootstraps produce.

**Fix:** extract `createApp({ serviceName, mountPath, routes, limiter })` into
`packages/shared/http/` and have all three `index.js` files reduce to config + `start()`. This also
resolves A10 (one error envelope) and A4/A6/A7 (one error handler) structurally rather than by
porting patches three times.

---

**A15. Controllers reach past the repository layer into Mongoose models**
Severity: **Medium**
8 admin controllers

```js
packages/admin/src/routes/order/controller.js:496       OrderModel.findOne(cond).select(...).lean()
packages/admin/src/routes/pos/controller.js:82,319      OrderModel.getNextSeq / ItemModel.findById
packages/admin/src/routes/transfer/controller.js:166,265 ItemModel.findById / findOne
packages/admin/src/routes/product/controller.js:459,485,690,723,740  ItemModel / OrderModel direct
packages/admin/src/routes/discount-rule/controller.js:134,141
packages/admin/src/routes/replenishment/controller.js:25
packages/admin/src/routes/inventory-group/controller.js:136,158,173,195
packages/admin/src/routes/team/controller.js:5          AdminModel
```

The codebase otherwise has a clean repository layer (`shared/repositories/*`) and most controllers
use it. These bypass it, which means: query shapes duplicated between controller and repository
(`ItemModel.findOne({ _id: storeItemId, storeId }).select("name barcode")` appears in both
`transfer/controller.js:265` and `replenishment/controller.js:25`), no single place to add a
tenancy filter or an index-friendly projection, and controllers that can only be tested against a
live Mongo.

**Fix:** add the missing repository methods (`ItemRepository.getNameAndBarcode(storeItemId, storeId)`,
`ItemRepository.getQuantity(id, session)`) and convert. Prioritise `transfer` and `replenishment`,
where the duplicated query is verbatim.

---

**A16. `__permission` tag is written but never audited**
Severity: **Low**
`packages/admin/src/middleware/permission.js:54-56,71,93,113`

```js
/**
 * The returned function is tagged with `__permission` so we can programmatically
 * audit "does every route declare its required permission?" at boot time.
 */
```

Grep for `__permission` across `packages/admin` (excluding node_modules/coverage) returns exactly
two hits in `permission.js` itself, plus one in a copy-pasteable snippet in `ROLES.md:96`. There is
no boot-time audit. The comment asserts a safety net that does not exist — which is worse than no
comment, because it discourages anyone from building the real check.

**Fix:** either build it (walk `router.stack` at boot, `console.error` any route with no
`__permission`/`__permissionAnyOf`/`__roles` tag) — it's ~15 lines and would have caught the
`/item-frequency` gating question in A2 — or delete the claim from the comment.

---

### Findings — Quality / Cleanliness

---

**A17. `markOrderAdmin` is a 487-line handler nested 7 levels deep**
Severity: **Medium**
`packages/admin/src/routes/order/controller.js:520-1006` (453 non-blank lines; max indentation 28
spaces = 7 levels, at `:667`)

One `try` block handles: status-transition validation, refund clawback on reopen, per-item stock
re-deduction (`:718-727`), slot release, restock guard flags, audit write, and several
fire-and-forget notifications. Sibling offenders in the same package:

```
routes/order/controller.js       1661 lines
routes/transfer/controller.js    1194   (cancelTransfer at :900-1010 has 4 branches × 2 nested loops)
routes/procurement/controller.js 1186
routes/store/controller.js       1079
routes/items/controller.js       1031
```

There is no service layer anywhere in the package — `routes/<x>/{router,controller,validator}.js`
is the entire structure, so all orchestration lands in the controller.

**Why it matters:** at this size the compensation steps can't be unit-tested independently of the
HTTP layer, and a reviewer cannot hold the transaction boundaries in their head — which is how
partial-compensation money bugs get merged.

**Fix:** introduce `routes/<x>/service.js` for the orchestration-heavy modules and move the
transaction bodies there, leaving controllers to parse/validate/respond. Start with
`markOrderAdmin` and `cancelTransfer`; both have clean seams at the `withTransaction` boundary.

---

**A18. Sequential per-row DB calls (N+1) in two admin endpoints**
Severity: **Medium**

`packages/admin/src/routes/warehouse/controller.js:99-112`

```js
const stores = await StoreRepository.getWarehouseEnabledStores();
const rows = [];
for (const s of stores) {
    const wh = await WarehouseRepository.resolveServingWarehouse(s);   // one round-trip per store
    rows.push({ ... });
}
```

`packages/admin/src/routes/stock-alert/controller.js:34-58`

```js
const { groups } = await InventoryGroupRepository.listForStore({ storeId, page: 1, limit: 100 });
const detailed = [];
for (const g of groups) {
    const items = await InventoryGroupRepository.getActiveItemsForGroup(g._id, storeId);  // up to 100 serial queries
    ...
}
```

Both are `await`-in-`for`, so the round-trips are serial, not merely numerous. The `limit: 100` is
also a hardcoded magic number with no comment and no pagination passthrough — the dashboard
silently truncates at 100 groups.

Delivery has a milder version at `packages/delivery/src/routes/order/controller.js:64`:

```js
const stores = await Promise.all(uniqueStoreIds.map((id) => StoreRepository.getById(id)));
```

— parallel, and the comment notes it's bounded to ~2 stores per page, so it is acceptable today but
should be one `find({ _id: { $in } })`.

**Fix:** batch both admin cases into a single `$in` query plus an in-memory `Map` join (the exact
shape `attachIncentiveToOrders` already uses in delivery). Lift the `100` into a named constant and
thread real pagination through `stock-alert/dashboard`.

---

### Package: admin — Summary counts

| Severity | Count |
|---|---|
| Critical | 2 (A1, A2) |
| High | 6 (A3, A4, A5, A6, A7, A8, A13) — 7 |
| Medium | 6 (A9, A10, A14, A15, A17, A18) |
| Low | 3 (A11, A12, A16) |
| **Total** | **18** |

---

## Package: delivery

Delivery is the healthiest of the three: its error handler and connection module have already been
hardened (and carry comments explaining what was fixed and why), and it is the reference
implementation the admin fixes should be ported from.

### Findings — Best Practices / Security

---

**D1. Hardcoded master OTP fallback closes any order**
Severity: **Critical**
`packages/delivery/src/routes/order/controller.js:241` consuming
`packages/shared/config/index.js:55-58`

```js
// shared/config/index.js
otp: {
    userRegistration: process.env.OTP_FOR_USER_REGISTRATION || "995518",
    orderCompletion:  process.env.OTP_FOR_ORDER_COMPLETION  || "898444",
},
```

```js
// delivery/src/routes/order/controller.js:241-243
const matchesMaster   = submittedOtp === otpEnv.orderCompletion;
const matchesOrderOtp = expectedOtp !== "" && submittedOtp === expectedOtp;
if (!matchesMaster && !matchesOrderOtp) { ... }
```

Two problems, in order of severity:

1. **The literal `898444` is committed to the repository.** If `OTP_FOR_ORDER_COMPLETION` is unset
   in any environment, any rider can mark any assigned order CLOSED (delivered) without ever
   meeting the customer, using a value readable in the public-ish source tree. The whole point of
   `deliveryOtp` is customer-presence proof; this is an unconditional bypass of it.
2. **The master OTP works even when it *is* configured.** It is a permanent, non-rotating,
   non-audited, per-deployment shared secret held by every rider. There is no flag on the order or
   the audit row recording that the master path was used, so a fraudulent close is
   indistinguishable from a real one after the fact.

Note the ordering also makes the failure counter misleading: a master-OTP close never increments
the per-order attempt counter (`:244 recordOtpFailure` is only reached when both fail), so the
brute-force guard at `:234-237` has no visibility into master usage.

**Why it matters:** direct route to "delivered but never delivered" — the customer is charged, the
order closes, stock is consumed, and the rider is credited. This is the single highest-impact
finding in this package.

**Fix, in priority order:**
1. Remove the `|| "898444"` and `|| "995518"` literals from `shared/config/index.js`. Fail boot if
   the env var is missing rather than falling back to a known constant.
2. Decide whether the master OTP should exist at all. If it must (dispatch override for a dead
   customer phone), stamp `meta.closedViaMasterOtp = true` on the order and write an
   `OrderAuditRepository` row with the rider id, so it is reviewable.
3. Use `crypto.timingSafeEqual` on both comparisons.
4. Rotate the value in every environment once (1) ships.

---

**D2. Refund on the emptied/cancel path is not bounded by `computeRefundOwed`**
Severity: **High** — see P1; the *correct* pattern lives in this file
`packages/delivery/src/routes/order/controller.js:141-145` (correct) vs
`packages/picking/src/routes/task/controller.js:80-95` (incorrect)

Delivery does this right, and the comment at `:122-140` explains exactly why:

```js
const refundUndeliveredOrder = async ({ order, reason }) => {
    const owed = refundUtils.computeRefundOwed(order);   // captured + walletUsed − alreadyRefunded
    if (Math.floor(owed.amount) < 1) return { amount: 0, walletLogId: null };
```

Recorded here because the divergence is the finding; the defect itself is in picking (P1).

---

**D3. Validation failures return 403 instead of 400**
Severity: **Low**
`packages/delivery/src/routes/order/validator.js:38,52,60,68` (all four exported validators)

```js
const { error } = schema.validate(req.body);
if (error) return next(new errorUtils(error.message, 403));
```

A malformed `page` or an out-of-range `lat` is a client input error (400), not an authorization
failure (403). The rider app cannot distinguish "your token is no good, re-login" from "you sent a
bad field", so a validation regression can present to the user as a spurious logout.

Picking has the same pattern (`packages/picking/src/routes/task/validator.js`).

**Fix:** change `403` → `400` in all validators across both packages. Check the rider/picker clients
for any `if (status === 403) logout()` handling before shipping.

---

### Findings — Quality / Reusability

---

**D4. `markDeliveryStatus` is a 250-line handler mixing six concerns**
Severity: **Medium**
`packages/delivery/src/routes/order/controller.js:202-453`

One handler performs: transition-table validation (`:215-231`), OTP verification and brute-force
counting (`:233-254`), the atomic status claim (`:268-276`), stock restock with per-item error
accounting (`:285-309`), slot release (`:315-321`), money refund (`:328-349`), audit write
(`:352-379`), customer push (`:383-397`), incentive upsert (`:402-413`), and address GPS backfill
(`:415-436`).

To its credit the compensation logic is genuinely careful and the comments are excellent —
`:330-343` correctly explains why the refund must read the post-claim document (`item`) while the
non-money compensations read the pre-claim snapshot (`currentOrder`). That subtlety is precisely
why it should not be buried 200 lines into an HTTP handler.

**Fix:** extract `applyUndeliveredCompensations({ order, currentOrder, reason, actor })` into a
service module. It is directly unit-testable and the extraction preserves the `item`-vs-
`currentOrder` distinction as an explicit parameter pair rather than an implicit convention.

---

**D5. Duplicated store-repopulation block (3×) and a locally re-declared reason map**
Severity: **Medium**

Store repopulation, three near-identical copies:

```js
:439-446   if (item && item.storeId) { const s = getStoreIdStr(item.storeId); item.storeId = s ? await StoreRepository.getByFilter({_id:s},{name:1,address:1,phone:1,location:1}) : null; }
:507-509   (same, on populatedOrder, but WITHOUT the getStoreIdStr guard)
:573-580   (same, with the guard)
```

`:507-509` is the odd one out — it skips `getStoreIdStr`, so the corrupt `"[object Object]"` legacy
values that `getStoreIdStr` exists to catch (`:46-54`) would be passed straight into the query
there. Low-probability but it's the exact case the helper was written for.

Locally re-declared enum labels, `:586-593`:

```js
const reasonLabels = {
    too_far: "Too far", already_busy: "Already busy", vehicle_issue: "Vehicle issue",
    store_not_ready: "Store not ready", customer_area_unsafe: "Unsafe area", other: "Other",
};
```

These keys must stay in lockstep with `DeliveryBoyConstant.rejectionReasons` (imported at `:14` and
used for validation at `:525`). Adding a rejection reason to the constant silently produces a raw
snake_case string in the admin push (`:596` falls back to `reasonCode`).

Similarly `restockStatuses` at `:120` is declared with the comment *"Mirrors the admin controller's
list"* — a duplicated business rule that must not drift, maintained by comment.

**Fix:** (a) extract `repopulateStore(order)` and use it in all three places; (b) move
`reasonLabels` next to `rejectionReasons` in `shared/constants` as a `label` field on each entry;
(c) move `restockStatuses` into `shared/constants/order.constants.js` and import it in both admin
and delivery.

---

**D6. Mixed error-return styles in one controller**
Severity: **Low**
`packages/delivery/src/routes/order/controller.js`

```js
:224  return res.status(404).json({ msg: "Order not found" });        // direct
:230  return res.status(400).json({ msg: "Invalid status transition" });
:527  return next(new errorUtils("Invalid reasonCode. ...", 400));     // via handler
```

Direct `res.json` responses skip the centralized handler entirely, so they get no `code` field, no
sanitized logging, and no `req.log.error` entry. Roughly 10 direct returns vs 2 `next(errorUtils)`
in the same file.

**Fix:** route all error responses through `next(new errorUtils(msg, code))` so the handler owns the
envelope and the logging. (Blocked on A10/one-envelope first, otherwise the shapes change under the
rider client.)

---

**D7. Magic numbers: page size and port default**
Severity: **Low**

```js
:457  OrderRepository.getAllOrdersForDelivery(status, page, 10, req.user._id)   // bare 10
index.js:127  config.deliveryPort || 3000   // same default as admin's config.adminPort || 3000
```

The page size `10` is unnamed and unconfigurable. The `3000` default collides with admin's default,
so two services started without their port env vars fight over the same port — the second gets a
confusing `EADDRINUSE` rather than a clear misconfiguration error.

**Fix:** `const DELIVERY_PAGE_SIZE = 10;` at module top; give each service a distinct port default
(delivery already has `3005` precedent in picking).

---

### Package: delivery — Summary counts

| Severity | Count |
|---|---|
| Critical | 1 (D1) |
| High | 1 (D2 — defect reported under P1) |
| Medium | 2 (D4, D5) |
| Low | 3 (D3, D6, D7) |
| **Total** | **7** |

Already-fixed items re-verified as genuinely fixed: sanitized error logging
(`middleware/error.js:38-51`), explicit 500 for unhandled errors (`:30-35`), CORS header echo
removed (`:9-12` documents the removal), `ReferralMonthlyEarningModel` index force-built at boot
(`connections/mongo.js:33`), correct `appName` tagging (`:14,16`).

---

## Package: picking

### Findings — Best Practices / Money

---

**P1. Emptied-order cancel refunds `order.price` with no `computeRefundOwed` bound**
Severity: **High**
`packages/picking/src/routes/task/controller.js:72-95`

```js
const cancelEmptiedOrder = async ({ orderId, session }) => {
    const order = await OrderRepository.getDetail(null, orderId, session);
    if (!order || (order.items || []).length > 0) return null;

    const prepaid = orderEditUtils.isPrepaid(order.paymentMethod);
    const remainingFees = Math.max(0, Number(order.price) || 0);

    if (prepaid && remainingFees > 0) {
        refundResult = await refundUtils.refundToWallet({ order, amount: remainingFees, ... });
        refundAmount = remainingFees;
    }
```

The amount refunded is the order's residual `price` field. It is never checked against what the
customer actually paid. The sibling path in delivery does exactly that check and documents why
(`packages/delivery/src/routes/order/controller.js:141-145` → `refundUtils.computeRefundOwed`,
defined at `packages/shared/utils/refund.utils.js:115-144`):

```js
amount: Math.max(0, capturedAmount + walletUsed - alreadyRefunded),
```

`refundToWallet` itself does **not** apply that cap — verified at `refund.utils.js:32-50`, it only
validates `amt > 0` and a known reason, then credits unconditionally. So `cancelEmptiedOrder` is
the only thing bounding this payout, and it doesn't.

Concrete risk: `order.refundedAmount` is ignored entirely. `cancelEmptiedOrder` is reachable from
two call sites — `markOutOfStock:608` and `complete:785`, the latter explicitly described at
`:782-784` as a *"Backstop for the all-OOS case (the order should already have been cancelled...)"*.
A backstop that re-runs a refund path with no already-refunded subtraction is precisely the shape
that double-pays. The `(order.items||[]).length > 0` guard at `:74` stops a *second* cancel only if
the first one's item removal committed; it does not inspect `refundedAmount` at all.

**Why it matters:** real money out of the door, on a path whose own comment says it may run twice.

**Fix:** compute the payout through the shared helper so the three paths cannot diverge:

```js
const owed = refundUtils.computeRefundOwed(order);
const payout = Math.min(remainingFees, owed.amount);
if (prepaid && Math.floor(payout) >= 1) { ... refundToWallet({ amount: payout }) ... }
```

Add a test: order where `refundedAmount` already equals the captured total → `cancelEmptiedOrder`
must refund 0. Given the history of snapshot-vs-live money bugs in this codebase, this warrants a
second reviewer on the diff.

---

**P2. Pre-transaction reads used as transaction preconditions (TOCTOU)**
Severity: **Medium**
`packages/picking/src/routes/task/controller.js:742-793` (`complete`), same shape at `:293-351` (`pick`)

```js
const owned = await loadOwnedTask(taskId, req);          // ← reads task OUTSIDE any session
...
const pending = (owned.task.lines || []).filter((l) => l.lineStatus === lineStatus.PENDING);
if (pending.length) { ...return 400... }

session.startTransaction({ readPreference: "primary" });  // ← transaction starts AFTER the check
```

`loadOwnedTask` (`:17-24`) uses `PickTaskRepository.getById` with no session, so under the
service's `secondaryPreferred` read preference it may also be a stale replica read. The
"all lines resolved" invariant is therefore evaluated against a snapshot that is not part of the
transaction, and `PickTaskRepository.complete` at `:793` does not appear to re-assert it.

Practically this needs two devices on the same task, which `loadOwnedTask:22` makes unlikely
(`pickerId` must match). But the same pattern gates the money path in `pick` (`:300` line-status
check outside the session, `:351` transaction opened after), where `line.lineStatus !== PENDING`
is the only thing preventing a line being short-picked twice — and a double short-pick means a
double refund.

**Fix:** make the claim atomic rather than checked-then-done. `PickTaskRepository.updateLine`
should take the expected prior `lineStatus` in its filter and return `null` on mismatch → 409.
Same for `complete`: filter on "no PENDING lines" in the update predicate.

---

**P3. `session.endSession()` reachable twice on the post-commit error path**
Severity: **Low**
`packages/picking/src/routes/task/controller.js:400-402` and `:467-477`

```js
await session.commitTransaction();
committed = true;
session.endSession();              // :402

// ... auditLineChange, notifications ...
} catch (e) {
    if (!committed) { try { await session.abortTransaction(); } catch (_) {} }
    session.endSession();          // :475 — runs again if anything after :402 throws
    throw e;
}
```

`auditLineChange` swallows its own errors (`:58-60`) and the notification calls are `.catch()`-ed,
so today nothing between `:402` and `:467` throws — the bug is latent, not live. `endSession()` on
an ended session is a no-op in the current driver, so impact is nil; it's a correctness smell that
will bite when someone adds an `await` in that window.

The same guarded-`committed` pattern is repeated three times in this file (`:349-350`, `:534`,
`:744`) with slightly different shapes (`markOutOfStock` calls `session.endSession()` at five
separate early-return points, `:541,546,550,554,563`).

**Fix:** wrap in `try { ... } finally { session.endSession(); }` once, and drop the manual calls —
this is what the `finally` block in `delivery/.../controller.js:186-188` already does correctly.

---

### Findings — Reusability / Quality

---

**P4. Six near-identical notification blocks; three defensive existence checks on a static import**
Severity: **Medium**
`packages/picking/src/routes/task/controller.js:423-461, 639-667, 680-718`

Six copies of:

```js
notificationUtils
    .sendUserNotification(order.userId, "<title>", "<body>", { type, orderId, orderDisplayId, ... })
    .catch((e) => console.error("[picking] <label> push failed:", e.message));
```

differing only in title/body/type. And three copies of:

```js
if (notificationUtils.sendAdminStoreNotification) {   // :452, :658, :709
```

— a truthiness check on a property of a statically `require`d module (imported at `:3`). Either the
export exists (it does — delivery calls it unguarded at `delivery/.../controller.js:600`) or the
import is broken and every other call would fail too. This is dead defensive code that reads as if
the export were optional.

**Fix:** `const notifyUser = (order, { title, body, data }) => notificationUtils.sendUserNotification(...).catch(...)`
at module top; drop the three `if` guards.

---

**P5. `markOutOfStock` is 200 lines with five separate `endSession()` exits**
Severity: **Medium**
`packages/picking/src/routes/task/controller.js:532-735`

The handler opens the session at `:533` — *before* any validation — then has to remember to
`session.endSession()` on each of five validation early-returns (`:541, 546, 550, 554, 563`) before
the transaction even starts. Opening the session after validation would remove all five.

`packages/picking/src/routes/task/controller.js` is 816 lines total; this handler and `pick`
(`:293-481`, 188 lines) are 48% of it. As with admin, there is no service layer — the transaction
bodies, the money math orchestration, the audit, and the notifications all sit in the HTTP handler.

**Fix:** move `session = await mongoose.startSession()` to just before `session.startTransaction()`
at `:558`, deleting five cleanup calls. Then extract the transaction body into a service function.

---

**P6. Connection module is the least-hardened of the three**
Severity: **Low** (boot-swallow itself counted under A8)
`packages/picking/src/connections/mongo.js` (23 lines, vs delivery's 55 and admin's 162)

Picking has no `ensureIndexesFor` call and no `missingIndexes` visibility check. Delivery's file
carries a pointed comment at `:23-33` explaining that this service *"built ZERO indexes until now"*
and that under `secondaryPreferred`, `Model.init()` resolves having created nothing — silently.

Picking writes to `pick_tasks` (claim/updateLine/complete), and `PickTaskRepository.claim` is
described at `controller.js:190-194` as *"atomic (only one picker can win)"*. If that atomicity
rests on a unique index rather than purely on a `findOneAndUpdate` predicate, the same
silent-no-build issue applies here. I did not open the repository to confirm which mechanism it
uses — flagging for the owner to check rather than asserting a defect.

This is downstream of the known platform-wide `autoIndex` issue, so it is noted rather than scored
as new.

**Fix:** confirm whether any picking-side uniqueness is index-enforced. If so, add the
`mongoIndexUtils.ensureIndexesFor([...]) + missingIndexes(...)` pair that delivery uses at `:33-47`.

---

**P7. Validation failures return 403 instead of 400**
Severity: **Low**
`packages/picking/src/routes/task/validator.js` — same defect as D3, same fix.

---

### Package: picking — Summary counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 (P1) |
| Medium | 3 (P2, P4, P5) |
| Low | 3 (P3, P6, P7) |
| **Total** | **7** |

Already-fixed items re-verified as genuinely fixed: explicit 500 for unhandled errors
(`middleware/error.js:20-24`), sanitized `logRecord` logging (`:26-36`), no CORS header echo
(`:5-7` documents the removal), correct `appName` tagging (`connections/mongo.js:8,10`).

---

## Common patterns across admin / delivery / picking

**1. Fix-forward drift: delivery and picking were hardened, admin was not.**
Six of the eight pre-reported items (A4–A8, plus the CORS echo) are cases where delivery and
picking carry the corrected code *with comments explaining the fix*, and admin still has the
original. `packages/delivery/src/middleware/error.js:5-17` is effectively a changelog of what admin
still needs. Admin is the largest, most privileged, and most internet-exposed of the three — the
worst one to leave behind. **Port delivery's `error.js` to admin wholesale**; it is the single
highest-value change in this report and it is nearly a copy-paste.

**2. Security controls at partial adoption.** Three separate controls exist, are well-written and
well-documented, and are applied to a minority of their surface:
- `redactCostPrice` — 2 of 30 routers (A3)
- `inventory-context.resolveStoreId` / `applyListScope` — 5 of ~30 route modules (A13)
- `normalizeId` case-normalisation — used in `inventory-context.js`, not in `auth.js` (A12)

The recurring shape is: a bug is found, a correct helper is written at the site of the bug, and the
sweep to the other call sites never happens. A1 and A2 are the direct consequence. **For each of the
three, either finish the adoption or add a check that fails on new unconverted call sites** — a
half-adopted control is more dangerous than none, because it reads as "handled."

**3. Copy-pasted bootstrap, already drifting.** `index.js` is ~85% identical across all three
services (A14), and the drift has begun: admin is missing the `hsts` block that delivery and
picking both have. Every error-handler fix in this report has to be applied three times because of
this. **Extract `createApp()` into `packages/shared/http/`.**

**4. Four error envelopes across three services.** `{code, error, data, message}` (admin inner),
`{code, error, data, msg}` (delivery/picking inner), `{error}` (all three outer). Plus ~10 direct
`res.status(...).json({msg})` returns in delivery/picking that bypass the handler entirely (D6).
**One envelope, exported from shared, mounted at app level.**

**5. Boot proceeds on DB failure in all three services.** Identical
`catch { console.log(...) }` at `admin/.../mongo.js:157`, `delivery/:50`, `picking/:18` (A8). It
also disarms `dbSafetyUtils.assertSafeMongoDbUri` — the test-safety guard — in all three.
**Rethrow and exit non-zero.**

**6. No service layer anywhere.** The structure is uniformly
`routes/<x>/{router,controller,validator}.js`; all orchestration, transaction management, money
math and notification fan-out lives in controllers. Result: 1661/1194/1186-line admin controllers,
a 487-line `markOrderAdmin`, a 250-line `markDeliveryStatus`, a 200-line `markOutOfStock` — none
testable below the HTTP layer. This is the structural reason the transaction-boundary findings (P2,
P3) are hard to see in review. **Add `service.js` to the transaction-heavy modules first**
(`admin/order`, `admin/transfer`, `delivery/order`, `picking/task`).

**7. Secrets with hardcoded fallbacks.** `shared/config/index.js:56-57` ships working default OTPs
(D1). Worth grepping the rest of `shared/config` for the `process.env.X || "<literal>"` pattern —
if the OTPs have it, other secrets may too. Flagging for the colleague covering `shared`.

**8. Good practice worth preserving.** Not everything here is a finding, and some of it is better
than typical:
- Money handling in POS is careful — `round2` applied to the *sum* with a comment explaining the
  binary-tail reason (`admin/routes/pos/controller.js:345-350`), FEFO cost snapshotted at sale
  (`:306-307`), and an index-alignment assertion on coupon pricing that fails the sale rather than
  mispricing a line (`:296-299`).
- `redactCostPrice` redacts a JSON-safe clone rather than the live body, with the cyclic-ref
  reasoning written down (`middleware/redactCostPrice.js:56-61`).
- Optimistic-concurrency-via-filter is used consistently instead of transactions where transactions
  were causing lock contention, and the reason is recorded
  (`delivery/routes/order/controller.js:203-208`).
- The `// 🚨` convention marking load-bearing hazards (`admin/connections/mongo.js:75, 139`;
  `delivery/connections/mongo.js:23`) is genuinely useful and worth keeping.

These are the parts to protect while fixing the rest.

---

## Overall counts

| Package | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| admin | 2 | 7 | 6 | 3 | 18 |
| delivery | 1 | 1 | 2 | 3 | 7 |
| picking | 0 | 1 | 3 | 3 | 7 |
| **Total** | **3** | **9** | **11** | **9** | **32** |

All 8 pre-reported items were independently re-verified and are included above as A1, A2, A4, A5,
A6, A7, A8, A9. Item 8 (`mongo.js:15-17`) resolved to a concrete defect: the mislabel is on **line
17**, not 15 — the safety assertion is tagged correctly as `adminApp`, the actual `mongoose.connect`
is tagged `userApp`. See A9.
