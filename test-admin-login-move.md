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

## Session handling fixes (2026-08-16) — frontend only, `haper-admin`

Two bugs in how the admin panel ends a session. **No backend change, no deploy coupling** — this is
a `haper-admin` build only.

### S1 — logout on a shared browser didn't stick in other tabs (HIGH)

**Real example:** one shared laptop in the store. Tab A is logged in as the store admin. Someone
opens Tab B and logs in as the warehouse manager, does their work, and clicks Logout. Tab A was
never told — it still had the store admin's token in memory, and the next time Tab A did anything
(just navigating to another page re-runs `fetchMe()`) it wrote that token *back* into
localStorage. The store admin's session came back from the dead after an explicit logout, and
because admin tokens are plain 1-day JWTs with no server-side revocation, the resurrected token was
completely valid.

**Fix:** every tab now listens for the browser's `storage` event on the auth key
(`haper-admin-auth`) and converges on whatever the last tab wrote —
`src/utils/authSync.ts`, installed once from `src/App.tsx`.

| Step | ✅ Expected |
|---|---|
| Open the admin panel in two tabs, logged in as the same admin | Both work normally |
| In Tab B click **Logout** | Tab B goes to `/login`. **Tab A jumps to `/login` within a second** — without being touched |
| Go back to Tab A and try to navigate to `/orders` | Bounced to `/login`; the old session does **not** come back |
| Tab A: `localStorage.getItem('haper-admin-auth')` in the console after the above | `accessToken` is `null` (and stays null even after clicking around Tab A) |
| Tab B logs in as a **different** admin while Tab A is open | Tab A does **not** adopt admin Y's identity — it is logged out too, and jumps to `/login` (same outcome as Tab B logging out) |
| Two tabs, and one switches the active store | Nothing dramatic — same token, so no reload/redirect storm |

❌ **Fail signals:** Tab A keeps working after Tab B logged out; Tab A shows admin X's name but
admin Y's menu items; Tab A silently adopts admin Y's token/identity instead of being logged out;
tabs reload each other in a loop.

| Shared-terminal re-entrancy: admin A logs out, admin B logs in on the **same tab** while A's push-teardown call is still in flight (within ~4s), then B clicks Logout too | Both logouts complete cleanly — the session clears on B's logout instead of silently no-oping because A's teardown promise was still pending; B ends up on `/login` with no leftover token in memory |
| Wrong-password attempt on `/login`, then something triggers a `storage` event / redirect check while the error banner is showing (e.g. another tab is also on `/login`) | The error message **stays on screen** — no full-page reload wipes it. A tab already sitting on `/login` is never force-reloaded/redirected by the cross-tab sync |

**Out of scope (known, not a regression):** there is still no server-side token blacklist. A token
already copied out of the browser stays valid until it expires — this fix only makes the *browser*
consistent. A revocation endpoint is a possible separate piece of work.

### S2 — logout didn't actually unregister push notifications (MEDIUM)

**Real example:** the warehouse manager logs out of the shared laptop. That browser kept getting
*his* push notifications afterwards, because the "unregister this device" call
(`DELETE /admin/me/fcm-token`) was fired *after* the token had already been wiped, so it went out
with no `Authorization` header, got 401'd, and silently did nothing. The auto-logout paths (a 401
from any API call, or `/admin/me` returning 401/403 for a deactivated admin) never even attempted
the unregister.

**Fix:** one shared logout sequence, `performLogout()` in `src/stores/authStore.ts`, used by all
four exit points (header Logout button, ⌘K "Logout" command, axios 401 interceptor, `fetchMe`
401/403). It snapshots the token, clears the session immediately, and sends the unregister with the
snapshotted token pinned to the request — so the ordering can't be got wrong again, and a slow or
failing unregister never delays the logout.

| Step | ✅ Expected |
|---|---|
| Log in, allow notifications, then click **Logout** (DevTools → Network) | `DELETE /admin/me/fcm-token` is sent **with** an `Authorization: Bearer …` header and returns **200**, not 401 |
| Same, using the ⌘K palette → "Logout" | Identical behaviour |
| Have someone trigger an admin push to that device afterwards | The logged-out browser gets **nothing** |
| Go offline (DevTools → Offline) and click Logout | You are logged out **immediately** anyway — no hang, no stuck screen |
| Log in on a browser where notifications were never allowed, then Logout | Logout is instant; no `fcm-token` request at all (nothing was registered) |
| Let a session expire, then click anything (auto-logout via 401) | Redirected to `/login`, and an unregister was attempted rather than skipped entirely |

❌ **Fail signals:** the DELETE shows 401 in the Network tab; the Logout button visibly hangs for
seconds; notifications keep arriving after logout.

**Automated cover:** `src/utils/authSync.test.ts` (9) and `src/stores/authStore.logout.test.ts` (5)
— `npx vitest run src/utils/authSync.test.ts src/stores/authStore.logout.test.ts`.

**Deploy needed:** admin frontend only.

### S3 — a fresh login got wiped by another tab (HIGH, 2026-09-07)

**Real example:** the store laptop has yesterday's admin panel still open in a tab nobody looks at.
You open a new tab, type your email and password, the server accepts it ("Admin logged in") — and
half a second later you are back on the login screen, as if nothing happened. Log in again: same
thing. The only workaround was closing the other tab first.

**What was happening:** the S1 cross-tab fix above made the old tab react to your login by logging
*itself* out — correct. But that reaction was a normal state change, so it also **wrote** an
"empty session" into the shared browser storage, on top of the session you had just created. Your
brand-new tab then saw that empty write, believed its own session had been ended somewhere else,
and logged you out. A tab reacting to a login was cancelling that login.

**Fix (`haper-admin` frontend only):**
- The reacting tab now clears itself **without writing** to the shared key. It is only catching up
  with what another tab already wrote, so it has nothing new to store.
- Each login/logout is stamped with the time it happened (`sessionStamp`, stored alongside the
  token). A tab now ignores any shared-storage update that is **older** than its own session, so an
  old tab can never invalidate a newer one.

**Note on what the reacting tab shows afterwards:** the reacting tab's bounce to `/login` is a full
page load, so it re-boots into whatever session is genuinely in browser storage — i.e. the admin who
just logged in. It lands on the login *form* (there is no redirect-if-already-logged-in), but
navigating to `/` from there shows that other admin's panel. That is how localStorage sessions have
always worked here (right-click "Open in new tab" keeps the login); it is not new and not a
regression.

| Step | ✅ Expected |
|---|---|
| Tab A left logged in as admin X (yesterday's tab). In Tab B, log in as admin Y | **Tab B lands on the dashboard and stays there.** Tab A logs itself out and goes to `/login` |
| Repeat with Tab A sitting on a *different* page (`/orders`, `/pos`) | Same: Tab B stays signed in, Tab A bounces to `/login` |
| After the above, in Tab B: `localStorage.getItem('haper-admin-auth')` | Holds admin **Y's** token, not an empty session |
| After Tab A bounces to `/login`, navigate Tab A to `/` | ✅ It shows admin **Y's** panel (the browser genuinely holds Y's session; same as opening a new tab). **This is expected, not a bug** — do not raise it |
| Regression check on S1: two tabs as the same admin, Tab B clicks **Logout** | Tab A still jumps to `/login` and the old session still does **not** come back |
| Regression check: one tab only, normal login | Unchanged — straight to the dashboard |
| In Tab B's console: `localStorage.clear()`, then look at Tab A | Tab A logs out and goes to `/login`; clicking around Tab A never puts the old token back into storage |
| An admin who has not refreshed since this shipped (old stored session, no stamp) logs out in that stale tab | ⚠️ A **newly opened** tab will *not* pick up that logout (the stale tab writes no stamp). Refreshing the stale tab once fixes it — see the transitional note below. Everything else behaves as before |

❌ **Fail signals:** login bounces back to `/login` with the correct password; Tab B ends up logged
out while Tab A stays alive; a logout in one tab stops reaching the other tabs (that would mean S1
regressed).

**Known transitional detail:** a tab that is still running the *pre-fix* build (opened before the
deploy and never refreshed) writes sessions without a stamp, and a new tab will ignore its logout.
Refreshing that old tab once closes the gap; it cannot happen at all after everyone reloads.

**Also covered by the same fix:**
- An emptied or corrupt storage key (`localStorage.clear()`, a garbled blob) carries no stamp, so it
  is **never** ordered away — a logged-in tab still logs out on it, and cannot write its old token
  back afterwards.
- A new login/logout is always stamped above the highest stamp this tab has ever held **or seen from
  another tab**, so a backwards clock correction (NTP step, someone changing the system time — on
  this machine or on the one the other tab is on) can't make a genuine transition look stale.
  Example: another tab's clock is set years ahead and it publishes a huge stamp; this tab reacts,
  keeps its own older stamp (a reaction is not a new session), and the next real sign-in here is
  still stamped above that huge number, so the other tab cannot ignore it.
- Logging out on a tab that already has no session writes nothing, so it can't stomp a live tab.

**Automated cover:** `src/utils/authSync.test.ts` (20, incl. a full login-with-a-noisy-sibling-tab
flow, three built through the real `login()` so the tab is genuinely stamped, and three clock-drift
cases pinning the stamp floor for a hydrated stamp, a merely observed stamp, and one observed by a
logged-out tab from a logged-out sibling — the case where nothing is acted on at all) plus
`src/stores/authStore.logout.test.ts` (6) — `npx vitest run src/utils/authSync.test.ts
src/stores/authStore.logout.test.ts`.

**Deploy needed:** admin frontend only. After deploying, ask admins with a tab open since before the
deploy to refresh it once (that closes the transitional gap above).

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
