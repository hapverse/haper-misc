# Test: Customer auth moved from `packages/auth` to `packages/user` (`/user/auth/*`)

**Area:** Customer (app/web) login — OTP login, Google sign-in, token refresh
**Backend:** `packages/user/src/routes/auth/**`
(`router.js` + `otp/`, `google/`, `refresh/` sub-routers, and the shared `otpCache.js` helper)
**Old path:** `packages/auth` (`/auth/*`) is **still live and untouched** — see "Twin-file
relationship" below. Nothing is removed; this is a **new parallel path**.
**Clients:** **none yet.** No app/web build calls `/user/auth/*` today. It exists so future app
builds can drop the dependency on the separate auth service.
**Tests (green):** `packages/user/__tests__/auth-otp.test.js`, `auth-google.test.js`,
`auth-refresh.test.js` — 118 tests. Run:
`cd packages/user && NODE_ENV=test npx jest __tests__/auth-otp.test.js __tests__/auth-google.test.js __tests__/auth-refresh.test.js`
**Deploy needed:** backend only (`packages/user`). **No client deploy is coupled to this** — since
no client calls the new routes yet, shipping this cannot break an existing app. `packages/auth`
must keep running.

---

## What this is (real example)

Today, when a customer opens the Haper app and taps "Login", the app calls the **auth service**
(`/auth/otp/get-otp`, `/auth/otp/login`, …). That service is a separate deployable that also
handles admin/delivery/picker login. We are pulling the *customer* half of it into the user
service, so the customer app eventually talks to one backend instead of two.

Concretely: `GET /auth/otp/get-otp?...` gets a twin at `GET /user/auth/otp/get-otp?...`. Same
request, same response body. Nobody calls the new one yet — you have to hit it with curl/Postman.

The copy is **not verbatim**. Five things were deliberately changed or hardened during the move
(each is a separate section below):

- **N1 — the OTP is now single-use.** In `packages/auth` an OTP keeps working until its 2-minute
  TTL runs out, so the same code can be replayed. Here it is deleted the moment it is successfully
  redeemed.
- **N2 — a rejected login no longer burns the OTP.** Real example: a user types a friend's referral
  code wrong. The server answers 404 "Invalid referral code". Previously the OTP had *already* been
  deleted by then, so their code was dead and — because resends are cooldown- and cap-limited —
  they could be locked out of signup for up to 15 minutes. Now the OTP is burned only at the very
  end, once nothing can still reject the request.
- **N3 — the master-OTP bypass is REMOVED (2026-08-30).** Login/signup used to also accept a fixed
  static code (`OTP_FOR_USER_REGISTRATION`) for ANY phone number, with no environment gate — i.e.
  anyone who knew that string could log into any customer account in production. Both the OTP and
  the Google `verify-phone` paths (and the frozen `packages/auth` twin) now accept **only** the real
  cached SMS code.
- **N4 — the resend cooldown is claimed atomically.** Two taps on "Resend" at the same instant used
  to both read the old "last sent" timestamp and both send an SMS. SMS costs money.
- **N5 — Google email lookup is an exact indexed match**, not a case-insensitive regex.

Plus dedicated per-route **rate limiters** (section 7), which `packages/auth` does not have at all.

---

## Twin-file relationship to `packages/auth`

| New (`packages/user`) | Frozen twin (`packages/auth`) |
| --- | --- |
| `src/routes/auth/otp/{router,controller,validator}.js` | `src/routes/otp/*` |
| `src/routes/auth/google/{router,controller,validator}.js` | `src/routes/google-auth/*` |
| `src/routes/auth/refresh/{router,controller,validator}.js` | `src/routes/refresh/*` |
| `src/routes/auth/otpCache.js` | *(no equivalent — new shared helper)* |
| `src/routes/auth/router.js` (rate limiters) | *(no equivalent — no limiters there)* |

**Rules:**
- `packages/auth` is **frozen**: do NOT port these fixes back into it, and do NOT "sync" the two.
  Old installed app builds keep using it exactly as it behaves today. Changing it would change
  behaviour under live users with no way to roll the app back.
- Both services read and write the **same OTP cache keys** (`<phone>_OTP`, `<phone>`,
  `<phone>_LAST_SENT`). In dev/prod, where Redis is shared, an OTP requested via `/auth/...` can be
  redeemed via `/user/auth/...` and vice versa. Keep that in mind while testing — it is also why
  N1/N3 matter: the new service's single-use rule applies to a code the old service may have issued.
- `otpCache.js` exists so the **otp** and **google** controllers in this package cannot drift apart
  on the same cache key. If you change OTP verify/burn rules, change them there — once.

---

## How to run these checks

- **Dev:** base URL `https://dapi.haper.in` (the user service). Prefix every path with `/user/auth`.
- **Local:** `cd packages/user && npm run dev` (reads `.env`), then `http://localhost:<port>/user/auth/...`.
- You need a **real phone** to read the SMS. There is **no master/bypass OTP any more** — the only
  accepted code is the one actually sent and cached. On dev you can read the cached code straight
  from Redis (`<phone>_OTP`); automated tests seed that key themselves.
- These routes are **exempt from the geo/store middleware** (`middleware/geo.js`) — no
  `latitude`/`longitude` headers are needed. A logged-out user has not picked a store yet.

---

## Walkthrough

### 1. `GET /user/auth/otp/get-otp` — request an OTP

Query: `countryCode` (1-3 digits, no `+`) + `phoneNumber` (Indian, `^[6-9]\d{9}$`).

- ✅ `?countryCode=91&phoneNumber=9876543210` → **200**
  `{ "msg": "OTP is valid for 2 mins only", "data": { "message": "<gateway msg>", "new": true } }`
  — `new: true` means no account exists for that number yet, `false` means it does.
- ✅ The response has exactly the keys `msg` + `data{message,new}` — same shape as `/auth`'s.
- ✅ The OTP itself is **never** in the response body. Only the SMS has it.
- ❌ Missing `countryCode`, missing `phoneNumber`, `phoneNumber=12345`, a number starting with
  `5`, or `countryCode=abcd` → **403** with the Joi message.
- ❌ Immediately requesting again for the same number → **429**
  `{ "message": "Please wait 2 minutes before requesting another OTP" }`.
- ❌ A 3rd send inside the same 15-minute window → **429**
  `{ "message": "Too Many Requests. Please try after 15 mins" }`.
  (You will normally hit the 2-minute cooldown first; the 15-minute cap is the harder stop at 2
  sends per window.)

#### 1a. Padded phone number is normalised (N4 support)
- ✅ `?countryCode=91&phoneNumber=%20%209876543210` (two leading spaces) → **200**, and it counts as
  the **same** number: requesting again with the clean `9876543210` immediately after returns the
  **2-minute cooldown 429**, not a fresh send.
- ✅ The OTP minted by the padded request **can be redeemed** with the clean number on
  `/otp/login`.
- Why this matters: the login validator is strict, so an OTP filed under a padded cache key could
  never be redeemed at all — the user would get an SMS that simply doesn't work, and could keep
  re-triggering paid SMS by re-adding spaces to dodge the cooldown.

### 2. `POST /user/auth/otp/login` — verify OTP and log in

Body (strict — unknown fields rejected): `phoneNumber`, `otp` (6 digits), `name`, optional
`referrerCode` (auto-upper-cased).

- ✅ Correct OTP → **200** `{ "msg": "User LoggedIn", "data": { user{_id,avatar,name}, accessToken, refreshToken } }`.
- ✅ First-ever login for a number **creates the account**, with a `refCode` and a wallet row.
- ✅ An existing account is matched **by phone alone** — including accounts created through Google
  (`sType: GOOGLE`) or with no `sType` at all. (Matching on `sType: PHONE` only used to miss those
  and then crash on the unique phone index.)
- ✅ Passing a `name` other than `"Guest Name"` updates the stored name.
- ✅ Valid `referrerCode` → the new user's `referredBy` is set to the referrer.
- ✅ The access token works on existing user routes, e.g. `GET /user/profile` with
  `Authorization: Bearer <accessToken>` → 200, same `_id`.
- ❌ Wrong OTP, or an OTP for a number that never requested one → **400** `"Invalid or expired OTP"`.
- ❌ Missing `phoneNumber` / `otp` / `name`, a malformed number, a non-6-digit OTP, or an extra
  field such as `role: "super_admin"` → **403**.
- ❌ Unknown `referrerCode` → **404** `"Invalid referral code"`.

#### 2a. Soft-deleted accounts
- ✅ A user who deleted their account **within** the 30-day recovery window → **200** with
  `msg: "Account scheduled for deletion"` and `data{deletedSoftly, deletedAt, daysUntilPermanent,
  restoreToken}`. There is **no** `accessToken` — the app must show the Restore screen first.
- ❌ Past the recovery window but not yet purged by cron → **410** `"Account is no longer recoverable"`.
- ✅ Once the purge job has run (phone freed, `phoneArchived` set) the same number can sign up as a
  **brand-new** user with a **different** `_id`.

### 3. N1 + N2 — the OTP is single-use, but only spent on success

This is the most important behaviour from the fix loop. Test it in this exact order:

- ✅ Request an OTP for a fresh number and read the code from the SMS.
- ❌ Log in with a **wrong referral code** → **404**. **The OTP is still alive.**
- ✅ Immediately log in again with the **same OTP** and a valid/absent referral code → **200**.
- ❌ Log in a **third** time with that same OTP → **400** `"Invalid or expired OTP"` — it was spent
  by the successful attempt, well before its 2-minute TTL.
- ❌ Same rule on the 410 path: a "no longer recoverable" rejection also leaves the OTP alive
  (rejections never cost the user their code).
- Contrast with `packages/auth`: there, step 2 kills the code and step 3 (a replay) still works.
  Deliberately divergent — do not "fix" the twin.

### 4. N3 — the master OTP is rejected
- ❌ Log in with the old master OTP (`995518`, the retired `OTP_FOR_USER_REGISTRATION` value) on a
  phone with no pending code → **400** `"Invalid or expired OTP"`, and **no user row is created**.
- ❌ Same call while a genuine OTP is pending → **400**, and the pending code is **left alone**
  (a rejection never costs the user their code — N2).
- ✅ The real SMS code still works right after that rejected attempt → **200**, and *now* it is
  burned (a further replay → 400).
- ✅ Same on the Google path — see 6c.
### 4b. Both remaining master-OTP overrides are gone (2026-08-30)

⚠️ **Status as of 2026-08-30: only the account-deletion half has landed.** The delete-confirm
override is gone, but `config.otp` still exists in `packages/shared/config/index.js` and
`packages/delivery` still accepts `OTP_FOR_ORDER_COMPLETION` (`898444`) on rider drop-off — the
rider bullets below are **not testable yet**. Two flows to re-test:

- **Account deletion confirm** (`POST /user/profile/delete-account/confirm`, logged-in user):
  - ❌ Send `otp: 995518` while a genuine delete-OTP is pending → **400** `"Invalid or expired OTP"`,
    account stays **ACTIVE**, and the real SMS code is **not** burned.
  - ✅ Immediately retry with the real SMS code → **200**, account goes `DELETED_SOFT`, wallet
    forfeited, the caller's token stops working.
  - ❌ Send a wrong OTP **5 times** → each is **400**; the **6th** call is **429** `RATE_LIMITED`
    with `data.retryAfterSec` (15-minute window), even if the 6th carries the correct code. A
    successful delete clears the counter.
  - ❌ Send **6 wrong OTPs at the same instant** (parallel, so they land on different pm2
    workers) → at most **5** get a 400; the counter is an atomic Redis INCR now, so parallel
    attempts can no longer overshoot the cap. The 15-minute window still starts at the **first**
    failure, it does not slide forward with each attempt.
- **Account restore** (`POST /user/profile/restore-account`):
  - ✅ Delete an account holding **50** coins (wallet drops to **0**), then restore inside the
    30-day window → **200**, wallet is back to **50** and the lifetime `total` is still **50**
    (the give-back must not double-count lifetime earnings).
  - ✅ Fire **3 restore calls with the same `restoreToken` at the same instant** → the wallet ends
    at **50**, not 150. Only one caller performs the give-back; the others still restore normally.
  - ✅ Restoring an account that was deleted with a **0** balance credits nothing.
  - ✅ **Ledger and coins move together.** If the wallet write fails mid-restore (force it by
    breaking the wallet update, e.g. mock `WalletRepository.upsertWallet` to throw), the call
    returns **5xx**, the account stays `DELETED_SOFT`, coins stay **0**, and **no**
    `ACCOUNT_RESTORE_REFUND` row appears in wallet history. Retrying the same `restoreToken`
    then pays the **50** coins exactly once. A refund row in admin wallet-history with no
    matching coin credit is a **bug** — the two share one Mongo transaction now.
  - ❌ Restore after the 30-day window → **410**; ❌ a garbage `restoreToken` → **401**.
- **Rider drop-off** (`PATCH /delivery/order/mark-status` with `status: CLOSED`):
  - ❌ Close an OUT_FOR_DELIVERY order with `otp: 898444` → **400** `"Invalid OTP. N attempt(s)
    remaining."`, order stays OUT_FOR_DELIVERY. Real riders must ask the customer for their code.
  - ✅ The customer's real per-order `deliveryOtp` still closes it → **200**.
  - ✅ The 5-attempt lockout is unchanged: a rejected `898444` costs one attempt; 5 wrong codes →
    **429** `"Too many incorrect OTP attempts on this order."` even with the right code afterwards.
  - ⚠️ Ops impact: dispatch/testers who used `898444` to close stuck orders must now use the
    admin order screen instead — there is no rider-side override any more.

### 5. N4 — resend cooldown is an atomic claim, cap wins over cooldown
- ✅ Fire **two `get-otp` calls for the same new number at the same instant** → exactly **one**
  200 and one **429** cooldown, and exactly **one** SMS is sent. Previously both could send.
- ✅ A number that is **both** capped (2 sends in 15 min) **and** inside its 2-minute cooldown gets
  the **cap** message (`"Too Many Requests. Please try after 15 mins"`), not the cooldown one —
  the count check runs first, and it is the longer, more useful wait to report.
- ✅ Hitting the cap does **not** mint or refresh the cooldown key.
- ✅ The cooldown key `<phone>_LAST_SENT` now has a **2-minute** TTL (it used to be 15 minutes,
  which locked resends out for the whole counting window). Holding the key *is* the cooldown.
- ✅ After ~2 minutes a resend succeeds and still counts toward the 15-minute cap of 2.

### 6. `POST /user/auth/google/register` and `POST /user/auth/google/verify-phone`

**register** body: `idToken` (+ optional `referrerCode`).
**verify-phone** body: `idToken`, `phoneNumber`, `otp` (+ optional `referrerCode`).

#### 6a. register
- ✅ Google account already linked to an account **that has a phone** → **200**
  `msg: "User Registered and LoggedIn"` + tokens. Missing `sId`/`avatar` are back-filled from
  the Google payload.
- ✅ Unknown email, **or** a matching row with **no phone** → **200**
  `{ msg: "Phone number verification required", data: { requiresPhoneVerification: true, idToken } }`
  → the app must then call `verify-phone`.
- ❌ `email_verified` false in the Google payload → **403** `"Google account email is not verified"`.
- ❌ No `idToken`, or an unknown extra field → **403**.
- ❌ Unknown `referrerCode` → **404**.
- ❌ Google rejects the token → **401** `"Google authentication failed"`.

#### 6b. N5 — legacy upper-case stored emails no longer match
- ✅ A row stored as `SomeUser@Example.com` (legacy data) + Google sending `someuser@example.com`
  → **`requiresPhoneVerification: true`**, **no tokens**, and the legacy row is left untouched.
  The user completes `verify-phone`, which re-links the row and lower-cases the email.
- ✅ The reverse still works: a row stored **lower-case** matches whatever case Google sends,
  because the incoming address is lower-cased before the lookup.
- ✅ A `.` in the address is no longer a regex wildcard: `a.b@example.com` must **not** match a
  stored `axb@example.com`.
- Why the change: the old lookup was a case-insensitive regex built by raw string interpolation.
  On an unauthenticated endpoint that is an unindexed full-collection scan, and the unescaped `.`
  matched any character — i.e. it could log you into somebody else's account.
- **Known consequence to watch:** if dev/prod has real users whose stored email has capitals, they
  will be sent through phone verification once instead of straight in. Check before deploy:
  `db.users.countDocuments({ email: { $ne: null }, $expr: { $ne: ["$email", { $toLower: "$email" }] } })`
  (read-only, dev cluster).

#### 6c. verify-phone
- ✅ Correct (real, cached) OTP + no existing phone account → creates a `sType: GOOGLE` account
  with the lower-cased email, Google `sub` as `sId`, the Google picture as avatar, and a `refCode`.
- ✅ Existing phone account with the **same** Google `sub`, or with **no** `sId` yet → merged/linked
  and logged in (same `_id`).
- ❌ Existing phone account linked to a **different** Google account → **400**
  `"This phone number is already linked to another Google account. Please use that account to login."`
- ✅ **The OTP is burned here too** (N1): a replay of the same code → **400**.
- ❌ **Master OTP is rejected here too** (N3) → **400**, no account created, and the pending real
  code stays redeemable on `/user/auth/otp/login`.
- ✅ A **404 bad referral code** on this endpoint also leaves the OTP alive and retryable (N2).
- ❌ Empty body / missing `otp` → **403**; unverified Google email → **403**; wrong OTP → **400**;
  Google token failure → **401**.

### 7. `POST /user/auth/refresh`
- ✅ Body `{ refreshToken }` from a login response → **200**
  `{ "msg": "Token refreshed successfully", "data": { accessToken } }`.
- ❌ Missing/empty `refreshToken` → **403** (validator).
- ❌ Garbage or expired token → **401** `"Invalid or expired refresh token"`.
- ❌ A valid refresh token **replayed from a different device/User-Agent** → **401**
  `"Refresh token compromised. Please login again."` — the token carries a fingerprint of the
  original request headers.

### 8. Rate limiters — SIX caps, none of which exist in `packages/auth`

All windows are 15 minutes except refresh (5 minutes). They are mounted in
`src/routes/auth/router.js`, **ahead** of the sub-routers, composite-key limiter first.

| # | Route | Cap | Key | 429 body message |
| --- | --- | --- | --- | --- |
| 1 | `GET /otp/get-otp` | **3** / 15 min | `phone` + IP | `Too many OTP requests for this number. Please try again in 15 minutes.` |
| 2 | `GET /otp/get-otp` | **20** / 15 min | IP only | `Too many OTP requests from this network. Please try again in 15 minutes.` |
| 3 | `POST /otp/login` | **10** / 15 min | `phone` + IP, **failures only** | `Too many login attempts. Please try again in 15 minutes.` |
| 4 | `POST /otp/login` | **30** / 15 min | IP only, **failures only** | `Too many login attempts from this network. Please try again in 15 minutes.` |
| 5 | `POST /google/register` + `POST /google/verify-phone` | **30** / 15 min (shared budget) | IP only | `Too many Google sign-in attempts. Please try again in 15 minutes.` |
| 6 | `POST /refresh` | **30** / 5 min | IP only | `Too many refresh attempts. Please try again shortly.` |

- ✅ #1: 4 rapid `get-otp` calls for one number from one IP → the 4th is the **limiter** 429
  (calls 2 and 3 are the controller's cooldown 429, but they still spend limiter budget).
- ✅ A **different** number from that same IP still works afterwards (the key is composite, so
  knowing someone's number cannot lock them out globally).
- ✅ #2: rotating through 21 different numbers from one IP → the 21st is 429. SMS costs money, so
  successful sends count too.
- ✅ #3/#4 use `skipSuccessfulRequests` — 13 **successful** logins in a row all return 200; only
  failures count. 11 failed attempts on one number/IP → the 11th is 429.
- ✅ A different IP is always unaffected by another IP's exhausted budget.
- Note: the limiters run **before** the Joi validators, so they shape-check the phone themselves.
  A junk `phoneNumber` (huge string, or an object) cannot mint its own bucket — it falls back to
  the plain IP bucket.

---

## Known gaps / follow-ups (not fixed here)

- ❌ **Concurrent first-time signup still creates TWO accounts for one phone number.** Fire two
  simultaneous `POST /otp/login` (or two simultaneous `google/verify-phone`) for a brand-new
  number: both return 200 with **different** `_id`s and two `users` rows exist.
  Root cause is **not** in these routes — the controllers' E11000 recovery is correct and proven —
  but in `packages/shared/models/users.schema.js:45-46`, where the `phone` and `email` unique
  indexes are declared with `partialFilterExpression: { phone: { $ne: null } }`. MongoDB does not
  accept `$ne` in a partial filter, so **those indexes are never built** and the duplicate error
  the recovery waits for never fires. Verify on dev with `db.users.getIndexes()` — there is no
  `phone_1`. Pinned as `it.failing` tests in `auth-otp.test.js` and `auth-google.test.js`; both
  flip green the moment the schema is fixed (a `$type: "string"` / `$gt: null` filter, plus a
  duplicate cleanup before the index can build).
- ❌ `google/verify-phone`'s validator does **not** shape-check `phoneNumber` (Indian format) or
  `otp` (6 digits), while `otp/login`'s does. Copied as-is from `packages/auth`; tightening it is a
  separate change and would need the app checked first.
- ❌ No client calls these routes yet — the real end-to-end check happens when the app is pointed
  at them. Until then this guide is curl/Postman only.
- ❌ `packages/auth` retains the old behaviour (replayable OTP, referral 404 burns the code). Any
  user on an old app build still gets that. Fully retiring `/auth/*` is a separate, app-gated task.
