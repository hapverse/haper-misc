# Test: Referral — self-referral block + phone/email unique index (2026-09-12)

**Area:** referral capture (profile + signup), user account uniqueness
**Backend:**
`packages/user/src/routes/profile/controller.js`,
`packages/shared/models/users.schema.js`,
`packages/user/src/connections/mongo.js`,
`packages/admin/src/connections/mongo.js`,
`packages/shared/events/order.handler.js` (payout-path guard),
`packages/shared/utils/mongo-index.utils.js` (index visibility),
`packages/admin/src/routes/pos/controller.js`,
`packages/admin/src/routes/pos/coupon.js` (POS customer lookup — see
`test-pos-counter-sales.md`)
**Branch:** `dev` (direct-to-dev)
**Phase:** backend only. **No client change needed** — the app never offered self-referral as a
feature, so the only visible difference is a new error message on a path the app already handles.
Related: `test-referral-code-signup.md` (the client-side signup field).

---

## Why this exists (a real example)

Every customer gets a 6-character referral code. When Riya signs up with Amit's code, Amit is paid
**3% of Riya's first order and 1% of every order she ever places after**, as wallet coins that spend
1:1 as rupees. That is real money leaving the business, forever, with no cap.

**Bug 1 — you could refer yourself.** Amit could call `PATCH /user/profile` with **his own** code.
Nothing checked that the code's owner wasn't the caller. From then on Amit got 3%/1% of **his own**
every order back into his own wallet — a permanent private discount. This was **actually happening**:
**10** payout rows (`logs` rows of `type: 1` where `meta.referee` is the earner's own id) across
**3** accounts in the production data dump, **₹30** paid out so far. A **4th** account
(`6a9e5edf04e6daecd4efae36`) carries `referredBy === own _id` but never earned anything — 4 accounts
self-referred, 3 of them actually got paid.

**Bug 2 — nothing stopped one phone number having two accounts.** The "one account per phone"
rule is enforced only by a unique database index, and that index **never existed**. Its definition
used `$ne` inside a `partialFilterExpression`, which MongoDB flatly rejects — so the index was
never created, and no error was ever visible. Even with correct syntax it still would not have been
built, because every service connects in a read-from-replica mode that makes Mongoose silently skip
all index creation. So the second hole was: sign up account B with account A's code, order once from
B, and A pays himself 3%. That scales to as many throwaway accounts as you like.

**What changed**
1. `PATCH /user/profile` now answers **400 "You cannot use your own referral code"** and saves
   nothing at all (not even a name change sent in the same request).
2. The phone and email unique indexes now use a filter MongoDB accepts
   (`{ $exists: true, $type: "string" }` — the exact spec already live in prod), and are
   force-built at service boot the same way the coupon indexes already are.

**Signup is not affected** and deliberately got no new check — see "Why signup was left alone".

---

## Prerequisites

1. Dev API (`dapi.haper.in`) on a build that includes this change.
2. Two test accounts. Get each one's own code from `GET /user/profile` → `data.user.refCode`.
3. Account **A** must be freshly created (its `referredBy` must still be empty — the field can only
   ever be set once, so a used account cannot re-test section A).

---

## Manual test steps (dev)

### ✅ A. Self-referral is refused
1. Log in as account **A** and read its own code from `GET /user/profile` (e.g. `A3F91C`).
2. Call `PATCH /user/profile` as **A** with body `{ "referrerCode": "A3F91C" }`.
3. **Expect 400** and the message **"You cannot use your own referral code"**.
4. `GET /user/profile` again → `referredBy` is still **null**. ✅
   ❌ Fail if it returns 200, or if `referredBy` now points at A itself.

### ✅ B. Lowercase does not sneak past it
1. Same as A, but send the code in lowercase: `{ "referrerCode": "a3f91c" }`.
2. **Expect the same 400.** ✅
   ❌ Fail if it returns 200 — the controller upper-cases before looking the code up, so the guard
   must run after that, not before.

### ✅ C. A rejected self-referral saves nothing else either
1. As **A**, send `{ "name": "Changed Name", "referrerCode": "<A's own code>" }`.
2. **Expect 400.**
3. `GET /user/profile` → the name is **unchanged**. ✅
   ❌ Fail if the name changed — the guard must return before the update runs, so the request is
   all-or-nothing.

### ✅ D. A genuine referral still works (the important regression)
1. As **A**, send `{ "referrerCode": "<account B's code>" }`.
2. **Expect 200**, and `referredBy` now points at B. ✅
   ❌ Fail if this is refused — the guard must only catch the self case.

### ✅ E. Set-once still holds
1. As **A** (already referred by B from step D), send a **third** account C's code.
2. `referredBy` must still be **B**. ✅ (Unchanged behaviour, re-checked because the guard sits on
   the same code path.)

### ✅ F. An unknown code still 400s
1. As a fresh account, send `{ "referrerCode": "ZZZZZZ" }` → **400 "Invalid referral code"**. ✅
   The two rejections have different messages on purpose, so support can tell them apart.

### ✅ G. Signup is untouched
1. Sign up a brand-new phone with account B's code → the new account's `referredBy` is **B**. ✅
2. Log in again on that **same** phone, sending the **new account's own** code → login **succeeds**
   (200) and `referredBy` is still **B**, unchanged. ✅
   ❌ Fail if login is now refused — see the warning below; that would lock users out.

### ✅ H. The phone index is actually built (deploy check, dev)
1. Restart the dev **user** API and the dev **admin** API.
2. Check the boot logs for `[mongo] index build FAILED for users`. **It must NOT appear.** ✅
   If it does, read the message: `IndexKeySpecsConflict` (code 86) means an index with the same
   name already exists with a **different spec** — the existing index is left untouched and this
   error would repeat on every restart forever, so the schema spec must be corrected to match what
   is live; `E11000`/duplicate key means real duplicate phone numbers exist and must be cleaned up
   first (the production dump showed **zero** duplicates, so this is not expected).
   Note: a conflict on one index does **not** block the others. Mongoose builds each declared index
   with its own `createIndex` call, so `phone_1` failing still leaves `email_1` and `refCode_1`
   built (verified against mongodb-memory-server).
3. Confirm on the dev cluster (read-only) that `users` now has a `phone_1` index with
   `unique: true` and `partialFilterExpression: { phone: { $exists: true, $type: "string" } }` —
   the exact spec prod already carries, so the build is a clean no-op rather than a conflict.
4. Sign up a brand-new account on an unused phone → succeeds. ✅
   Sign up again on a phone that already has an account → you get **logged into the existing
   account**, as before, not a second account. ✅

---

## Edge cases worth checking

| Case | Expected |
|---|---|
| Account already has `referredBy` set, then sends its own code | 200, nothing changes — the set-once guard short-circuits before the lookup, so the self-check never runs. Not a hole: self-referral needs an *empty* `referredBy`. |
| Blank / empty-string `referrerCode` | Ignored, request proceeds. Unchanged. |
| Deleted account whose code was kept | Still resolves as a referrer (deliberate — see `account-purge.js`). Only the *caller's own* code is refused. |
| Two accounts purged by the cron on the same day | Both succeed. Purge sets `phone`/`email` to **null**, and a null is not a string, so purged rows fall **out** of the unique index and their numbers are freed for a fresh signup. This is exactly why the filter carries `$type: "string"` and not `$exists: true` alone. |
| Google account created before phone verification (no phone field at all) | Many can coexist — absent is also not a string. |

---

## Why signup was left alone (deliberate, do not "fix" it)

Signup **cannot** self-refer, structurally: the code you type must belong to an account that
already exists, and the new account does not exist yet. On both the OTP and the Google path,
`referredBy` is only ever passed in on the "no user yet, create one" branch. If an *existing* user
logs in and sends a code — including their own — it is **silently ignored** today.

Turning that silent ignore into an error would be **dangerous**: if any client persists the code
the user typed at signup and re-sends it on every subsequent login, that user would be permanently
locked out of their own account. So it stays a silent ignore. Two tests pin the structure instead,
so that if `referredBy` is ever moved onto the shared path, the suite fails before a wallet does.

`packages/auth` (the frozen copy kept alive for old app builds) has **only** the two signup paths,
**not** the profile retro-attach path — so there is no frozen twin of this bug and nothing to port.

---

## Review round 2 (2026-09-12) — what the first fix missed

### The payout path now refuses a self-referral too

Blocking the *write* only helps people who have not already done it. `referredBy` is set **once**
and the user cannot clear it, so the **4 accounts already carrying their own id** would have kept
earning 1% of every order forever. The payout handler (`packages/shared/events/order.handler.js`,
`orderClosed3P_1P` — the thing that fires on `order-closed` and actually moves the coins) now
returns early when `referredBy === the buyer's own _id`. Same guard added to the legacy
`orderClosed` twin.

This is the single place money moves, so it also covers the frozen `packages/auth` signup flow and
any capture point added later, no matter how the bad value got there.

**✅ Manual check (dev):** take a test account whose `referredBy` is its own id, place and deliver an
order. Wallet coins must **not** increase and no new referral row appears in the log. The order's
`referralCredited` stays `false`.

> **Not fixed by code:** the 4 existing accounts still *have* the bad `referredBy` value. Clearing it
> is a production database write and is the user's to run manually — the code change only stops the
> money.

### Boot log now says whether the unique indexes actually exist

`ensureIndexesFor` only logs an index build that **throws**; a build that silently no-ops left the
phone/email uniqueness missing with no signal at all. Both connection files now check for
`phone_1`/`email_1` after the build and `console.error` a CRITICAL line if either is absent.
Deliberately **no kill switch** (unlike coupons) — a missing index means referral abuse is possible
again, not that the storefront is unsafe to serve.

**✅ Manual check (dev):** restart the API and read the boot log. A healthy boot prints
`MongoDB Connected: …` with **no** `[users] CRITICAL:` line above it.

---

## Automated coverage

`cd packages/user && NODE_ENV=test npx jest`

- `__tests__/profile.test.js` — self-referral 400, lowercase variant, nothing-else-saved, genuine
  referral still works. (The old test that **locked in** the vulnerable behaviour was inverted.)
- `__tests__/auth-otp.test.js`, `__tests__/auth-google.test.js` — signup cannot self-refer.
- `__tests__/referral-idempotency.test.js` — a buyer whose `referredBy` is their own id earns
  nothing on their first order (3% leg) or any later one (1% leg), and the order stays uncredited.
- `__tests__/user-phone-email-unique-index.test.js` — new. Proves MongoDB rejects the old `$ne`
  filter, that `Model.init()` builds nothing on a `secondaryPreferred` connection, that
  `ensureIndexesFor()` does build both indexes unique+partial, that a duplicate phone is rejected,
  and that many null-phone (purged) rows still coexist.

---

## Known follow-ups (NOT fixed here — flagged only)

- **`refCode`'s own unique index is not partial** while the field defaults to `null`. At most one
  user row may have a null code. The save hook always fills it, but any write path that bypasses
  Mongoose middleware (a migration, a shell insert, an upsert) can create one — that would make
  `refCode_1` fail to build with `E11000`. It would **not** take the phone/email fix down with it:
  mongoose builds each index independently (probed), so the failure is scoped to `refCode_1`.
  Watch the boot log on the first deploy anyway.
- **A failed referral payout is silent** (`console.error` only, no retry, no alert) — that referrer
  is simply never paid and nothing can find it later.
- **No cap and no kill switch** on the 3%/1% reward; the rate is a hardcoded literal.
- **Boot index build cost:** `users` is a large, long-lived collection and this is the first time
  its indexes are force-built at boot. Expect the first restart after deploy to do real work.

Full background: `haper-backend/docs/reference/referral-system.md`.
