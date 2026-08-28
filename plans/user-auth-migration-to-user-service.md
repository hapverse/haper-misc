# Plan — Move customer auth into `packages/user` (Phase A)

**Author:** Shavinder (planner) · **Date:** 2026-08-28 · **Status:** DRAFT — needs user approval before any code is written
**Repo:** `haper-backend` · **Branch target:** `dev` (direct-to-dev per project rules)

---

## 0. Correction to the briefing (read this first)

The briefing said: *"despite the folder name 'google-auth' this is NOT real Google OAuth — it's the phone/OTP registration + phone-verification flow."*

**That is incorrect.** I read `packages/auth/src/routes/google-auth/controller.js` in full. It **is** real Google Sign-In:

- It imports `OAuth2Client` from `google-auth-library` and calls `client.verifyIdToken({ idToken, audience: [google.idWeb, google.idiOS, google.idAndroid] })`.
- `register` verifies a Google ID token, checks `payload.email_verified`, and either logs the user in (if an account with that email already has a phone) or returns `requiresPhoneVerification: true`.
- `verifyPhone` re-verifies the same Google ID token **and** checks an SMS OTP, then links/creates the account with `sType = GOOGLE`, `sId = <google sub>`.

This matters for the plan because it means the migration carries a **third-party dependency** (`google-auth-library` + three Google client IDs) and a **test-harness gap** (see §8) that a pure phone/OTP move would not have.

The phone-only OTP flow is the separate `otp/` router. Both are in scope.

---

## 1. Overview

### Goal

Stand up the customer-facing authentication endpoints **inside `packages/user`**, at `/user/auth/*`, functionally identical to the ones `packages/auth` serves today at `/auth/*`, so that new mobile/web builds can talk to a single host for both auth and API. `packages/auth` keeps running **completely untouched** for the multi-month tail of old app builds.

### Acceptance criteria (what "done" means)

- [ ] `GET /user/auth/otp/get-otp?countryCode=91&phoneNumber=9XXXXXXXXX` returns the same JSON shape as `GET /auth/otp/get-otp` (`{ msg, data: { message, new } }`) and actually sends an SMS in dev.
- [ ] `POST /user/auth/otp/login` returns `{ msg: "User LoggedIn", data: { user, accessToken, refreshToken } }` — byte-identical shape to the old endpoint, including the soft-deleted-account `restoreToken` branch and the `410` branch.
- [ ] `POST /user/auth/google/register` and `POST /user/auth/google/verify-phone` behave identically to their `/auth/google/*` twins, including the `requiresPhoneVerification` response and the "phone already linked to another Google account" 400.
- [ ] `POST /user/auth/refresh` returns `{ msg, data: { accessToken } }` identically, including the fingerprint-mismatch 401.
- [ ] **An access token minted by `packages/user` is accepted by every existing `/user/*` route** (`jwtUtils.authenticate`) and by any other service that verifies user tokens — and vice versa: a token minted by `packages/auth` today keeps working. Proven by a test, not by inspection.
- [ ] **These new routes work with NO `x-store-id` / `x-user-latitude` / `x-user-longitude` headers** — a logging-in user has not picked a store yet. (This is the single biggest trap; see §4.)
- [ ] An OTP requested at `/auth/otp/get-otp` can be redeemed at `/user/auth/otp/login` and vice versa (shared Redis OTP cache) — so a client mid-upgrade cannot get stuck.
- [ ] Dedicated per-route rate limiters exist on all five new routes (§6).
- [ ] **`git diff` shows ZERO files changed under `packages/auth/`.**
- [ ] `cd packages/auth && NODE_ENV=test npx jest` is still fully green and unchanged.
- [ ] `cd packages/user && NODE_ENV=test npx jest` is green, with new auth tests at coverage parity with `packages/auth/__tests__`.
- [ ] `haper-misc/test-user-auth.md` walkthrough exists and is current (project rule: test guides stay in sync).

### Explicitly out of scope for Phase A

- Deleting, freezing, or modifying `packages/auth` in any way.
- Any client-app change (Android / iOS / web) — those are separate deliveries that flip a base URL.
- Any change to token contents, expiry, refresh-rotation design, or the User schema.
- Decommissioning (Phase B — §11).

---

## 2. Current state (verified by reading the code)

### `packages/auth`

| Item | Value |
|---|---|
| Mount | `app.use("/auth", apiLimiter, routes)` — `packages/auth/index.js:83` |
| Port | `config.authPort` → `AUTH_PORT` (`.env.example` = 9001) |
| App-level limiter | 100 req / 15 min per IP (`index.js:39-43`) |
| Per-route limiter | **NONE** — pre-existing gap |
| CORS | custom `isAllowedCorsOrigin()`: any `*.haper.in` host + `http://localhost:5173`, plus `config.corsOrigin` list |
| Error handling | inline handler in `index.js:95` + `src/middleware/error.js` inside the router |
| Tests | `__tests__/{otp,google-auth,refresh,health}.test.js` — 19 + 5 + 5 `it()` blocks |

Effective public paths today:

```
GET  /auth/health
GET  /auth/otp/get-otp
POST /auth/otp/login
POST /auth/google/register
POST /auth/google/verify-phone
POST /auth/refresh
```

**All real logic already lives in `shared`.** The controllers are thin glue over:
`shared.utils.{smsUtil, jwtUtils, distributedCacheUtils, commonUtils, errorUtils}`,
`shared.repos.UserRepository`, `shared.constant.{GeneralConstant, UserConstants}`,
`shared.config.{google, otp, smsOtpExpiry, smsUserReqExpiry}`, `shared.emitters`.
`packages/auth/package.json` declares exactly one dependency: `"shared": "^1.0.0"`. `google-auth-library@^9.15.1` resolves from the **hoisted root `node_modules`** (root `package.json` `workspaces: ["packages/*"]`).

### `packages/user`

| Item | Value |
|---|---|
| Mount | `app.use("/user", apiLimiter, getGeoAndStore, routes)` — `packages/user/index.js:64` |
| Port | `config.userPort` → `USER_PORT` (`.env.example` = 9002) |
| App-level limiter | **1000 req / 5 min per IP** — i.e. ~30x looser than the auth service's 100/15min |
| CORS | `origin: config.corsOrigin` (plain list from `CORS_ORIGIN`), `credentials: true` |
| Geo gate | `getGeoAndStore` runs on **every** `/user/*` request |
| Aggregator | `src/routes/index.js` — health, home, profile, address, item, cart, coupon, order, razorpay, wallet, store, config. **No `auth` mount.** |
| deps | `shared`, `axios` |
| Tests | 50 test files, `jest.config.js` with `clearMocks: true`, `maxWorkers: 1` |

### Shared plumbing both services already use identically

- `packages/shared/config/index.js`: `jwtSecret = process.env.JWT_SECRET`, `jwtSecretRefresh = process.env.JWT_SECRET + "_ReFrEsH_9999_"`, `jwtExpiry = "15m"`. **One secret, one config module, both packages `require("shared")`.**
- `packages/shared/utils/jwt.utils.js`: `sign`, `signRefresh`, `verifyRefresh`, `signRestore`, `authenticate`, `generateFingerprint`.
- `packages/shared/events/emitter.js` binds `logged-in` → `login.handler.loggedIn`, loaded on `require("shared")` in **any** package.
- Mongo: each package has its own `src/connections/mongo.js`, both connecting to the same `MONGO_DB`. Models are `shared/models`.

### Deployment

`ecosystem.config.js` — every app is `exec_mode: 'cluster'` with `instances: '1'`. **One process per service today**, so `express-rate-limit`'s default in-process MemoryStore is not multiplied. (If `instances` is ever raised to `max`, every per-route limiter cap in this repo silently multiplies by the instance count — worth a note, not a blocker.)

---

## 3. Design decision 1 — Copy-and-adapt, NOT a shared-lib extraction

**Recommendation: duplicate the handlers into `packages/user`. Do not extract a shared auth-flow library.**

### Reasoning

1. **There is barely anything to share.** The three controllers total ~314 lines and are *glue*: parse body → call `shared.repos.UserRepository` → call `shared.utils.jwtUtils` → shape a JSON response. Every piece of durable logic (user lookup, token minting, OTP cache, SMS send, referral resolution, soft-delete window) **is already in `shared`** and is already shared by both services. The "duplication" is 5 route handlers of orchestration, not business logic.
2. **A shared lib would create an invisible deploy coupling on a service we promised not to touch.** If both services `require("shared/auth-flows")`, then any bugfix made for new clients *silently changes the behaviour of `packages/auth`* the moment it redeploys — for old app builds we cannot re-test and cannot roll forward. The whole value of the migration window is that the old surface is **frozen and provably unchanged**. Duplication is what makes "zero files touched under `packages/auth`" a *real* guarantee rather than a cosmetic one.
3. **Phase B cleanup is strictly cheaper with duplication.** With a copy, Phase B is: delete `packages/auth/`, delete its `ecosystem.config.js` entry, delete its nginx/ALB rule, delete the `test:auth` script. With a shared lib, Phase B additionally requires un-sharing the module (moving it back into `packages/user`) or leaving a permanently misnamed single-consumer "shared" module in `packages/shared` — the exact kind of leave-behind that rots.
4. **`shared` already IS the shared lib.** Adding a second sharing layer on top of it is redundant architecture.

### Cost, and how we mitigate it

The cost is real: **for the migration window, an auth bugfix must be applied in two places** (or deliberately applied only to the new one). Mitigation:

- Each new file carries a short header comment: `// Copied from packages/auth/src/routes/<x>/<y>.js during the auth-ownership migration. If you fix a bug here, decide explicitly whether packages/auth needs the same fix for old app builds (it usually does NOT — that surface is intentionally frozen).` *(One comment block per file, no essays — consistent with the repo's comment rules.)*
- `haper-misc/test-user-auth.md` carries a "twin files" table so the pairing is discoverable outside the code.

### Structure decision (deliberate deviation from the sibling convention)

Sibling services use a **flat** `src/routes/auth/{router,controller,validator}.js` (admin, delivery, picking). Those each expose 1-2 endpoints. We have **five endpoints across three genuinely distinct flows** (phone OTP, Google Sign-In, refresh). I recommend **mirroring the source layout** so the copy can be verified with a literal `diff` — the primary safety property here is "prove nothing changed", and a flat merge into one 330-line controller destroys that proof.

```
packages/user/src/routes/auth/
  router.js            <- new: mounts the three sub-routers + attaches limiters
  otp/{router,controller,validator}.js
  google/{router,controller,validator}.js     <- folder renamed google-auth -> google
  refresh/{router,controller,validator}.js
```

Folder rename `google-auth` → `google` only: it matches the URL segment (`/user/auth/google/...`) and matches how it's mounted. **No public path changes as a result.**

---

## 4. Design decision 2 — Mount point, and the geo-middleware trap

### The trap

`packages/user/index.js:64` is:

```js
app.use("/user", apiLimiter, getGeoAndStore, routes);
```

`getGeoAndStore` (`packages/user/src/middleware/geo.js`) ends with:

```js
if (storeId) { req.storeId = storeId; }
else { return next(new errorUtils("Could not find a store for you. Please choose different nearby store.", 400)); }
```

…unless the path matched one of its account-level allowlist branches (`/config`, `/address`, `/profile`, `/wallet`, `/razorpay/webhook`, non-place `/order`, `/store/nearest`, `/health`).

**A user who is logging in has not picked a store yet and will not send `x-store-id`.** If we simply wire `router.use("/auth", authRoutes)` into the aggregator with no other change, **every single new auth endpoint returns HTTP 400 "Could not find a store for you"** and the migration silently fails end-to-end on day one. This is the #1 thing to get right.

### Recommended fix — Option B: one-line addition to the geo allowlist

Add `/auth` to the existing account-level early-return in `geo.js`:

```js
if (
    req.baseUrl === "/user" &&
    (req.path.startsWith("/auth") ||          // <- the only new line
     req.path.startsWith("/config") ||
     req.path.startsWith("/address") ||
     ...
```

**Why this is provably safe:** it is one extra clause inside an existing OR-chain that already short-circuits to `next()`. It can only change behaviour for request paths beginning `/auth` — and `/user/auth/*` currently 404s (no `auth` mount exists in the aggregator). It cannot affect any existing route. It also keeps the codebase's convention (each service's aggregator mounts its own `/auth`), matching admin/delivery/picking.

Note `req.baseUrl` is `"/user"` and `req.path` is `"/auth/otp/get-otp"` for these requests, because the mount is `app.use("/user", ...)` — so `startsWith("/auth")` is the correct predicate.

### Alternative — Option A: separate mount ahead of geo

```js
app.use("/user/auth", apiLimiter, authRoutes);   // placed BEFORE the /user mount
app.use("/user", apiLimiter, getGeoAndStore, routes);
```

Zero changes to `geo.js`, and geo can never run for auth. Slightly stronger isolation, but breaks the "aggregator owns the route table" convention and splits the route list across two files. **I recommend Option B**; Option A is the fallback if a reviewer objects to touching `geo.js` at all.

### Exact new endpoint table

| Old (stays live, untouched) | New | Method | Auth | Request | Response (unchanged) |
|---|---|---|---|---|---|
| `GET /auth/otp/get-otp` | `GET /user/auth/otp/get-otp` | GET | public | query `countryCode` (1-3 digits), `phoneNumber` (`^[6-9]\d{9}$`) | `{ msg, data: { message, new } }` · 429 on throttle |
| `POST /auth/otp/login` | `POST /user/auth/otp/login` | POST | public | `{ phoneNumber, otp, name, referrerCode? }` | `{ msg: "User LoggedIn", data: { user, accessToken, refreshToken } }` · 400 bad OTP · 404 bad referral · 410 unrecoverable · soft-delete branch returns `{ deletedSoftly, deletedAt, daysUntilPermanent, restoreToken }` |
| `POST /auth/google/register` | `POST /user/auth/google/register` | POST | public | `{ idToken, referrerCode? }` | logged-in payload **or** `{ requiresPhoneVerification: true, idToken }` · 403 unverified email · 401 verification failure |
| `POST /auth/google/verify-phone` | `POST /user/auth/google/verify-phone` | POST | public | `{ idToken, phoneNumber, otp, referrerCode? }` | `{ msg: "User Registered and LoggedIn", data: { user, accessToken, refreshToken } }` · 400 phone linked elsewhere |
| `POST /auth/refresh` | `POST /user/auth/refresh` | POST | public (refresh token in body) | `{ refreshToken }` | `{ msg, data: { accessToken } }` · 401 invalid/expired/compromised |
| `GET /auth/health` | — **not ported** | — | — | — | `GET /user/health` already exists and serves this purpose |

**Naming: keep byte-identical below the prefix.** The only change a client makes is the base URL + the `/user/auth` prefix. Do **not** rename `get-otp` → `request-otp`, `login` → `verify`, or flatten `/otp/login` → `/login` in this delivery, even though some of those names are nicer. Every rename adds a place where a client and server can disagree during a multi-month dual-run, for zero functional gain. Note them as optional Phase-B-era cleanups if the team wants them.

**Infra:** `/user/*` is already publicly routed to the user service (it is how the whole customer app works today). Adding sub-routes under it needs **zero nginx/ALB/DNS change**. No devops dependency on the critical path. `/auth/*` routing stays exactly as-is.

---

## 5. JWT / secret compatibility — CONFIRMED

**Answer to the architecture question: yes, `packages/user` must and will issue tokens with the identical secret and claim shape, and it gets this for free with no code decision required.**

Evidence:

- Both packages call the same function objects: `require("shared").utils.jwtUtils.sign(payload, req)` / `.signRefresh(payload, req)`.
- `jwt.utils.js` reads `jwtSecret` / `jwtSecretRefresh` from `packages/shared/config/index.js`, which reads `process.env.JWT_SECRET` (single env var; `jwtSecretRefresh` is derived as `JWT_SECRET + "_ReFrEsH_9999_"`). Both services load the **same `.env`** at the repo root via `require("dotenv").config()`.
- Claim shape is fixed inside `jwtUtils.sign`: `{ v: 1, fsh, _id, avatar, name }` with `expiresIn: "15m"`. Both auth controllers build the identical `userPayload = { _id, avatar, name }`. Copying the controllers verbatim preserves this exactly.
- `jwtUtils.authenticate` (used by `/user/profile`, `/user/cart`, `/user/order`, …) verifies against the same `jwtSecret` and enforces the `fsh` device fingerprint + a 60s-cached user-status check. **Nothing is service-aware.** There is no issuer/audience claim, no `kid`, no per-service key.

**Consequences to state plainly:**

- A token minted at `/user/auth/otp/login` is accepted by `/auth/refresh` and by every `/user/*` route, and a token minted at `/auth/otp/login` is accepted at `/user/auth/refresh`. A client that upgrades mid-session does not need to re-login.
- **Do NOT introduce a distinguishing claim** (e.g. `iss: "user-service"`) in Phase A. It buys nothing and breaks cross-service verification, which is the property that makes the migration seamless.
- The fingerprint (`fsh = sha256(user-agent | x-device-id)`) is computed from request headers. If the new client build changes its `User-Agent` **at the same time** as it changes base URL, existing refresh tokens will 401 with "Refresh token compromised" and users get logged out once. Flag for the client teams; it is a client-side consideration, not a backend one, and it exists today for any UA change.

**Prerequisite to verify before deploy:** `JWT_SECRET` is a single root `.env` consumed by all processes on the same box (pm2 `ecosystem.config.js` runs all six apps from the repo root). Someone with `.env` access should confirm there is not a per-service override. *(I did not and will not read `.env` — project rule.)* If dev and prod ever split secrets per service, this whole plan needs revisiting.

---

## 6. Rate limiter design

### Current state and why it needs fixing now

- `packages/auth` has **no per-route limiter at all** — only the app-level 100/15min per IP. This is a pre-existing gap.
- `packages/user`'s app-level limiter is **1000/5min per IP** — roughly 30x looser.
- Therefore: **moving these routes under `/user` without dedicated limiters would materially weaken brute-force protection**, from ~100/15min to ~1000/5min per IP. That alone makes "add the limiters now" not optional.
- The only throttle that exists today for OTP is inside `getOTP` itself: a Redis counter keyed on the raw phone number (max 2 per `SMS_USER_REQ_EXPIRY` minutes, plus a 2-minute cooldown). That is **per-phone only, with no IP dimension** — an attacker can rotate phone numbers freely and burn SMS credits up to the app-level cap.

**Recommendation: yes, add dedicated limiters, mirroring the admin/delivery/picking pattern.** This is the one behaviour delta I am recommending alongside the move — it is additive-only (it can only produce 429s on the *new* paths, which have no existing clients), it does not touch `packages/auth`, and it does not change any success-path response shape.

### Proposed limiters (all in `packages/user/src/routes/auth/router.js`)

```
otpIpLimiter        IP-only,       20 / 15 min   — caps SMS-credit burn from one source regardless of phone
otpPhoneLimiter     `otp:<phone>|<ip>`, 3 / 15 min — per (phone, IP); complements the existing Redis per-phone throttle
loginPhoneLimiter   `login:<phone>|<ip>`, 10 / 15 min, skipSuccessfulRequests — OTP guessing on one account from one IP
loginIpLimiter      IP-only,       30 / 15 min, skipSuccessfulRequests — OTP spraying across many phones from one IP
googleIpLimiter     IP-only,       30 / 15 min   — no stable body identifier; do NOT key on idToken
refreshLimiter      IP-only,       30 /  5 min   — copied verbatim from delivery/picking
```

Wiring, with **composite-key limiter FIRST, IP-only limiter SECOND** — this ordering is deliberate and is documented at length in `packages/admin/src/routes/auth/router.js`; the new file should reference that comment rather than re-explain it:

```
GET  /otp/get-otp        otpPhoneLimiter  -> otpIpLimiter    -> validator.requestOTP -> controller.getOTP
POST /otp/login          loginPhoneLimiter-> loginIpLimiter  -> validator.verifyOTP  -> controller.verifyOtpAndRegister
POST /google/register    googleIpLimiter                     -> validator.registerUser -> controller.register
POST /google/verify-phone googleIpLimiter                    -> validator.verifyPhone -> controller.verifyPhone
POST /refresh            refreshLimiter                      -> validator.refreshToken -> controller.refreshToken
```

Notes / traps:

- `get-otp` takes its phone from **`req.query`**, not `req.body` — the keyGenerator must read `req.query.phoneNumber`. Copying delivery's `req.body.email` keyGenerator blindly would degrade it to IP-only and nobody would notice.
- `skipSuccessfulRequests` is **not** used on the `get-otp` limiters: a successful OTP send is exactly the thing costing money, so it must count.
- Never put a raw phone number in a limiter key without the IP component — email-only keying was a documented targeted-lockout vector in the 2026-08-16 admin security review (finding M2). Same reasoning applies to phone numbers: an attacker who knows a victim's number could otherwise lock them out of login globally.
- Default `MemoryStore` is per-process. `ecosystem.config.js` sets `instances: '1'` today so caps are exact; if instances ever go to `max`, every cap here multiplies. Documented, not solved in Phase A.
- The OTP Redis cache keys (`<phone>`, `<phone>_LAST_SENT`, `<phone>_OTP`) are **plain phone numbers with no service prefix**, so both services share one budget and one OTP. That is desirable (cross-service OTP redemption works, throttle budgets are not doubled) — but it also means the new limiters are the *only* new defence; the Redis throttle is shared, not duplicated.

---

## 7. File-by-file change list

### New files — `packages/user` (13)

| # | File | Content |
|---|---|---|
| 1 | `packages/user/src/routes/auth/router.js` | **New logic.** Defines the six limiters; `router.use("/otp", otpRoutes)`, `router.use("/google", googleRoutes)`, `router.use("/refresh", refreshRoutes)`. |
| 2 | `packages/user/src/routes/auth/otp/controller.js` | Verbatim copy of `packages/auth/src/routes/otp/controller.js` + twin-file header comment. |
| 3 | `packages/user/src/routes/auth/otp/validator.js` | Verbatim copy. |
| 4 | `packages/user/src/routes/auth/otp/router.js` | Copy; limiters attached in (1) or here — pick one place and keep it consistent. |
| 5 | `packages/user/src/routes/auth/google/controller.js` | Verbatim copy of `google-auth/controller.js`. |
| 6 | `packages/user/src/routes/auth/google/validator.js` | Verbatim copy. |
| 7 | `packages/user/src/routes/auth/google/router.js` | Copy. |
| 8 | `packages/user/src/routes/auth/refresh/controller.js` | Verbatim copy. |
| 9 | `packages/user/src/routes/auth/refresh/validator.js` | Verbatim copy. |
| 10 | `packages/user/src/routes/auth/refresh/router.js` | Copy. |
| 11 | `packages/user/__tests__/auth-otp.test.js` | Port of `packages/auth/__tests__/otp.test.js` (19 cases) to the `/user/auth/...` prefix. |
| 12 | `packages/user/__tests__/auth-google.test.js` | Port of `google-auth.test.js` (5 cases). |
| 13 | `packages/user/__tests__/auth-refresh.test.js` | Port of `refresh.test.js` (5 cases) + cross-service token parity cases. |

### Modified files — `packages/user` (3)

| # | File | Change |
|---|---|---|
| 14 | `packages/user/src/routes/index.js` | `const authRoutes = require("./auth/router");` + `router.use("/auth", authRoutes);` placed **above** the other mounts. |
| 15 | `packages/user/src/middleware/geo.js` | Add `req.path.startsWith("/auth") \|\|` to the existing account-level allowlist (§4). |
| 16 | `packages/user/__tests__/setup.js` | Add the four harness gaps in §8. **This file is loaded by all 50 existing user test suites — the riskiest edit in the plan.** |

### Modified files — other repos

| # | File | Change |
|---|---|---|
| 17 | `haper-misc/test-user-auth.md` | New walkthrough guide (project rule). Includes the twin-file table and the Phase-B note. |

### Files touched under `packages/auth`

**Zero.** This is an acceptance criterion, verified with `git diff --name-only dev -- packages/auth` returning empty before commit.

---

## 8. Data model / DB reuse — CONFIRMED, no changes needed

- **No new collections, no new fields, no indexes, no migration.** All five handlers read and write the existing `User` collection via `shared.repos.UserRepository` and `shared.model.UserModel`.
- `packages/user/src/connections/mongo.js` connects to the same `config.mongoDbUri` (`MONGO_DB`) as `packages/auth/src/connections/mongo.js`. Same cluster, same database, same models. `packages/user` **already** reads and writes `User` today (`/user/profile`, `/user/address`, delete-account).
- OTP state is **not** in Mongo — it lives in `distributedCacheUtils` (Redis, with a local NodeCache fallback when `REDIS_URL` is empty). `packages/user/index.js:79` already calls `distributedCacheUtils.init()`. **Prerequisite: both services must point at the SAME Redis**, otherwise an OTP requested on one service cannot be redeemed on the other. Verify from `.env` config (single root `.env` today → almost certainly fine, but confirm before deploy). This is listed as Open Question Q2.
- `shared.emitters.emit("logged-in", ...)` — `packages/shared/events/emitter.js` registers the handler on `require("shared")`, which `packages/user` already does. No wiring needed.
- `google-auth-library@^9.15.1` is a **root** dependency, hoisted; `packages/user` will resolve it without a `package.json` change. **Recommendation anyway: add `"google-auth-library": "^9.15.1"` to `packages/user/package.json` dependencies** — relying on hoisting is how a future `npm install` in one workspace breaks a service at runtime. (Note `packages/auth` does not declare it either; leave that alone.)

---

## 9. Step-by-step build order

Each step is one reviewable change. Steps 1-3 are inert (nothing routed yet).

1. **Harness first.** Modify `packages/user/__tests__/setup.js` only, then run the **full existing** user suite and confirm zero new failures. The four gaps to close:
   - **`jest.mock("google-auth-library", ...)`** — packages/user's setup does not mock it at all. Copy the mock block from `packages/auth/__tests__/setup.js:~75`.
   - **`shared.utils.smsUtil` (SINGULAR) is not mocked.** `packages/user/__tests__/setup.js` spies on `shared.utils.smsUtils` — **plural, which does not exist** in `packages/shared/utils/index.js` (the real export is `smsUtil`). The existing guard is `if (shared.utils.smsUtils)`, so it silently no-ops. Since no current user test calls `sendSMS`, this has been harmless — but `getOTP` calls `smsUtil.sendSMS`, which does a **real `axios.get` to the live SMS gateway**. Without this fix the new `get-otp` test sends real SMS. Add the `smsUtil` spy; leave the dead `smsUtils` block alone or remove it in the same commit (harmless either way — call it out in review).
   - `process.env.OTP_FOR_USER_REGISTRATION = "898444"` — auth's setup sets it; user's does not, so tests would fall back to the `.env.example` default `"995518"`.
   - `process.env.JWT_REFRESH_SECRET` / `JWT_REFRESH_EXPIRY` — auth's setup sets them; harmless to add for parity (note: `jwtSecretRefresh` is actually derived from `JWT_SECRET`, so these are cosmetic — do not let them create a false sense of coverage).
2. **Copy the nine route files** into `packages/user/src/routes/auth/{otp,google,refresh}/` with only the twin-file header comment added. Verify with `diff` against the originals that nothing else changed. Not yet mounted — no behaviour change.
3. **Add `packages/user/src/routes/auth/router.js`** with the six limiters and the three sub-mounts. Still not wired into the aggregator.
4. **Wire it up:** one-line mount in `packages/user/src/routes/index.js` + the one-line `/auth` allowlist clause in `geo.js`. This is the step that makes the endpoints live — keep it small and isolated so it is trivially revertable.
5. **Add `google-auth-library` to `packages/user/package.json`** dependencies.
6. **Port `auth-refresh.test.js`** (smallest, 5 cases) + add the two cross-service token-parity tests. Fastest signal that secrets and claims line up.
7. **Port `auth-otp.test.js`** (19 cases) + add the geo-bypass test (no `x-store-id` → not 400) + the limiter tests.
8. **Port `auth-google.test.js`** (5 cases).
9. **Run both suites**: `cd packages/user && NODE_ENV=test npx jest` and `cd packages/auth && NODE_ENV=test npx jest`. Confirm `git diff --name-only -- packages/auth` is empty.
10. **Write `haper-misc/test-user-auth.md`** (project rule) with the manual dev walkthrough, the twin-file table, and the Phase-B note.
11. **Present for approval. Do not commit or push until the user says so** (global rule).

---

## 10. Edge cases, risks, and backward compatibility

### Backward compatibility — what exists today and how each piece keeps working

| Existing functionality | How it keeps working unchanged |
|---|---|
| Old app builds calling `/auth/*` | `packages/auth` is not modified, not restarted differently, not re-routed. Zero files touched. |
| Tokens issued by `packages/auth` | Same `JWT_SECRET`, same claims, verified by the same `shared` code. Nothing service-aware exists. |
| All existing `/user/*` routes | Only two `packages/user` source files change: an additive mount in the aggregator and an additive allowlist clause in `geo.js` that can only match paths starting `/auth` (which currently 404). |
| `getGeoAndStore` behaviour for every non-auth path | Unchanged — the new clause is an added OR term in a chain that already returns `next()`. |
| The 50 existing `packages/user` test suites | Only `setup.js` changes. Step 1 gates on running them all first. The `smsUtil` spy addition is the one to watch: if any existing test *depended* on `sendSMS` being unmocked (none should — none call it), it would surface here. |
| `packages/auth`'s own test suite | Untouched, must stay green. |
| Shared Redis OTP budget | Deliberately shared; a user cannot get a double OTP allowance by hitting both services, and an OTP from one works on the other. |

### Risks and edge cases

1. **Geo gate (highest risk).** Covered in §4. Mitigation: an explicit test that hits every new endpoint with **no** `x-store-id`, `x-user-latitude`, `x-user-longitude` headers and asserts the response is not 400 "Could not find a store for you".
2. **Real SMS sent from a test run.** Covered in step 1. Until the `smsUtil` spy lands, do not write any test that calls `get-otp`. This one costs real money and real user confusion, so it is step 1, not step 7.
3. **CORS divergence for the web client.** `packages/auth` accepts any `*.haper.in` origin via a custom function; `packages/user` uses the plain `config.corsOrigin` list. If haper-web is served from a subdomain not literally listed in `CORS_ORIGIN`, browser login works today at `/auth/*` and would **break** at `/user/auth/*`. Backend-only fix is a `CORS_ORIGIN` env addition — no code change. Must be checked before the web client flips. **Open Question Q3.**
4. **Race: two clients, one phone, near-simultaneous `otp/login`.** Pre-existing. `verifyOtpAndRegister` does a `getOne` then `create`, so two concurrent first-time logins can both miss and both attempt `create`; the phone unique partial index makes the loser throw E11000 → 500. This exists today at `/auth/otp/login` unchanged; **do not fix it in this delivery** (it would be a behaviour change on a pure relocation, and the fix belongs in `shared`/`UserRepository` where both services would get it). Log it as a follow-up.
5. **OTP replay.** `verifyOtpAndRegister` does **not** delete the cached OTP after use — a valid OTP can be replayed until its TTL expires (`SMS_OTP_EXPIRY`, default 2-3 min). Pre-existing on both services. Same reasoning: **do not fix during the move.** Follow-up.
6. **Master OTP bypass.** `otp !== otpEnv.userRegistration` lets a hardcoded env OTP log in as *any* phone number, on both services. Pre-existing, presumably intentional for testing/app-store review. Copying it forward preserves current behaviour; **flag it to the user** — it is a standing production risk that now exists on two hosts instead of one. **Open Question Q4.**
7. **Limiter false positives on shared NAT.** New 429s are possible where none existed. Caps chosen loose enough for a household/office; the composite-key-first ordering (per the admin file's documented rationale) prevents one user's retries from burning the shared IP budget.
8. **Rollback strategy.** Revert step 4 (two lines) → the new endpoints return 404 and every existing route is byte-identical to today. Old clients are unaffected throughout because they never touched `packages/user` for auth. This is a fully reversible delivery; nothing is hard to undo, and no data is written that would not have been written anyway.
9. **Nothing here touches money.** No payment, order, wallet, or coupon path is in scope.

---

## 11. Test strategy

**Owner: santosh-tester.** Run from the package dir per project rules: `cd packages/user && NODE_ENV=test npx jest` (in-memory Mongo only, never the real DB).

### Unit / integration (supertest against the in-memory app) — parity with `packages/auth/__tests__` (29 cases)

- **`auth-otp.test.js`** — port all 19 cases from `packages/auth/__tests__/otp.test.js`: validator rejections (bad country code, non-Indian phone, missing name, 6-digit OTP regex, `strict(true)` unknown-key rejection), 2-minute cooldown 429, 2-per-window 429, `new: true/false` for unknown/known phone, invalid OTP 400, master-OTP acceptance, referral code resolution + 404 on bad code, new-user creation, existing-user name update (and the "Guest Name" skip), the `DELETED_SOFT` restore-token branch, the 410 expired-window branch.
- **`auth-google.test.js`** — port all 5: unverified email 403, existing-linked-user login, `requiresPhoneVerification` response, phone-already-linked-to-another-Google 400, new user creation with `sType = GOOGLE`.
- **`auth-refresh.test.js`** — port all 5: missing token 401, malformed token 401, fingerprint-mismatch 401, happy path returns a fresh access token, validator strictness.

### New tests that do not exist in `packages/auth` (the ones that catch *this* migration's bugs)

- **Geo bypass** — every new endpoint with zero geo headers returns its normal status, never 400 "Could not find a store for you". Plus a negative control: an existing store-scoped route (e.g. `/user/item/...`) **still** returns 400 without `x-store-id`, proving the allowlist edit did not widen.
- **Cross-service token parity** — mint an access token via `POST /user/auth/otp/login`, then call an authenticated existing route (`GET /user/profile`) with it and assert 200. And: mint a refresh token via `jwtUtils.signRefresh` the way `packages/auth` does, POST it to `/user/auth/refresh`, assert 200. This is the acceptance criterion that says "either service's token works everywhere".
- **Response-shape snapshot** — assert the exact top-level key set of each success response (`msg`, `data`, and `data`'s keys) so an accidental reshape during the copy is caught mechanically.
- **Rate limiters** — for each of the five routes, drive it past its cap and assert 429 plus the expected message shape; assert that a *different* phone from the same IP still gets through the composite limiter but eventually trips the IP limiter; assert `skipSuccessfulRequests` means successful logins do not consume the login budget. (Limiters are in-process memory — remember `maxWorkers: 1` and that state persists across tests in a file; use distinct IPs/phones per case.)
- **No-real-network assertion** — assert `smsUtil.sendSMS` was called with the mocked spy (never the real axios path) and that `OAuth2Client` is the mock.

### Regression sweep (must run, must be green)

- Full `packages/user` suite (50 files) — the `setup.js` edit is the blast radius.
- Full `packages/auth` suite — must be untouched and green.
- `git diff --name-only -- packages/auth` must print nothing.

### Manual dev walkthrough (goes in `haper-misc/test-user-auth.md`)

Against `dapi.haper.in`: request an OTP on `/user/auth/otp/get-otp`, redeem it on the **old** `/auth/otp/login` (proves the shared OTP cache), then repeat crossed the other way; log in on the new path and call `/user/profile` with the token; confirm old app builds on `/auth/*` still work.

---

## 12. Phase B — decommission `packages/auth` (FUTURE, NOT part of this delivery)

**Do not build any of this now.** Recorded here so it is not lost.

Trigger: telemetry shows effectively zero traffic on `/auth/*` — the user model already stores `lastAppVersion` / `lastPlatform` (`jwtUtils.recordUserClient`), which combined with access logs on the auth host gives a defensible "everyone has migrated" signal. Suggested gate: 30 consecutive days below a small absolute request count, plus a forced-upgrade floor in the app.

When triggered:
1. Delete `packages/auth/` entirely (source + `__tests__`).
2. Remove the `Haper_Prod_Auth` entry from `ecosystem.config.js`.
3. Remove the auth entries from root `package.json` (`start:all`, `dev:all`, `test:all`, `test:auth`).
4. Remove the nginx/ALB rule and DNS record for the auth host; remove `AUTH_PORT` from `.env` / `.env.example`.
5. Grep every client repo (haper-android, haper-ios, haper-web) for the literal string `"/auth/"` and for the auth base-URL env var — including comments and `.env.example` values — and remove dead config rather than leaving it.
6. Remove the twin-file header comments from `packages/user/src/routes/auth/**` (they become lies).
7. Delete the stale cross-service comment in `packages/auth/src/routes/index.js`'s successor, if any, and update `haper-misc/test-user-auth.md`.
8. Optionally *then* do the deferred cleanups: URL renames, the OTP-replay fix, the create-race fix, and a decision on the master OTP.

Rollback for Phase B: it is a delete, so the rollback is a git revert plus a pm2 start — but only until the DNS/ALB rule is removed. **Remove the routing rule last, and treat it as the point of no return.**

---

## 13. Open questions (need answers before build starts)

1. **Is `JWT_SECRET` truly a single value shared by all six pm2 apps in dev and prod?** I cannot read `.env`. If any service has an overridden secret, cross-service token compatibility — the core promise of this plan — does not hold. Please confirm.
2. **Do `packages/auth` and `packages/user` point at the same Redis (`REDIS_URL`)?** If not, an OTP requested on one host cannot be redeemed on the other, and the migration-window UX breaks for any client that mixes hosts.
3. **What exact origins does the web client use?** `packages/user` uses the plain `CORS_ORIGIN` list while `packages/auth` accepts any `*.haper.in` subdomain. If haper-web runs on an origin not literally in `CORS_ORIGIN`, browser login will fail on the new path. Env-only fix, but it must happen before the web flip.
4. **The master OTP (`OTP_FOR_USER_REGISTRATION`) lets anyone log in as any phone number.** Copying it forward is the correct "pure relocation" choice, but it will then exist on two public hosts. Keep as-is, or should I plan a follow-up to gate it (non-production only / allowlisted numbers)?
5. **Confirm the limiter caps** in §6 (20/15min get-otp per IP, 3/15min per phone|IP, 10/15min login, 30/15min IP, 30/5min refresh). These are my proposal based on the sibling services; if you have real traffic numbers for `/auth/otp/get-otp`, I would rather size them from data.
6. **Option B (one line in `geo.js`) vs Option A (separate `/user/auth` mount ahead of geo)** — I recommend B for convention + provable narrowness. Confirm you are comfortable with a change to `geo.js`, which is on every `/user` request path.
7. **Nested vs flat route layout** (§3) — I am deliberately deviating from the flat sibling convention to keep the copy `diff`-verifiable. Confirm, or say the word and I will replan as a flat `routes/auth/{router,controller,validator}.js`.
8. **Should the pre-existing OTP-replay and create-race issues be fixed now or deferred?** My recommendation is defer (both are in `shared`-adjacent code and fixing them mixes a behaviour change into a relocation), but they are genuine defects and you may want them prioritised separately.

---

## 14. Fleet routing — who builds what

| Part | Specialist |
|---|---|
| Steps 2-5 (route copy, limiter router, aggregator + geo wiring, package.json) | **platform/backend engineer** (Node/Express) |
| Step 1 + steps 6-9 (test harness fix, ported suites, new geo/parity/limiter tests, regression sweep) | **santosh-tester** |
| Step 10 (`haper-misc/test-user-auth.md`) | **santosh-tester** (or whoever lands step 9) |
| Client base-URL flip (Android / iOS / web) | **NOT this delivery** — separate briefs; track in `haper-misc/client-followups.md` |
| Data model / DBA review | **not needed** — zero schema, index, or migration changes (§8) |
| Payments / realtime / AI / data | **not involved** — no money, socket, model, or pipeline surface is touched |
| Design | **not involved** — backend only, no UI |
| Architecture sign-off on §5 (single-secret, no issuer claim) | **rajit-backend-arch** — see note below |

> **Note on the rajit-backend-arch consult:** the briefing asked me to consult rajit-backend-arch on the token-secret and layout questions. I have no agent-dispatch tool available in this run, so I answered both from direct code evidence instead: §5 (single `JWT_SECRET` in `shared/config`, identical `jwtUtils.sign` call, no service-aware claim anywhere) and §3/§4 (layout + mount, benchmarked against the admin/delivery/picking precedent). Both conclusions are stated with the evidence that produced them so rajit can confirm or overrule quickly rather than re-derive.
