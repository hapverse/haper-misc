# Test: Referral — monthly cap + earning window (2026-09-12)

**Area:** referral payout (order close), global app config
**Backend:**
`packages/shared/events/order.handler.js` (payout order + limits read),
`packages/shared/repositories/referral-monthly-earning.repository.js` (atomic claim/release),
`packages/shared/models/referral-monthly-earnings.schema.js`,
`packages/shared/models/users.schema.js` (`referredByAt`),
`packages/shared/models/configs.schema.js` (`configs.referral`),
`packages/shared/constants/referral.constant.js`,
`packages/shared/constants/log.constant.js` (`REFERRAL_SKIPPED: 7`),
`packages/user/src/routes/auth/otpCache.js`, `packages/user/src/routes/profile/controller.js`
(capture points), `packages/auth/src/routes/otp/controller.js`,
`packages/auth/src/routes/google-auth/controller.js` (frozen twins),
`packages/admin/src/routes/config/{router,validator,controller}.js`,
`packages/user/src/connections/mongo.js`, `packages/admin/src/connections/mongo.js` (counter index)
**Branch:** `dev` (direct-to-dev)
**Admin FE:** `haper-admin` `src/pages/Config/ConfigSettings.tsx` — the **"Referral Settings"**
card on `/config` (super-admin only). Tests: `src/pages/Config/ConfigSettings.referral.test.tsx`.
**Phase:** **backend + admin UI. No client (Android/iOS/web) consumer yet.** HO changes the cap and
window from the admin Settings card; `PUT /admin/config/referral` by curl/Postman still works and is
the same endpoint the card calls (with `skipStoreHeader`, i.e. no `x-store-id`).
Related: `test-referral-self-referral-fix.md`, `test-referral-code-signup.md`.
Full background: `haper-backend/docs/reference/referral-system.md` §4b.

---

## Why this exists (a real example)

Amit shares his referral code. Every friend who signs up with it pays Amit **3% of their first
order and 1% of every order after**, as wallet coins that spend 1:1 as rupees. Before this change
that was **forever and unlimited**: one Amit with 200 friends ordering daily was an open-ended
cost line, and the only way to slow it down was a code deploy.

Two limits now bound it, both editable at runtime:

1. **Monthly cap — ₹500 per referrer per month.** Amit can earn at most ₹500 in a calendar month
   (Indian time), across all his friends put together. On 1st of the next month he starts from ₹0
   again.
2. **Earning window — 6 months.** Amit earns from Riya only for 6 months after she joined with his
   code. After that Riya's orders pay Amit nothing; Riya is unaffected either way.

If Amit's reward would be ₹40 but only ₹20 of his month is left, he is paid **₹20** — a partial
payout, not a refusal. When a limit pays him ₹0, the order is still **settled** (it is not retried
forever) and a `REFERRAL_SKIPPED` log row records *which* limit stopped it, so support can answer
"why did my earnings stop?".

**Grandfathering:** friendships that existed before this change have no `referredByAt` date, so
they have **no window** — they keep earning forever. They are still **capped** at ₹500/month.

---

## Prerequisites

1. Dev API (`dapi.haper.in`) + dev admin API (`damin.haper.in`) on a build that includes this.
2. A **referrer** account R and at least two **referee** accounts (F1, F2) signed up with R's code.
   R's wallet balance from `GET /user/profile/referrals` → `coinsEarned`.
3. A **super admin** login for the admin API, and one **non-super** admin login (for the 403 check).
4. Read-only access to the dev cluster to inspect `referral-monthly-earnings` rows
   (`{ referrerId, monthKey, earned, orderCount, capAtLastWrite, lastOrderId }`).

> Reminder: any change to `configs.referral` on dev is a **write through the admin API**, which is
> fine. Do not edit the `configs` collection by hand — the API also busts the `CACHE_APP_CONFIG`
> cache, a manual edit does not (and a hand-typed value is exactly how a garbage value gets in).

---

## Manual test steps (dev)

### ✅ A. A normal payout still works (the regression check)

1. Set the config to the defaults: `PUT /admin/config/referral`
   `{ "monthlyCapRupees": 500, "earningWindowMonths": 6 }` as super admin.
2. Place and deliver (close) an order for F1 worth ₹1000. First closed order → 3% = **₹30**.
3. R's wallet `coins` increases by **30**. ✅
4. A `logs` row `type: 1` on R with `meta.amount = 30`, `meta.grossReward = 30`,
   `meta.cappedTo = null`, `meta.monthKey = "<this month, e.g. 2026-09">`. ✅
   ❌ Fail if `cappedTo` is `500` here — it must be `null` when the full reward was paid.
5. A `referral-monthly-earnings` row exists for `(R, this month)` with `earned: 30`,
   `orderCount: 1`. ✅

### ✅ B. Partial payout near the cap

1. Get R's `earned` to **480** for this month (place/close enough orders, or use a smaller
   `monthlyCapRupees` to reach the edge faster — e.g. set the cap to ₹50 and work against that).
2. Close an order that would earn R **₹40** gross (e.g. ₹1334 at 3%).
3. R's wallet increases by **₹20 only** — the remaining headroom. ✅
4. `logs` type 1 → `meta.amount = 20`, `meta.grossReward = 40`, `meta.cappedTo = 500`. ✅
5. Counter row `earned` is exactly **500**, never above. ✅
   ❌ Fail if the wallet got ₹40, or if `earned` reads 520.

### ✅ C. An exhausted month pays ₹0 and says why

1. With R's `earned` already at the cap, close another order for F1.
2. R's wallet is **unchanged**, and there is **no new type-1 log**. ✅
3. A new `logs` row `type: 7` (`REFERRAL_SKIPPED`) on R with
   `meta.reason = "CAP_REACHED"`, `meta.grossReward = <the reward that was refused>`,
   `meta.orderId`, `meta.monthKey`, and **no `meta.amount`**. ✅
4. The order's `referralCredited` is **`true`** — settled, deliberately. ✅
   ❌ Fail if it is `false`: the order would be re-attempted on every re-close forever.
5. Re-close / re-fire the same order → still exactly **one** skip row, no second one. ✅

### ✅ D. IST month rollover starts a fresh budget

1. Exhaust R's cap in the current month.
2. Either wait for the 1st, or verify by reading the counter: last month's row is untouched and the
   next payout writes a **new row** with a new `monthKey`. ✅
3. The month boundary is **Asia/Kolkata**, not UTC: an order closed at 00:15 IST on the 1st belongs
   to the **new** month. Sanity-check on the counter: an order closed between 18:30 IST and
   midnight IST on the last day of a month must still be in the **old** month.
   ❌ Fail if a 23:00-IST order on the 31st lands in next month's row — that is the UTC bug.

### ✅ E. Earning window — 5 months vs 7 months

1. Pick a referee whose `referredByAt` is **5 months** ago (or set it on a dev test user).
   Close an order → R is paid normally, **no** skip row. ✅
2. Pick a referee whose `referredByAt` is **7 months** ago. Close an order →
   - R's wallet unchanged, no type-1 log. ✅
   - One `logs` type 7 row with `meta.reason = "WINDOW_EXPIRED"`. ✅
   - The order's `referralCredited` is **`true`** (settled). ✅
   - **No counter row was created / no budget burned** for R by this order. ✅
     ❌ Fail if `earned` went up: an expired link must not eat the month's cap.
3. Boundary: `referredByAt` exactly 6 months ago **minus a day** still pays; exactly 6 months ago
   **plus a day** does not. The maths uses calendar months, so a 31 Jan link expires 31 Jul, and a
   31 Aug link expires 28/29 Feb — not "183 days".

### ✅ F. Grandfathering — NULL `referredByAt`

1. Take a referee whose `referredByAt` is **null** (any friendship created before this deploy).
2. Close an order for them, however old the account is. R **is paid**, no skip row. ✅
3. But the cap still applies: exhaust R's month and the same order now skips with
   `CAP_REACHED`, not `WINDOW_EXPIRED`. ✅
   ❌ Fail if a null `referredByAt` is treated as "expired" — that would silently cut off every
   pre-existing referral on the day of deploy.

### ✅ G. Concurrent double-close sums to exactly the cap

1. With ₹500 of headroom left, fire two order-closes for R's referees **at the same time**, each
   worth ₹300 gross (e.g. two ₹10,000 orders at 3%).
2. Total credited to R's wallet across both = **exactly ₹500**, not ₹600. ✅
   One gets ₹300, the other ₹200 (whichever order they land in).
3. Counter row `earned` = **500**, `orderCount` = 2. ✅
   ❌ Fail if `earned` is 600, or if there are **two** counter rows for the same
   `(referrerId, monthKey)` — that means the unique index is missing, see step J.

### ✅ H. Admin endpoint — super admin only

1. As a **non-super** admin: `PUT /admin/config/referral` `{ "monthlyCapRupees": 100 }` →
   **403 "Only super admin can update referral configuration."** ✅
2. From a **store-scoped** admin context → **403 "Referral configuration is only available for
   global app config."** ✅ (the cap is company-wide on purpose).
3. As **super admin** → **200**, and `GET` the config back to confirm the value stuck. ✅
4. An audit row `action: "config.referral.update"` exists with `before`/`after`. ✅
5. Send only one key (`{ "earningWindowMonths": 3 }`) → the cap keeps its old value. ✅
6. Send `{}` → **400** (at least one key required). ✅

### ✅ I. The special values: 0 and null

| Body | Expected behaviour |
|---|---|
| `{ "monthlyCapRupees": 0 }` | **Kill switch.** Every payout grants ₹0 and writes a `CAP_REACHED` skip row. Orders still settle. ✅ |
| `{ "monthlyCapRupees": null }` | **Uncapped.** R earns the full reward however much they have already earned this month. ✅ |
| `{ "earningWindowMonths": 0 }` or `null` | **No window** — even a 3-year-old link earns. ✅ |
| `{ "monthlyCapRupees": -1 }` | **400** (validator: integer, min 0). ✅ |
| `{ "earningWindowMonths": 121 }` | **400** (max 120). ✅ |
| `{ "monthlyCapRupees": "abc" }` | **400** — the API refuses it; see the ❌ table for what happens if one gets in *behind* the API. ✅ |

After flipping the kill switch back off (`500`), the next order pays normally — nothing is
permanently disabled. ✅

### ✅ J. The counter's unique index is actually built (deploy check, dev)

1. Restart the dev **user** API and the dev **admin** API.
2. Boot log must **not** contain `[referral] CRITICAL: counter index(es) missing`. ✅
   That index (`referrer_month_unique` on `{ referrerId: 1, monthKey: 1 }`) **is** the cap — without
   it, duplicate rows mean the cap is silently unenforced. It logs loudly rather than refusing to
   boot, deliberately: unpaid referrals are money owed to a customer, not a reason to take the
   storefront down.
3. Confirm read-only on the dev cluster that `referral-monthly-earnings` carries that index with
   `unique: true`. ✅

---

## ❌ Edge cases worth checking

| Case | Expected |
|---|---|
| **Garbage config value** — `configs.referral.monthlyCapRupees` is `"abc"` or `{}` (only reachable by a hand edit of the DB, or if prod ever carries two `configs` docs) | Degrades to the **₹500 constant**, and the repository independently treats an unusable cap as **uncapped**. The counter row's `earned` must stay a **real finite number**. ❌ Fail if `earned` becomes `NaN` — that used to be permanent: `granted` would be 0 forever for that referrer, silent non-payment with no error anywhere. Once the config is fixed, that referrer must keep earning normally from the same row. |
| **Garbage window value** — `earningWindowMonths: "six"` | Falls back to the 6-month constant. ❌ Fail if **everyone** suddenly shows `WINDOW_EXPIRED` — that is `moment().add(NaN)` producing an Invalid Date, which compares as "already expired". |
| Config read **throws** (Mongo blip) | **Fail-OPEN**: still pays, using the ₹500 / 6-month constants. ❌ Fail if the payout is skipped — a config hiccup must not stop paying referrals. |
| `APP_CONFIG` doc exists but has **no `referral` key** (the live pre-feature doc) | Constants apply (₹500 / 6). This is not the same as the schema defaults — config is read with `.lean()`, which skips them. |
| Cap **lowered mid-month** — 500 → 300 when R already earned 400 | R freezes at 400 and earns ₹0 from then on. ❌ Fail if anything is clawed back or a negative grant appears. |
| Cap **raised mid-month** — 500 → 800 after R hit 500 | R immediately earns again, up to 800. ✅ |
| Reward rounds to ₹0 (order under ₹34 at 3%) | Returns before any claim; **no** counter row, **no** skip log, `referralCredited` untouched. |
| Wallet credit fails after the budget was claimed | Both the counter budget **and** the order claim are released, so a retry pays the full reward **exactly once**. Counter `earned` back to its previous value, `orderCount` not bumped. |
| Counter claim itself throws | Order claim released, nothing paid, no log. A later retry can still pay. |
| Self-referral (`referredBy` = own id) | Still blocked before any of this runs — see `test-referral-self-referral-fix.md`. No counter row. |
| Two different referees, same referrer, same month | **One** counter row, `earned` is their sum. The cap is the referrer's budget, not per-friend. |
| Referee's own wallet | Never touched. Only the referrer is capped and paid. |

---

## Automated coverage

`cd packages/user && NODE_ENV=test npx jest referral-monthly-counter referral-cap-window`
(in-memory Mongo only — never the real DB)

- `__tests__/referral-monthly-counter.test.js` — the repository in isolation: the atomic claim,
  partial grants, the uncapped path, the lowered-cap freeze, `release` guarded against going
  negative, the IST `monthKey`, and concurrent claims summing to exactly the cap.
- `__tests__/referral-cap-window.test.js` — the payout path end to end: 5-vs-7-month window,
  NULL `referredByAt` grandfathering, skip logged once on re-fire, partial payout with
  `cappedTo`, exhausted month, month rollover, config null/throw/missing-key fallbacks, the
  **NaN guards** (non-numeric cap and non-numeric window), and the wallet/counter compensation
  paths.
- `__tests__/referral-idempotency.test.js`, `referral-summary.test.js` — must stay green; the
  type-1 log shape they read is unchanged.
- Admin side: `cd packages/admin && NODE_ENV=test npx jest config` covers the
  `PUT /config/referral` permissions and validation.

---

## Known follow-ups (NOT fixed here — flagged only)

- ~~**No admin UI.**~~ **DONE (2026-09-12)** — the "Referral Settings" card on `/config` ships with
  this. See the walkthrough below. Still open: nobody outside super admin can see the values.
- **No client change.** Android/iOS/web show no cap, no "₹X left this month", and no reason when a
  referral pays nothing. The Refer-&-earn screen still just shows lifetime coins.
- **No visibility on skips.** `REFERRAL_SKIPPED` rows are queryable but nothing surfaces them —
  no admin screen, no report, no alert on a referrer who is being capped every month.
- **The 3%/1% percentage is still hardcoded** in `order.handler.js`; only the cap and window became
  config-driven. Changing the rate still needs a deploy to 2 frozen + 1 live service.
- **A failed referral payout is still silent** (`console.error` only, no retry, no alert) —
  pre-existing, unchanged by this feature.

---

## ✅ Walkthrough — the admin "Referral Settings" card (added 2026-09-12)

Where: `damin.haper.in` → **Config** (`/config`) → **PLATFORM SETTINGS** → **Referral Settings**
(icon: people, scope chip "All stores").

| # | Step | ✅ Expected |
|---|------|-------------|
| 1 | Log in as **super admin**, open `/config` | The "Referral Settings" card is visible, below the other platform cards. |
| 2 | Log in as a **store admin or manager** (any non-super-admin), open `/config` | The card is **not rendered at all** — no heading, no inputs. The page only shows STORE SETTINGS. The `GET /admin/config` the page makes carries `x-store-id` in that case and returns the store-scoped config, which has no `referral` block. |
| 3 | **First load, before anyone has ever saved referral settings** | Cap shows **500**, window shows **6** — the values payouts actually run under. It must NOT show two blank boxes; blank means "no limit", which would be a lie about live behaviour. This is what the GET fix below guarantees. |
| 4 | Clear the **Monthly earning cap** box (leave it empty) and save | Blank is sent as `null` = **no limit**. Reload: the box is empty with the grey placeholder "No limit". A blank is never turned into 0. |
| 5 | Type **0** into the cap and save | Stored as `0` = **referral payouts off** (every payout is skipped with `CAP_REACHED`). Reload shows `0`, not blank. Blank and 0 are different settings — check the hint text under the field says exactly that. |
| 6 | Type **-5** in either field | Inline red message **"Must be 0 or more."** under the field, the input gets the invalid border, and **Save is disabled**. Nothing is sent. |
| 7 | Type **2.5** in either field | Inline **"Enter a whole number."**, Save disabled. |
| 8 | Type **200** in the earning window | Inline **"Enter 120 months or fewer."**, Save disabled. (The backend validator rejects it with 400 as well — the inline message is only the first gate.) |
| 9 | Edit only the window, then Save | Only this card's Save button un-greys ("dirty" state is per-card) — editing referral must not mark the Maintenance / Support / Force-update cards dirty, and saving must not touch their values. |
| 10 | Save successfully | Green "Referral settings saved" toast, the card flashes its saved state, Save greys out again. |
| 11 | After saving, re-open `/config` | The card shows exactly what you saved. Cross-check with `GET /admin/config` (no `x-store-id`) → `data.config.referral`. |
| 12 | Place a qualifying order for a referred user after changing the cap | The new cap applies to the **next** payout immediately — no deploy, no restart. The config cache key `CACHE_APP_CONFIG` is busted on save. |

❌ **Must not happen**
- The card showing blank/empty boxes on a system where payouts are really capped at ₹500.
- Saving the form with one field untouched wiping the other field to `null` (= silently uncapping).
- A non-super-admin seeing or being able to submit the card.

Admin-side automated coverage:
`cd haper-admin && npx vitest run src/pages/Config/ConfigSettings.referral.test.tsx`

---

## Addendum (2026-09-12) — `GET /admin/config` returns **effective** referral values

**Why this matters in one line:** the admin card must display the limits money is actually paid
under, not whatever happens to be stored in the `configs` document.

The live `APP_CONFIG` document has **no `referral` key at all** until a super admin saves one. The
payout path has always handled that (`order.handler.js` → `readReferralLimits` falls back to
`referral.constant.js`: `DEFAULT_MONTHLY_CAP_RUPEES: 500`, `DEFAULT_EARNING_WINDOW_MONTHS: 6`), so
the real live behaviour today is ₹500/month and a 6-month window. `GET /admin/config` returned the
config document, so the card was at the mercy of what that document happened to contain — and if it
had shown blanks, an admin editing just one field and saving would have posted `null` back for the
other and silently turned the real ₹500 cap into "uncapped". A money control changed by accident,
with nothing in the UI warning anyone.

What changed (backend, `packages/admin/src/routes/config/controller.js`):

- `GET /admin/config` (global scope only, no `x-store-id`) now resolves the `referral` block through
  `referralUtils.resolveReferralLimits` — **the same function the payout path uses**, extracted to
  `packages/shared/utils/referral.utils.js` so the fallback rule exists in exactly one place.
- The rule: **absent/undefined/non-numeric → the constant (500 / 6); explicit `null` stays `null`**
  (null is a real setting: uncapped / no window); an explicit number, **including 0**, stays as-is.
- It reads the **lean** copy of the document to decide what is really stored. Worth knowing:
  `configs.schema.js` declares its *own* `default: 500` / `default: 6` on the nested `referral`
  path, and mongoose applies those when hydrating a document that lacks the key — so the endpoint
  happened to emit 500/6 already, from a **second, duplicated copy of the numbers**. Change
  `referral.constant.js` to 300 and the payout would use 300 while the admin card still showed 500.
  Resolving against the constants closes that drift.
- **Response shaping only.** Nothing is written: the `configs` document still has no `referral` key
  after any number of GETs, until a real admin save writes one. Covered by a test that asserts the
  raw stored sub-document is untouched.

Backend automated coverage for this addendum:
`cd packages/admin && NODE_ENV=test npx jest config` — no `referral` key → 500/6; explicit
`{ monthlyCapRupees: null, earningWindowMonths: 3 }` → preserved exactly; only `monthlyCapRupees:
300` stored → `300` + default `6`; the GET does not persist the defaults; the response follows the
constants rather than the schema defaults; plus direct unit tests for `resolveReferralLimits`.
`cd packages/user && NODE_ENV=test npx jest referral-cap-window` must stay green — the payout path
now calls the shared helper and its behaviour is unchanged.
