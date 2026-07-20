# Test: Push notifications stop after logout (device-token teardown)

**Area:** FCM push lifecycle on logout — user app (Android + iOS), delivery app, picker app + backend token storage.
**Apps/services:** haper-android, haper-ios, haper-delivery, haper-picker, haper-backend.
**Deploy:** the 4 client apps need an **app build/install** (TestFlight / local run / APK). The backend
change needs a **dev deploy**. Client fixes and the backend change are independent — either half helps on
its own; ship both to close it fully.

## The bug

A logged-out device kept receiving push notifications — after tapping **Log out** AND after an
**automatic** logout when the access/refresh token expired. Same gap in all 4 apps.

## Root cause (three parts, all verified in code)

1. **Send is presence-only.** The backend pushes to *every* token in the recipient's `fcmTokens`
   array (`packages/shared/utils/notification.utils.js`) with no login/session check — presence = a push.
2. **The only token-removal path was the auth-gated unregister**, and the clients called it in the
   wrong order (session/token cleared *first*), so the DELETE went out unauthenticated → 401 →
   swallowed. On the token-expiry path there was no valid token at all, so it could never succeed.
3. **Nothing cleaned up afterward:** clients never deleted the local FCM token, and the backend's
   dead-token pruning only fires on uninstall/rotation (FCM "not-registered"), never on logout.

Plus a secondary leak: user/rider/picker token **registration was not device-exclusive**, so a token
could linger on a previous account after a handoff/re-login (admins already fixed this).

## The fix (chosen approach: client `deleteToken()`, NO new backend endpoint)

**Every client (user Android/iOS, delivery, picker):**
- On logout, **delete the local FCM token** (`FirebaseMessaging.deleteToken()` / `Messaging.deleteToken`).
  This needs no auth, stops OS delivery immediately, and makes the backend prune the now-dead token on
  its next send. This is the load-bearing fix and runs on **both** logout paths.
- **Manual logout reordered:** (a) authenticated backend unregister *while the token is still present*
  → (b) `deleteToken()` → (c) *then* clear the session. Network steps are time-capped (~2–3 s) so
  logout stays snappy.
- **Auto-logout (expiry):** skip the doomed authenticated unregister; just `deleteToken()`.
- **Defense-in-depth login gate** in the foreground message handler: drop a push when logged out.
  (Can't stop background `notification`-payload pushes — the OS renders those — so `deleteToken()` is
  what covers that case.)
- iOS also fixed a pre-existing inverted `onChange(of: isLoggedIn)` (it bound the OLD value), which had
  meant fresh logins didn't register for push until next launch and manual logout left PII in memory.

**Backend:** token **register is now device-exclusive** — registering a token purges it from every
OTHER user/rider/picker first (mirrors `registerAdminToken`). Fixes the shared-device / re-login leak.
No new endpoint; the existing unregister + prune paths are unchanged.

## Files changed

- **backend:** `packages/shared/utils/notification.utils.js` (registerToken, registerRiderToken exclusivity),
  `packages/shared/repositories/pickers.repository.js` (+`purgeFcmTokenFromOthers`),
  `packages/picking/src/routes/profile/controller.js` (call it), `packages/user/__tests__/profile.test.js` (test).
- **user-android:** PushNotificationManager.kt, AuthViewModel.kt, HaperFirebaseMessagingService.kt.
- **user-ios:** NotificationManager.swift, AuthViewModel.swift, haperApp.swift.
- **delivery:** RiderFcmTokenUploader.kt, DeliveryAuthViewModel.kt, MainActivity.kt, NetworkModule.kt, RiderMessagingService.kt.
- **picker:** PushRegistrar.kt, PickerAuthViewModel.kt, NetworkModule.kt, PickerMessagingService.kt.

## Manual test steps (run per app: user Android, user iOS, delivery, picker)

### ✅ Manual logout stops pushes
1. Log in, confirm the device receives a test push (trigger an order/pick/assignment as appropriate).
2. Tap **Log out**.
3. From the server/admin, trigger another push to that same account/role.
4. ✅ The device shows **no** notification. (Optional: confirm in server logs the token is gone /
   the unregister DELETE returned 200, not 401.)

### ✅ Automatic (expired-token) logout stops pushes
1. Log in. Then force the session to expire (revoke/expire the refresh token server-side, or wait it out).
2. Use the app so it hits a 401 and auto-logs-out to the login screen.
3. Trigger a push to that account.
4. ✅ No notification arrives (the local FCM token was deleted even though no valid token existed).

### ✅ Logged-in users are unaffected (no regression)
1. Log in. ✅ Foreground and background pushes both show normally.
2. Log out then log back in (same app session). ✅ Pushes resume (token re-registers on login).

### ✅ Snappy logout on bad network
1. Turn on airplane mode, tap Log out. ✅ Reaches the login screen within ~2–3 s (time-capped), not hung.

### ✅ Shared-device / re-login exclusivity (backend)
1. On one physical device: log in as user A, then log out, then log in as user B (or hand the device over).
2. Trigger a push intended for user A.
3. ✅ The device (now user B) does NOT receive user A's notification, and vice-versa — the token belongs
   only to whoever is currently logged in.
- Backend unit test covering this: `packages/user/__tests__/profile.test.js` →
  "registerToken registers the token EXCLUSIVELY". Run: `cd packages/user && NODE_ENV=test npx jest profile`.

## ❌ Known limitations / notes
- If `deleteToken()` fails because the device is fully offline at logout, the OS token stays live until
  the app next runs `deleteToken()` or the backend prunes it on a failed send. Accepted tradeoff of the
  "client deleteToken, no new endpoint" approach.
- The backend still has no dedicated logout endpoint; dead tokens are removed by the existing prune on
  next send. That's by design for this fix.

## Verification done
- backend: `packages/user` jest **32 passed** (incl. new exclusivity test), `packages/picking` jest **48 passed** (in-memory Mongo).
- user-android / delivery / picker: `./gradlew assembleDebug` → BUILD SUCCESSFUL.
- user-ios: `swiftlint --strict` clean + `xcodebuild ... build` → BUILD SUCCEEDED.
