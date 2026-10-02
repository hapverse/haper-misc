# Backend Structure & Architecture Review — 2026-09-14

Scope: `/Users/office/Documents/haper/haper-backend`, all 7 packages, structure only.
Bug-level and DRY findings are out of scope — see `backend-code-quality-audit.md`.

---

## 1. Dependency graph & service boundaries

### Declared graph (`packages/*/package.json`)

```
        admin_service ─┐
        auth_service  ─┤
        cron          ─┼──► shared ──► (nothing declared — see §3)
        delivery_svc  ─┤
        picking_svc   ─┤
        user_service  ─┘

  no package depends on any package other than `shared`
```

Confirmed by grep: there is exactly **one** cross-package relative require in the
whole repo, and it reaches sideways into `shared` rather than through the package name:

- `packages/admin/src/routes/analytics/validator.js:2`
  `require('../../../../shared/constants')` — should be `require("shared")` like the
  other 181 call sites (174 `require("shared")` + 7 `require('shared')`).

There are **no cycles between packages** and **no service reaches into another
service's `src/`**. On the coarse measure, boundaries are clean.

### Actual runtime graph (what the code really couples to)

The declared graph understates the coupling, because `shared` is not a thin kernel —
it is where the domain lives (§3). The honest picture:

```
  admin  user  delivery  picking  cron  auth        ← 6 HTTP/scheduler shells
    │      │      │        │       │      │            (~29k LOC of controllers)
    └──────┴──────┴────────┴───────┴──────┘
                      │
                      ▼
        shared/utils        (8.2k LOC — de-facto domain/service layer)
                ▲   │
                │   ▼        ← MUTUAL (cycle, §3)
        shared/repositories  (15.3k LOC — fat repos w/ domain rules)
                      │
                      ▼
        shared/models        (3.8k LOC Mongoose schemas)
                      │
                      ▼
              one MongoDB cluster, shared by all 6 processes
```

Every process opens its own connection to the **same database and same
collections** (`packages/*/src/connections/mongo.js`, 6 divergent copies). There is no
per-service data ownership. So these are not services in the SOA sense — they are six
deployment slices of one monolith, separated by *client audience*, not by *domain*.

### Boundary bleed that matters

1. **Order status is a cross-package free-for-all.** `orderStatus.*` is written in 11
   files across 5 packages (admin/order, admin/pos, cron ×4, delivery/order,
   picking/task, user/order, user/profile, user/razorpay). There is no single
   transition guard. Two partial ones exist and disagree in shape:
   - `packages/delivery/src/routes/order/controller.js:215` — an `allowedTransitions`
     map, enforced at :229.
   - `packages/admin/src/routes/order/controller.js:1068` — an `assignableFrom` array
     used as a query filter, not as a guard.
   Everyone else transitions with no check. This is the single largest structural
   risk in the backend (§5).

2. **Transaction (unit-of-work) boundaries live in the web layer.** `mongoose.startSession`
   appears in **17 files**, all of them controllers or cron jobs — e.g.
   `packages/user/src/routes/order/controller.js:847,1165,1414`,
   `packages/admin/src/routes/pos/controller.js:194`,
   `packages/picking/src/routes/task/controller.js:348`. Because the transaction is
   opened by the HTTP handler, no other entrypoint can reuse that use-case — which is
   precisely why admin/pos and user/order each grew their own checkout path.

3. **`auth` is a boundary with no owner.** `packages/auth` and
   `packages/user/src/routes/auth` are two implementations of the same three flows
   (otp 122 vs 143 LOC, refresh 38 vs 39, google-auth 159 vs 170), and *both* are
   deployed (`ecosystem.config.js` starts `Haper_Prod_Auth`). Structurally, login is
   owned by nobody: two processes can diverge on the same identity lifecycle.

4. **Admin-only logic parked in `shared`.** `stockLedgerUtils`, `storeCloneUtils` and
   `auditUtils` are consumed by **admin only**; `s3Utils` by admin + delivery. They sit
   in the shared kernel because that's where the repo puts non-controller code, not
   because they are shared.

5. **Good news — stock mutation is properly funnelled.** No package mutates item stock
   directly; every write goes through `ItemRepository.decrementIfAvailable` (:1061),
   `sellFEFO` (:1100), `applyStockIn` (:1179), `findOneAndUpdateAtomicQty` (:1472).
   This is the one domain invariant with a real chokepoint, and it should be the model
   for order status.

---

## 2. Layering consistency — verdict per package

The repo has a genuine, **consistently applied** convention:

```
src/routes/<domain>/router.js      declarative only — middleware chain + handler refs
src/routes/<domain>/validator.js   Joi
src/routes/<domain>/controller.js  EVERYTHING else
src/middleware/                    per-package cross-cutting
src/connections/mongo.js           per-package DB bootstrap
```

Grep confirms routers are clean everywhere: **zero** inline `router.get(..., async ...)`
handlers in any `router.js` in any package. That is better discipline than most repos
of this size.

The uniform gap is equally clear: **there is no service layer in any package.** There
are 0 files named `*.service.js` in the entire repo. The layering is
`router → controller → shared/repos + shared/utils`. Controllers therefore carry
orchestration, transactions, HTTP shaping and presentation in one function.

| Package | Layering verdict | Evidence |
|---|---|---|
| **admin** | **Inconsistent / fattest.** 30 route modules, correct r/v/c triads, but controllers are orchestration monsters and 8 of them bypass the repository layer to hit Mongoose directly. | `routes/items/controller.js` (1031 LOC, **16** direct `*Model.<op>` calls), `routes/product/controller.js` (814 LOC, 15), `routes/warehouse/controller.js` (607, 8), `routes/transfer/controller.js` (1194 LOC), `routes/procurement/controller.js` (1186), `routes/order/controller.js` (1661). The only proto-service in the repo is `routes/order/helper.js` (75 LOC) — one domain out of thirty. Richest middleware layer (`permission.js`, `redactCostPrice.js`, `inventory-context.js`, `taxonomy-input.js` 318 LOC) — several of these are doing domain work in a middleware slot. |
| **auth** | **Structurally correct, semantically redundant.** 3 route triads, thin controllers, `src/middleware/error.js` only. Nothing wrong with the shape — the problem is it is a duplicate of `user/src/routes/auth/*` and still in `ecosystem.config.js`. |
| **cron** | **No layering at all, and it is arguably fine.** `index.js` (14 LOC) → `src/scheduler.js` (declarative cron table, well commented) → `src/jobs/*.js` (14 jobs). But 5 jobs reach Mongoose directly (`pick-task-reconcile.js` 5 calls, `scheduled-release.js` 3, `product-master-reconcile.js` 3, `account-purge.js` 3, `scheduled-reminders.js` 2), and 3 open their own transactions. The jobs are re-implementing use-cases that also exist in controllers. |
| **delivery** | **Cleanest of the HTTP packages.** 3 route triads; `routes/order/controller.js` (661 LOC) is the only heavy file, and it is the only place in the repo with an explicit state-transition table (:215–229). Zero direct model access. |
| **picking** | **Clean shape, one heavy controller.** 4 triads + `middleware/capability.js` (30 LOC, a nice narrow authz seam). `routes/task/controller.js` (816 LOC) owns transactions (:348) and has a private domain helper `cancelEmptiedOrder` (:72) that is really a service function living in a controller file. Zero direct model access. |
| **shared** | Not layered as a package — see §3. |
| **user** | **Consistent but with the single worst file in the repo.** 13 route modules, triads throughout, plus the only nested route group (`routes/auth/{otp,google,refresh}` + `routes/auth/otpCache.js`) — a naming divergence from every other package. `routes/order/controller.js` is **2609 LOC**: presentation logic (`presentOrderStatus`, `clientKnowsPickStatuses` — client build-number gating at :29–56), pricing ("SINGLE SOURCE OF TRUTH — PRICING" comment banner at :58), three separate transaction scopes, and 14 repositories + 14 utils destructured in one import. |

**Repo-wide numbers:** 29,038 LOC in `packages/*/src/routes/**`; 64 direct
`*Model.<op>` call sites outside `shared` across 20 files.

---

## 3. `packages/shared`'s structural role

Verdict: **it is not a shared kernel — it is the application core, with the six
packages as thin(ish) delivery adapters on top.** 27.3k LOC (repos 15.3k + utils 8.2k +
models 3.8k) versus 29k LOC of controllers. That is a legitimate architecture
(hexagonal-ish: core + adapters), but the repo does not *name* it that, so the core has
none of the protections a core needs.

Four structural problems:

**a) `utils/` ↔ `repositories/` is a cycle, worked around 8 times.**
41 of 44 repositories require `../utils`; 16 utils require `../repositories` or
`../models`. The cycle is broken by deferred requires with explicit comments:

- `utils/coupon-flow.utils.js:31`, `utils/coupon.utils.js:44`, `utils/discount.utils.js:97`,
  `utils/gift.utils.js:24`, `utils/order-edit.utils.js:28`, `utils/pick-task.utils.js:41`,
  `utils/stock-ledger.utils.js:11`, `events/order.handler.js:11` — all
  `const lazyRepos = () => require("../repositories")`.
- `utils/jwt.utils.js:35` — "Lazy require to avoid a circular import".
- `utils/store-clone.utils.js:21-23`, `utils/order-event.utils.js:31`,
  `utils/distributed-cache.utils.js:192` — in-function requires for the same reason.

This is the clearest signal that `utils/` is misnamed. The files doing this
(`coupon-flow`, `gift`, `order-edit`, `pick-task`, `stock-ledger`, `refund`, `discount`)
are **domain services**, not utilities. They belong in a `shared/domain/` (or
`shared/services/`) layer that sits *above* repositories — at which point the cycle
disappears by construction.

**b) `utils/` is two different things under one name.** Genuine leaf helpers
(`ean.utils.js`, `unit-price.utils.js`, `html-sanitize.utils.js`, `common.utils.js`)
sit beside 400–1000 LOC domain engines (`discount.utils.js` 1021,
`notification.utils.js` 648, `coupon.utils.js` 474, `order-edit.utils.js` 463,
`coupon-flow.utils.js` 369). Nothing in the folder name or `index.js` distinguishes
"pure function, safe to call anywhere" from "opens DB reads and mutates orders."

**c) It leaks Express.** `shared` claims no framework, but:
- `utils/jwt.utils.js` — `authenticate`, `authenticateDeliveryBoy` (:172),
  `authenticatePicker` (:245), `authenticateAdmin` (:304) are all Express middleware
  (`(req, res, next)`), and `authenticateAdmin` has **zero callers** (admin uses its own
  `src/middleware/auth.js`) — dead framework surface in the kernel.
- `utils/s3.utils.js:54,92,145` — returns multer-wrapped Express middleware.
- `utils/common.utils.js:5` — `rolesCheck(req, res, next)` returning `res.status(403)`.
- `utils/requestId.js:24` — Express middleware.
- `utils/audit.utils.js:37-39` — reads `req.admin`, `req.ip`, `req.headers`.

These should be a separate `shared/http/` (or per-package middleware) entry point, so
that the domain half of `shared` stays callable from cron, scripts and tests with no
Express object in scope.

**d) It is not independently resolvable.** `packages/shared/package.json` declares
**no dependencies** (it uses mongoose, moment-timezone, ioredis, firebase-admin,
pdfkit, razorpay, @aws-sdk/*, all hoisted from the root). Structurally this means
`shared` cannot be versioned, extracted, or installed on its own — the "package"
boundary is cosmetic. (Flagged in the code-quality audit as a dependency bug; the
structural consequence is that the kernel has no enforceable contract.)

**Minor:** naming drift inside the folder — `utils/lockUtils.js` and `utils/requestId.js`
break the `*.utils.js` convention every other file follows; `models/*.schema.js` export
compiled models, not schemas.

---

## 4. Monorepo / module organization

**Workspace:** npm workspaces (`package.json` `"workspaces": ["packages/*"]`) with
Lerna present but vestigial — `lerna.json` is 4 lines (`useWorkspaces: true`, version
1.0.0), no lerna command appears in any script. Lerna can be dropped with no behaviour
change.

**Package boundary vs deployment boundary:** 1:1 and clean. Six packages → six PM2
apps in both `ecosystem.config.js` and `ecosystem.dev.config.js`; `shared` is the only
non-deployed package. Cron is correctly `exec_mode: 'fork', instances: 1` (the other
five are `cluster` with `instances: '1'` — a string, which works but is sloppy and
means nobody has actually tried to scale out).

**Naming:** inconsistent. Five packages are `<x>_service`, one is bare `cron`. Folder
names are `admin/auth/cron/delivery/picking/user` while npm names are
`admin_service/auth_service/cron/delivery_service/picking_service/user_service`, so
`npm test --workspace=packages/admin` and the PM2 app name and the npm package name are
three different strings for the same thing.

**Would it scale to a 10th package?** Not cleanly. Adding one today requires
hand-copying, in seven places:

1. `packages/<new>/index.js` — a 119–218 LOC bootstrap (helmet/cors/hpp/mongoSanitize/
   rate-limit/morgan/requestId/error handler/`NODE_ENV !== "test"` listen guard).
2. `src/connections/mongo.js` — all 6 existing copies already differ from each other.
3. `src/middleware/error.js` — 4 copies at 92/84/63/62/47 LOC that have **materially
   diverged**: `diff packages/admin/.../error.js packages/user/.../error.js` shows user
   handles `err.code === 11000` and axios errors and defaults to 500, admin's ordering
   differs, and only user emits `body.details`.
4. `jest.config.js` — 6 copies, with admin's deliberately different (`collectCoverage:
   false`, documented in-file).
5. Root `package.json` — `test:<new>`, plus the `start:all`/`dev:all` concurrently strings.
6. Both `ecosystem*.config.js` files.
7. `.github/workflows/ci.yml` — a fresh ~15-line job block.

The copy-paste bootstrap has already produced **silent security drift**: HSTS is
configured in `packages/delivery/index.js` and `packages/picking/index.js` only —
`admin`, `auth` and `user` have none. That is the structural cost made concrete.

**Also structural:** `.github/workflows/ci.yml` triggers on
`pull_request: branches: [main]`, while the team's workflow is direct-push-to-`dev`
with no PRs. The test suite is wired to a branch flow the repo does not use, so in
practice nothing gates a push. (Noted here as a deployment-boundary issue, not
re-auditing the suite itself.)

`coverage/lcov-report/` is committed-adjacent clutter in admin (264 files), user (212),
auth (36) and delivery (34) — it dominates any `find` over those packages.

---

## 5. Architectural pattern verdict + scale risk

**What it actually is:** a **modular monolith deployed as an audience-sharded fleet**.
One domain core (`shared`), one database, six Express/cron processes each exposing that
core to a different client (customer app, admin panel, rider app, picker app, scheduled
work, legacy auth). It is *not* microservices — no service owns its data, no service
calls another over the network, and all six restart against the same schema. Calling
the packages "services" (`admin_service`, etc.) is the main misleading thing about the
repo.

**Is that appropriate?** Yes. For a quick-commerce app at this stage — a handful of
stores, one cluster, a small team — a modular monolith with per-audience processes is
the correct, boring choice. It gives independent restart/blast-radius per client,
per-audience rate limits and auth, and one deploy of shared logic. Splitting the
database per package would be strictly worse right now. The two structural deviations
from the honest version of this pattern are: (a) the core is called `utils`/`repos`
instead of a domain layer, and (b) there is no service layer, so use-cases are welded
to Express.

**Biggest structural risk if scope/team doubles in the next year:**

> **Order state has no owner, and the code that changes it is welded to controllers.**

Concretely: an order's status is written from 11 files in 5 packages with two
disagreeing partial guards; the transaction that makes each of those writes safe is
opened inside the HTTP handler; and no unit-of-work is reusable across entrypoints.
Today that works because one or two people hold the whole state machine in their heads.
With double the team, every new surface (returns, B2B, a second rider app, a webhook
partner) becomes an 11th, 12th and 13th place that writes `orderStatus` — and the first
symptom is customer-visible: an order in a state no reader expects, or a stock
decrement that a compensating path never reverses because its transaction lived in a
controller nobody reused.

Second risk, same root: **the `utils ↔ repositories` cycle**. Eight documented
`lazyRepos()` workarounds is the system telling you the layer is missing. Each new
domain util adds a ninth. Left alone, boot order becomes load-bearing and untestable.

Third: **admin is becoming a monolith inside the monolith** — 30 of the repo's 53 route
modules, with the six largest controllers. If the team grows, admin is where the merge
conflicts and the "who owns this" arguments will happen first.

---

## 6. Testability implications

The structure makes **integration testing easy and unit testing near-impossible**, and
the test suite has adapted to exactly that.

- **203 test files, 156 of them use supertest** (77%). Every meaningful assertion goes
  through an HTTP request against a booted app with in-memory Mongo
  (`packages/*/jest.config.js` → `__tests__/setup.js`, `maxWorkers: 1`,
  `testTimeout: 30000`).
- **`packages/shared` has zero tests and no jest config** — the 27.3k LOC that contains
  essentially all the business rules (pricing, FEFO, coupons, gifts, refunds, pick-task
  lifecycle) is only ever exercised transitively, through another package's HTTP layer.
  That is the headline testability finding.
- **Root cause is the missing service layer.** A use-case like "place an order" exists
  only as `packages/user/src/routes/order/controller.js` lines ~847–1400, where the
  function signature is `(req, res, next)` and the transaction is opened inline. There
  is no callable `placeOrder(input)` to unit-test, so the only way to test it is to send
  an HTTP request. Same for POS checkout, transfer receipt, pick completion.
- **Consequences that are already visible:** admin's suite is 1172 tests in one
  `--runInBand` process and had to disable coverage to stop hitting node's 2 GB heap cap
  (documented at length in `packages/admin/jest.config.js`); CI needs
  `NODE_OPTIONS: --max-old-space-size=4096` as headroom. Slow, serial, DB-backed tests
  are the direct cost of having no unit-testable seam.
- **What *is* testable in isolation and mostly isn't tested:** the pure leaf utils
  (`unit-price.utils.js`, `ean.utils.js`, `sku-identity.utils.js`, `taxonomy.utils.js`,
  `discount.utils.js`'s pure-calculation half) — these need no DB at all.
- **Repositories are the one good seam** and they are fat enough to be worth testing
  directly (`ItemRepository.sellFEFO`, `decrementIfAvailable`,
  `SlotCapacityRepository.reconcile`). They take an optional `session` and return data,
  not responses — a `packages/shared/__tests__` with in-memory Mongo would test them
  without booting any Express app.
- **Express leakage blocks the cheap wins:** `shared/utils/common.utils.js:5`,
  `audit.utils.js:37`, `jwt.utils.js`, `s3.utils.js` all require a `req` to be called,
  so any domain path touching them drags Express into the test.

---

## 7. Top 5 structural recommendations, ranked by impact

### 1. Give order state a single owner — `shared/domain/order-state.js` — **M**
One transition table (`from → allowed[]`) plus a `transition(order, to, ctx)` that every
one of the 11 write sites must go through, exactly as `ItemRepository` already owns every
stock mutation. Seed it from `packages/delivery/.../order/controller.js:215` (the only
real table today) merged with admin's `assignableFrom` (:1068). Do not try to move the
writes into it in one pass — land the guard, route the two riskiest callers (user/order,
picking/task) through it, then migrate the rest.
*Also resolves:* the schema-hook lifecycle-event problem from the code-quality audit —
once every transition passes one function, emitting the event there is correct
regardless of whether the write used `save()`, `updateOne` or `bulkWrite`.

### 2. Rename the missing layer into existence: `shared/utils` → `shared/domain` + `shared/utils` — **M**
Split by the test that already exists in the code: any file with a `lazyRepos()` is a
domain service (`coupon-flow`, `coupon`, `discount`, `gift`, `order-edit`, `pick-task`,
`stock-ledger`, `refund`, `store-clone`) and moves to `shared/domain/`, which is allowed
to depend on `repositories`; what remains in `utils/` is leaf-pure and may not.
The 8 `lazyRepos()` workarounds then delete themselves. Mechanical move + re-export from
`shared/index.js` keeps all 181 `require("shared")` call sites working, so it is
low-risk despite the file count.
*Also resolves:* nothing from the quality audit directly, but it is the precondition for
recommendation 4.

### 3. Extract one shared service bootstrap — `shared/http/createService()` — **S/M**
Collapse the six 119–218 LOC `index.js` files, six `connections/mongo.js` and four
`middleware/error.js` into one parameterised factory (name, port, CORS policy, router,
extra middleware). Today's copies have already drifted into a real gap — HSTS exists
only in `delivery` and `picking`; the error handlers differ on duplicate-key, axios and
`details` handling. Note the error handler must live behind an Express-only entry
(`shared/http/`), not in the domain half (§3c).
*Also resolves:* the code-quality audit's "two error handlers per service", the
`msg`/`message` envelope drift, and the copy-pasted `connectDb` with the swallowed catch
— all three become one file.

### 4. Add `packages/shared/__tests__` and test the domain directly — **M**
Once 2 lands, `shared/domain/*` and `repositories/*` are callable without Express, so
in-memory-Mongo unit tests become possible for pricing, FEFO, coupons, gifts and refunds
— the rules that currently have no direct test at all. Start with the pure utils (no DB
needed) and `ItemRepository.sellFEFO`/`decrementIfAvailable`. Side benefit: it moves
assertions off the admin HTTP suite, which is the one fighting the 2 GB heap ceiling.

### 5. Retire `packages/auth` — **S**
It is a byte-for-byte-ish duplicate of `user/src/routes/auth/*` (671 LOC across the two
copies) and is still started as `Haper_Prod_Auth` in `ecosystem.config.js`, so both are
live and can diverge on the identity lifecycle. Decide one owner (user, per the
"login belongs to the identity-owning service" rule), point the clients at it, then
remove the PM2 entry *before* deleting the package. Cheap, and it removes a whole
deployed process from the fleet.
*Also resolves:* the code-quality audit's "frozen but still deployed duplicate service"
— note that "frozen" is a comment, not a deployment state: it is still listening.

**Deliberately not recommended:** splitting the database per package, introducing a
message broker, or converting any package to a real microservice. Nothing in the current
load profile buys anything from those, and each is a one-way door.

---

### Smaller structural items (cheap, do opportunistically)
- `packages/admin/src/routes/analytics/validator.js:2` — `require('../../../../shared/constants')`
  → `require("shared")`; it is the only path-based cross-package require left.
- Delete `lerna.json` + the lerna devDependency (unused; npm workspaces does the work).
- Normalise package names (`cron` → `cron_service`, or drop `_service` from all five).
- `shared/utils/lockUtils.js`, `shared/utils/requestId.js` → `*.utils.js` naming.
- Remove `jwtUtils.authenticateAdmin` (`shared/utils/jwt.utils.js:304`) — zero callers.
- Gitignore/remove the committed `coverage/lcov-report/` trees (546 files across 4 packages).
- Point `.github/workflows/ci.yml` at `dev` (or at push), since no PRs to `main` are opened.
