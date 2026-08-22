# Test: Referral code at signup

**Area:** User app phone-based signup flow (new-user account creation)  
**Android:** `haper-android/app/src/main/java/com/bheldi/ui/screens/auth/LoginScreen.kt`,
`AuthViewModel.kt` — optional `referrerCode` field at the name-entry step (new users only)  
**Backend:** `POST /user/account/create` already supports optional `referrerCode` field (no changes needed)  
**Platform coverage:**
- ✅ **Android:** referral code field ON signup screen with whitespace-safety fix (shipped)
- ✅ **iOS:** same feature built with whitespace-safety fix (shipped)
- ✅ **Web:** referral code field at signup with new validation/trim logic to fix whitespace-only bug (shipped)

**Verified:** `./gradlew clean testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL, 249 tests all passing
(AuthViewModelTest +1 new test). Code review: APPROVE WITH NITS (2 hardening suggestions applied).

---

## What this is (the real flow)

**Previously:** mobile users (Android/iOS) could NOT enter a referral code during signup — it only existed later, buried in Edit Profile, and applied ONLY ONCE ever (immutable after first use). This meant many users lost the chance to apply a code entirely.

**Now on Android:** brand-new users see an optional **"Add code"** field directly on the phone-signup screen, right below the name field. The field accepts uppercase alphanumeric codes (4–16 characters, auto-uppercased as you type). Leaving it blank never blocks "Send OTP" — signup proceeds normally and the referral is simply not applied. If the code is invalid (too short, non-alphanumeric), an inline error blocks the button until fixed or cleared.

The referral code (if entered) is sent to the backend **only during account creation** — never on a returning user's login. The backend applies it server-side for brand-new accounts only (same immutability as the Edit Profile field).

---

## Prerequisites (read once)

1. **Android dev environment:** `haper-android` checked out with the referral-code signup commit.
2. **Test account setup:** a phone number you can use for signup (receive OTP manually or skip in testing).
3. **Verification method:** admin DB access or API call (`GET /user/profile` after signup) to confirm
   `referredBy` is set on the new account.

---

## Manual test steps (dev, Android)

### ✅ A. New user signup with valid referral code — code is applied
1. **Start fresh:** open the app and tap "Sign Up" (or clear app data to start a new session if already
   logged in).
2. **Enter a valid referral code:** on the signup screen you see:
   - Name field (existing)
   - **NEW:** "Add code" field (with a People icon) below the name
   - "Send OTP" button

   **Fill in:** Name (any text), then in the "Add code" field type a valid code like `ABC123` (auto-uppercased to `ABC123` as you type). The field accepts **uppercase alphanumeric, 4–16 characters**.
3. **Tap "Send OTP."**
   - ✅ **Expect:** OTP is sent (or simulation succeeds). The referral code is **included** in the backend
     request to `POST /user/account/create` as `referrerCode: "ABC123"`.
4. **Verify via admin or API:**
   - Admin DB: query the new account and confirm `referredBy: "ABC123"` is set.
   - **OR** API: call `GET /user/profile` with the new account's session → `referredBy: "ABC123"` in response.

### ✅ B. New user signup with blank referral code — signup proceeds, no field sent
1. **Start fresh** on the signup screen.
2. **Leave "Add code" blank:** enter a Name (any text), **do not touch the referral field** (or clear it
   completely).
3. **Tap "Send OTP."**
   - ✅ **Expect:** OTP is sent (or simulation succeeds). Signup proceeds normally. The backend request
     **omits the `referrerCode` field entirely** (not sent as an empty string, not sent as `""`).
4. **Verify via admin or API:**
   - Admin DB: query the new account and confirm `referredBy` is either **absent** or `null`.
   - **OR** API: call `GET /user/profile` → `referredBy` is **absent** or `null`.

> **Regression requirement (critical):** a blank referral code **must never block signup**. This is the
> most important behavior to protect, since a bug here would block legitimate new-user signups entirely.

### ✅ C. New user signup with invalid-format code — inline error, Send OTP blocked
1. **Start fresh** on the signup screen.
2. **Enter an invalid code:**
   - Type a code that is **too short:** `AB` (needs 4+).
   - **Expect:** an **inline error** appears below (or near) the field: **"Code must be 4-16 characters"**
     (or similar). The "Send OTP" button is **disabled**.
3. **Type a code that is **too long:** `ABCDEFGHIJKLMNOPQRSTUVWXYZ` (more than 16).
   - **Expect:** the inline error updates: **"Code must be 4-16 characters."** Button still disabled.
4. **Type a non-alphanumeric code:** `ABC-123` (contains a dash).
   - **Expect:** the inline error updates: **"Code must contain only letters and numbers."** (or similar).
     Button still disabled.
5. **Clear the field or fix the code:**
   - Delete the invalid text or type a valid code (`VALID1234`).
   - **Expect:** the error clears, and the "Send OTP" button **re-enables**.
6. **Tap "Send OTP."** — it now succeeds.

### ✅ D. Returning user login — referral field never appears
1. **Log out** (or open the app as a user with an existing account).
2. **Go through the login flow:** enter phone → tap "Send OTP" → enter OTP.
3. **Expect:** the "Add code" field is **never shown** on the login screen. Only the phone + OTP steps
   appear. (The referral code is signup-only; returning users cannot change it after the account is
   created — immutable, same as the Edit Profile field after first use.)

### ✅ E. Edge case — whitespace-only input must not block signup
1. **Start fresh** on the signup screen.
2. **Enter whitespace-only input:** type **spaces** or **tabs** into the "Add code" field (e.g.,
   `"   "`).
3. **Tap "Send OTP."**
   - ✅ **Expect:** the app **trims the field** (removes leading/trailing whitespace). After trim, if
     the field is empty, it is treated as **blank** (regression check from section B).
   - ✅ **Expect:** OTP is sent. Signup proceeds. The referral code is **not sent** to the backend
     (because it trimmed to empty).
   - ✅ **Expect:** no error is raised; signup does not block.

> **Background:** this edge case was identified in code review as a hardening point — a whitespace-only
> field was explicitly handled to ensure it never blocks signup, since that would be worse than the
> original missing-feature gap.

---

## Manual test steps (dev, Web)

**What was fixed:** The Web signup form had a referral code field but **no trim or format validation** — worse than the mobile bug. JavaScript truthiness treats whitespace-only strings as "present", so a stray space (`" "`, `"\n"`) could be sent to the backend, which returns 404 for unresolvable codes, causing the **entire signup call to fail** (not just the referral part).

**Fix applied:** New shared `utils/validation.ts` (exact rule: trim, uppercase, empty-after-trim = valid/optional, else match `^[A-Z0-9]{4,16}$`), wired into `pages/Signup.tsx` (blocks submit only on genuine format error, never on blank), and defensive trim in `services/api.ts`'s `verifyOtp` and `googleVerifyPhone`.

**Area:** `haper-web/pages/Signup.tsx`, `services/api.ts`, `utils/validation.ts` — email/phone-based signup flow (new-user account creation)

### ✅ A. New user signup with blank referral code — signup proceeds, no field sent
1. **Open the Web signup page** (e.g., `http://localhost:3000/signup` or `http://dapi.haper.in/signup` on dev).
2. **Leave referral code blank:** enter Email/Phone and Password, **do not touch the referral code field** (or clear it completely).
3. **Click "Sign Up."**
   - ✅ **Expect:** signup succeeds normally. The referral code field is **not sent** to the backend (omitted entirely, not sent as `""`).
4. **Verify via API:**
   - Call `GET /user/profile` with the new account's session → `referredBy` is **absent** or `null`.

### ✅ B. New user signup with whitespace-only referral code — signup proceeds, field trimmed and omitted
1. **Open the Web signup page.**
2. **Enter whitespace-only input:** in the referral code field, paste or type **leading/trailing spaces** (e.g., `"   "` or `" ABC123 "` with extra spaces).
3. **Click "Sign Up."**
   - ✅ **Expect:** the form **trims the field** automatically (client-side validation in `Signup.tsx`). After trim, if empty, it is treated as blank (no field sent to backend).
   - ✅ **Expect:** signup succeeds. The referral code is **not sent** to the backend.
   - ✅ **Expect:** no error is raised; signup does not block.

> **Background:** this was a critical gap before the fix. A user copying a code from a message with stray whitespace would fail the entire signup. The fix ensures whitespace is always trimmed before validation, then checked against the format rule.

### ✅ C. New user signup with valid referral code — code is applied
1. **Open the Web signup page.**
2. **Enter a valid referral code:** fill in the form and in the referral code field type a valid code like `ABC123` (or `abc123` — it auto-uppercases per the validation rule).
3. **Click "Sign Up."**
   - ✅ **Expect:** signup succeeds. The referral code is **included** in the backend request as `referrerCode: "ABC123"`.
4. **Verify via API:**
   - Call `GET /user/profile` with the new account's session → `referredBy: "ABC123"` is set.

### ✅ D. New user signup with invalid-format referral code — inline error on blur, submit blocked
1. **Open the Web signup page.**
2. **Enter an invalid code:**
   - Type a code that is **too short:** `AB` (needs 4+).
   - **Click elsewhere or blur the field.**
   - ✅ **Expect:** an **inline error** appears below the field: **"Code must be 4-16 characters"** (or similar). The "Sign Up" button is **disabled**.
3. **Type a code that is **too long:** `ABCDEFGHIJKLMNOPQRSTUVWXYZ` (more than 16).
   - **Blur the field.**
   - ✅ **Expect:** the inline error updates: **"Code must be 4-16 characters."** Button still disabled.
4. **Type a non-alphanumeric code:** `ABC-123` (contains a dash).
   - **Blur the field.**
   - ✅ **Expect:** the inline error updates: **"Code must contain only letters and numbers."** (or similar). Button still disabled.
5. **Clear the field or fix the code:**
   - Delete the invalid text or type a valid code.
   - **Blur the field.**
   - ✅ **Expect:** the error clears, and the "Sign Up" button **re-enables**.
6. **Click "Sign Up."** — it now succeeds.

### Known follow-up (not part of this fix, low-risk)
`services/api.ts`'s `googleVerifyPhone()` function has a `referrerCode` parameter in its signature, but **nothing currently calls it with a value** — Google-linked signups on Web cannot apply a referral code today. This is a **pre-existing gap** (not introduced by this fix). A future phase should wire the referral field to the Google sign-in path. For now, Google signups are unaffected.

---

## Client behavior (old app backward-compatibility)

**Old Android builds** (before this commit) have **no change** — they don't know the field exists.
The "Add code" field is **only** present on the **new** build.

### ✅ Old app places signup order as before
1. Run an **old** Android build against the signup screen.
2. **Expect:** no "Add code" field appears. The signup flow is identical to before: Name → Send OTP.
   The signup succeeds (no new field, no regression).

### ✅ Backend accepts old app signups with no referral code
Old builds send no `referrerCode` field. The backend accepts it gracefully — the field is optional on
account creation, and the new account is created with `referredBy: null`.

---

## Hardening checks (code-level)

These protections are **implemented in code** and verified by the test suite:

1. **Referral code is only ever sent when in new-user mode** — not on returning-user login. The app
   logic explicitly gates the field to the signup path only.
2. **Empty / blank / whitespace-only input never blocks signup.** A trim-and-check guard ensures that
   even if the field is accidentally filled with spaces, the validation does not error; the app treats
   it as blank and omits it from the backend request.
3. **Invalid format (length / non-alphanumeric) is caught client-side** with an inline error that
   blocks "Send OTP" until the code is fixed or cleared.

---

## Automated coverage (in-memory Jest, Android unit tests)

Run from the Android package:

```bash
cd haper-android
./gradlew testDebugUnitTest
```

**AuthViewModelTest** (+1 new test, now 10 total):
- Blank referral code never blocks signup (the critical regression test added in this pass).
- Valid code formats are accepted (4–16 alphanumeric, auto-uppercased).
- Invalid code formats are rejected with inline errors (too short, too long, non-alphanumeric).
- Whitespace-only input is trimmed to blank and treated as absent.

---

## Deploy / rollout

- **Android app release:** ship the new build with the referral code field and whitespace-safety fix to users.
- **iOS app release:** ship the new build with the referral code field and whitespace-safety fix to users.
- **Web deployment:** deploy the new `utils/validation.ts`, `Signup.tsx` changes, and defensive trim in `services/api.ts`.
- **Backend:** **no changes** — the `POST /user/account/create` endpoint already accepted optional
  `referrerCode`. The backend is ready for all three platforms.
- **Rollback (if needed):** removing the referral code field from the UI is safe; old backend logic
  treats the missing field as `null` (no migration needed).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Add code" field never appears on signup screen | Old build of the app (before this commit). Reinstall the new build. |
| Referral code is not applied to the new account | The code was invalid (too short/long, non-alphanumeric), and the app blocked signup (inline error). Fix the code format and retry. |
| Blank referral code somehow blocks signup | Bug (should not happen with this commit). Verify the trim-and-check logic is in place in `AuthViewModel.kt`. |
| Returning user sees the "Add code" field on login | Bug (should only show on signup path). Verify the field is gated to new-user mode only in `LoginScreen.kt`. |
| Backend returns an error when referral code is sent | Backend `POST /user/account/create` validation failed. Verify the code format on the server side (server is the source of truth for rules). |

---

## Notes for dev/QA

- **All three platforms now shipped:** Android and iOS have the referral code field at signup with whitespace-safety fix; Web now has validation and trim logic applied.
- **Critical regression test (all platforms):** blank or whitespace-only referral code must **never block signup**. This is the most important behavior to protect. Focus manual testing on sections A–B.
- **Validation rule is identical across platforms:** 4–16 alphanumeric characters (auto-uppercased), trim before validating, treat empty-after-trim as blank (optional).
- **No backend changes needed:** the backend endpoint already accepted `referrerCode` as optional. Deploying all three client versions is sufficient.
- **Known gap (not blocking):** Google-linked signups on Web cannot apply a referral code today (pre-existing). See the Web follow-up section for details.
