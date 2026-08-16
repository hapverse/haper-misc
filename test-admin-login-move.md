# Test: Admin login moved from `packages/auth` to `packages/admin`

**Area:** Admin panel login screen (all roles)
**Backend:** `POST /admin/auth/login` (`packages/admin/src/routes/auth/{router,controller,validator}.js`)
**Old path removed:** `/auth/ad/login` (the old auth-service admin login) no longer exists — it now
404s. There is **no back-compat shim / redirect**.
**Tests (green):** `packages/admin/__tests__/admin-auth.test.js` (22 tests — run
`cd packages/admin && NODE_ENV=test npx jest __tests__/admin-auth.test.js`).
**Deploy needed:** backend **and** admin frontend **must deploy together**. There is no shim
bridging the old and new endpoints, so an old frontend talking to the new backend (or vice versa)
will fail login outright — see "Deploy / verification note" at the bottom.

---

## What this is (real example)

Admin login used to live in the shared `packages/auth` service alongside customer/delivery/picker
login. It has been moved into `packages/admin` itself as `POST /admin/auth/login`, so the admin
app's auth is now self-contained (own router, controller, validator, rate limiter) instead of
depending on a separate service. Two real bugs were fixed in the move:

- **O1 — case-insensitive email.** Before, logging in as `Manager@Store.com` when the account was
  stored as `manager@store.com` could fail to match. Now email lookup is case-insensitive.
- **O2 — deactivated admins rejected at login.** A deactivated (`status: 0`) admin used to still be
  able to obtain a token at login (even if later blocked elsewhere). Now login itself rejects a
  deactivated admin, with the **same generic message** as a wrong password — no "this account is
  deactivated" leak that would let an attacker enumerate valid-but-disabled emails.

**Follow-up hardening (2026-08-16 security review — same endpoint, see section 4):** three more
issues found by review and fixed in a second pass, all in the throttling/enumeration area:

- **H1 — spraying bypassed the throttle.** The login limiter was keyed by email only, so 30 attempts
  across 30 *different* emails tripped nothing. A second, per-IP volume limiter now caps total
  login attempts per network (30 / 15 min) regardless of email.
- **H2 — the app-wide limiter was bypassable.** It read the `_id` out of the `Authorization` JWT
  **without verifying the signature**, so a forged token handed the caller a fresh 1000-request
  bucket on *every* request. It now verifies the token and falls back to the IP bucket otherwise.
- **M2 — targeted lockout.** Because the key was email-only, anyone who guessed an admin's email
  could lock that person out from any network. The key is now `email|ip`.
- **M1/M3 — timing oracle.** An unknown email returned in ~3 ms vs ~73 ms for a real one (no bcrypt
  call), so attackers could enumerate valid admin emails by the clock despite the identical
  response body. Both branches now pay the same bcrypt cost.

---

## Walkthrough

### 1. Happy path — all 6 roles can log in, `stores` shaped per role
- ✅ **super_admin** logs in → response includes **every store** under `data.stores`.
- ✅ **store_admin** logs in → `data.stores` has exactly **one** entry: their assigned store.
- ✅ **manager** logs in → `data.stores` has exactly **one** entry: their assigned store.
- ✅ **support** logs in → `data.stores` has exactly **one** entry: their assigned store.
- ✅ **warehouse_manager** logs in → `data.stores` is **omitted entirely** (no store scope) — do
  NOT expect `stores: []`, the key itself is absent.
- ✅ **warehouse_staff** logs in → same as warehouse_manager, `data.stores` key absent.
- ✅ Every successful login also returns `data.admin` (no `password` field ever present) and a
  `data.accessToken` string.

### 2. Case-insensitive email login (O1)
- ✅ Create/seed an admin with a mixed-case or lowercase email, e.g. `manager@store.com`.
- ✅ Log in using a **different casing**, e.g. `MANAGER@STORE.COM` (or any mixed case) + the
  correct password → **200**, logs in as the same account.
- ❌ A **whitespace-padded** email (e.g. `"  manager@store.com  "`) is still rejected at the
  **validator** (403) — trimming padding is not the same guarantee as case-folding; only casing is
  relaxed, not surrounding whitespace.

### 3. Deactivated admin — generic rejection, no leak (O2)
- ❌ Deactivate an existing admin (`status: 0`) and attempt login with their **correct** password →
  **400** with the exact same message as a wrong password: `"Invalid email or password"`.
- ❌ The response body must **never** contain `accessToken` for a deactivated account — confirm no
  token is issued even though the password was correct.
- This is intentionally indistinguishable from "wrong password" or "unknown email" — an attacker
  probing emails cannot tell active-wrong-password apart from deactivated-correct-password.

### 4. Rate limiters — TWO of them on the login route (both must be checked)

Login is guarded by two limiters. Both are needed; each alone is bypassable
(2026-08-16 security review, findings H1/H2/M2).

**Mount order is deliberate: the per-account limiter (4a) runs FIRST, the per-IP one (4b) second.**
That way an admin who keeps retrying a wrong password on their *own* account is stopped by their own
per-account bucket and never touches the shared per-network counter — so their fumbling can't use up
the office's budget and lock out a colleague. Don't "fix" it to IP-first.

**4a. Per-account limiter — 6th rapid failed attempt on the same email+IP gets 429**
- ❌ Send **5 consecutive failed logins** (wrong password, or a non-existent email) using the
  **same email** in rapid succession → each of the 5 returns **400** (`"Invalid email or password"`)
  and is **not** itself blocked.
- ❌ The **6th** attempt with that same email, within the 15-minute window → **429** with body
  `{ "error": "Too many login attempts. Please try again in 15 minutes." }`.
- The key is the **composite `<lowercased email>|<ip>`** (IP-only when the body has no email), and
  only **failed** attempts count (`skipSuccessfulRequests: true`) — a successful login does not
  consume the quota.
- ✅ **Not a lockout weapon:** blocking is scoped to that email **from that IP**. From a *different*
  IP (phone hotspot / another network), the same admin's email logs in fine while the attacker's IP
  is blocked. Verify this — it is the whole point of the composite key. (It used to be email-only,
  which let anyone lock a named admin out globally, from anywhere, forever.)

**4b. Per-IP volume limiter — 31st failed login from one IP gets 429, regardless of email**
- ❌ Send **30 failed logins from one machine using 30 DIFFERENT emails** (password spraying) →
  the first 30 return **400**, and the **31st** returns **429** with body
  `{ "error": "Too many login attempts from this network. Please try again in 15 minutes." }`.
  Note the **different message** — that is how you tell which limiter fired.
- ✅ Legitimate multi-admin offices are unaffected in normal use: successful logins don't count, so
  several admins signing in behind one office IP never approach 30.
- ⚠️ **Known, accepted tradeoff:** this budget IS shared by everyone on the same network. 30 *failed*
  logins from one office — even spread across several different admin accounts — will temporarily
  (15 min) rate-limit login for that whole office. A different *network* always gets its own budget.
  This is the price of having a spray defence at all; the 4a-before-4b mount order keeps the common
  case (one person retrying one wrong password) from being what burns it.
- A separate, much looser app-wide limiter (1000 requests / 5 min) also sits in front of all of
  `/admin/*`. It is keyed by **verified** admin identity, falling back to IP — a forged/unsigned
  `Bearer` token no longer earns its own bucket. It is a backstop, not the login defense.

- To test any of this by hand: fire the POSTs within a few seconds. Waiting past 15 minutes (or
  restarting the backend process in dev, which resets the in-memory store) clears the block.

### 4c. No timing oracle on unknown emails
- ❌ Time a login for a **known** admin email with a wrong password vs a **non-existent** email
  (e.g. `curl -o /dev/null -s -w "%{time_total}\n"`, 5 runs each, compare medians). The two must be
  **within roughly the same ballpark** (measured 72.8 ms vs 73.1 ms = 1.00x).
- A large gap (it was 25x — ~73 ms vs ~3 ms) means the unknown-email branch is returning early
  without paying the bcrypt cost, which lets an attacker enumerate which admin emails are real even
  though the response body is identical. Check `controller.js` still calls `bcrypt.compare` against
  `DUMMY_PASSWORD_HASH` in the `!admin` branch.

### 5. Old path is gone
- ❌ `POST /auth/ad/login` (the pre-move endpoint) → **404**. Confirm the response body does **not**
  contain `accessToken` — it should be a plain not-found, not a redirect or a silently-working
  fallback.
- ❌ `POST /admin/auth/register` also 404s — there never was a registration endpoint here; admin
  accounts are created via `scripts/create-super-admin.js` (super_admin, direct DB) or
  `POST /admin/store/admins` / `POST /admin/team` (store_admin-gated creation of store_admin /
  manager / support).

### 6. Pre-move sessions still work — no forced logout
- ✅ A token issued **before** this move (i.e. any existing, still-valid admin JWT sitting in a
  browser's localStorage from before the deploy) continues to authenticate against
  **`GET /admin/me`** without needing to log in again. The move only relocated the **login**
  endpoint; token issuance format, verification, and `/admin/me` are unchanged. Verify this by NOT
  clearing localStorage across a deploy and confirming the admin app stays logged in.
- ✅ (Regression check baked into the automated suite) A **freshly issued** token from the new
  `/admin/auth/login` is also accepted by `GET /admin/me` for both a store-scoped role and
  super_admin — confirms issuer/verifier agreement wasn't broken by the move.

---

## Deploy / manual-verification note

Backend and admin-frontend must ship **in the same deploy window** — there is no compatibility
shim between the old `/auth/ad/login` and the new `/admin/auth/login`:

- **Old frontend + new backend:** the old frontend calls `/auth/ad/login`, which now 404s. Admins
  cannot log in at all (existing sessions still work per section 6, but nobody can log in fresh).
- **New frontend + old backend:** the new frontend calls `/admin/auth/login`, which doesn't exist
  on the old backend. Same failure mode.

After deploying, **manually confirm** (dev only, `damin.haper.in`):
1. Log out and log back in as at least one of: super_admin, a store-scoped role (store_admin /
   manager / support), and a warehouse role — confirm the panel loads with the right store scope
   (or no store switcher for warehouse roles).
2. Confirm an admin who was already logged in **before** the deploy is still working (did not get
   silently logged out) — refresh the page without logging out first.
3. Confirm `/auth/ad/login` is unreachable (404) so no stale client build is quietly still hitting
   the old endpoint and half-working.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Login 404s in the browser | Frontend build is stale and still calling `/auth/ad/login`, or backend not deployed yet |
| Login works but panel shows no stores for a store_admin/manager/support | Check the admin's `storeId` is actually set — the endpoint only returns `stores` when the role has one |
| Deactivated admin can still log in | Backend not deployed / running an old build — O2 fix isn't live |
| Login fails for correct credentials with differing case | Backend not deployed — O1 fix isn't live |
| 429 never triggers even after 6+ failed attempts | Requests aren't using the exact same email **from the same IP** (key is `email\|ip`), or more than 15 minutes elapsed between attempts |
| 429 triggers too easily / blocks unrelated admins | A different **network** always gets its own budget. But the **same** network shares the per-IP cap (30 failed logins / 15 min), so many failed logins from one office — even against *different* admin accounts — can temporarily rate-limit that whole office. This is a known, accepted tradeoff (see 4b). Check the message to see which limiter fired: `"...from this network"` = the shared per-IP cap (expected); the plain `"Too many login attempts"` on a *first* attempt = a real bug, check `adminLoginLimiter.keyGenerator` hasn't regressed to email-only, and that `adminLoginLimiter` is still mounted **before** `loginIpLimiter` in `router.js` |
| Spraying many different emails is never blocked | `loginIpLimiter` is missing from the route chain in `router.js` — it must be mounted BEFORE `adminLoginLimiter` |
| One admin locked out of every device/network at once | The per-account key has regressed to email-only — re-add the `\|${req.ip}` half |
| Rate limits seem to never apply to some caller | `apiLimiter.keyGenerator` in `packages/admin/index.js` has regressed to decoding the JWT without `jwtUtils.verifyAdmin` — a forged token then mints a fresh bucket per request |
