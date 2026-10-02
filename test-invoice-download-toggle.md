# Test: Invoice Download Toggle (per-store admin control)

**Area:** Admin store configuration + customer-facing order details screens  
**Admin UI:** `haper-admin/src/pages/Config/ConfigSettings.tsx` — Store Controls > "Download Invoice" toggle (per-store setting, saved via store-config update endpoint)  
**Backend:** `haper-backend/packages/admin/src/routes/config` (admin write), `packages/user/src/routes/config` (customer-facing `GET /config`, keyed by `x-store-id` header). Includes short-TTL cache layer (5-minute TTL cap; admin writes update cache immediately on save).  
**Platform coverage:**
- ✅ **Android:** Order Details screen Download Invoice button + Orders list quick-download action (both gated after bug fix in review)
- ✅ **iOS:** Order Details screen Download Invoice button
- ✅ **Web:** Order Details page Download Invoice button

**Status:** Feature uncommitted across haper-backend, haper-admin, haper-android, haper-ios, haper-web. Backend + admin deploy required before toggle takes effect. App-store / build releases needed for client-side gating (until then, old app installs always show the button, which is safe/backward-compatible).

---

## What this is (the real flow)

**Previously:** the "Download Invoice" button was always visible and functional for all customers on closed/delivered orders, regardless of store policy. There was no admin control per store.

**Now:** store admins can toggle a boolean flag `invoiceDownloadEnabled` (default **true**, so nothing changes for anyone unless explicitly disabled). When set to **false** for a specific store, the "Download Invoice" button is hidden from that store's customers on all platforms — Android (both Order Details and the Orders list quick-download), iOS (Order Details), and Web (Order Details page).

The flag is **per-store**, not global. One store can have downloads enabled while another has them disabled. Toggling takes effect within a few minutes (admin write-through updates cache immediately on save, plus a 5-minute TTL cap, so visible on next config fetch and worst case self-corrects within 5 minutes).

---

## Prerequisites (read once)

1. **Admin environment:** access to `damin.haper.in` (or local admin dev build).
2. **Customer app:** Haper Android, iOS, or Web — recent build (or old build for backward-compatibility testing).
3. **Test stores:** two different stores set up with orders in closed/delivered state. If only one store, use it for toggling and verify that a second store (if any) remains unaffected.
4. **Orders:** test orders that are **closed** or **delivered** status (the existing status gate still applies — unshipped orders never show the button regardless of this flag).

---

## Manual test steps (Admin)

### ✅ A. Admin toggles invoice download OFF for a store — setting is saved

1. Log in to **haper-admin** (`damin.haper.in`).
2. Navigate to **Config** (or **Settings**) → **Store Controls** (or similar config section).
3. Find the store you want to test (or create/select a test store).
4. Locate the **"Download Invoice"** toggle (should default to **ON/enabled** if not yet touched).
5. **Toggle it to OFF** (disabled).
6. **Click Save** (or apply changes).
7. **Expected:** the save succeeds (no error toast). The toggle now shows OFF.
8. **Verify backend write:** call the store-config endpoint (via API client or browser DevTools) to confirm `invoiceDownloadEnabled: false` is set for that store.

### ✅ B. Admin toggles invoice download back ON for the same store — setting updates

1. In the same Config screen, toggle the "Download Invoice" setting back **to ON** (enabled).
2. **Click Save.**
3. **Expected:** the save succeeds. The toggle now shows ON.
4. **Verify backend write:** confirm `invoiceDownloadEnabled: true` is now set.

### ✅ C. A different store is unaffected — setting is per-store, not global

1. In the same admin Config screen, **switch to a different store** (via a store selector, if present).
2. Check the "Download Invoice" toggle for that second store.
3. **Expected:** the toggle shows its own independent state (e.g., still ON/default if you only toggled the first store OFF). Changes to one store's setting do not affect others.

---

## Manual test steps (Android)

### ✅ A. Default state — Download Invoice button is visible and works

1. Open the Haper Android app (a recent build with this feature, or an old build).
2. **Log in as a customer** for a store where the toggle is ON (or default/not yet set — defaults to ON).
3. **Navigate to Orders** → **Open a closed/delivered order** (status is "Delivered" or "Closed").
4. **Expect:** the "Download Invoice" button is **visible** on the Order Details screen.
5. **Tap the button.**
   - **Expected:** the invoice PDF downloads and opens (or the download completes), or a preview appears.
   - **Note:** if the invoice backend is not live yet, a network error is OK for this pass; focus on whether the button is shown.

### ✅ B. Admin toggles Download Invoice OFF — button disappears for that store's customers (Order Details screen)

1. **Admin:** toggle the store's "Download Invoice" setting to OFF (from A-B above). Wait a few minutes for cache coherence (short TTL).
2. **Customer app:** close and reopen the app (or refresh the Order Details page) to clear any local caching.
3. **On the same closed/delivered order:**
   - **Expected:** the "Download Invoice" button is **no longer visible** on the Order Details screen.
   - **Regression check:** all other order details (items, total, delivery address) are still present and correct.

### ✅ C. Admin toggles Download Invoice back ON — button reappears (Order Details screen)

1. **Admin:** toggle the setting back to ON. Wait a few minutes for cache coherence.
2. **Customer app:** close and reopen (or refresh).
3. **On the same order:**
   - **Expected:** the "Download Invoice" button is **visible again**.

### ✅ D. Android: Orders list inline Invoice button is gated (Android-specific bug fix)

A bug was caught in review where only the Order Details screen's button was gated, but the Orders **list** screen had an inline "Invoice" text button that was **not** gated. This test verifies both are now covered.

1. **Toggle the store's setting to OFF** (from the admin). Wait for cache coherence.
2. **Customer app:** on the **Orders list** screen, find a closed/delivered order.
3. **On the order's card, verify the inline "Invoice" text button** (positioned next to the price and before "Track") is **absent**.
   - **Expected:** the "Invoice" button is **not shown** on any closed order's card when the toggle is OFF.
   - **Regression check:** "Track" on active orders is unaffected.

### ✅ E. Order status gate still applies — unshipped orders never show Download Invoice

1. **Toggle the store's setting back to ON** (so the invoice feature is enabled for this store).
2. **Customer app:** find an order that is **NOT closed/delivered** (e.g., status is "Confirmed", "Preparing", "In Transit", etc.).
3. **Open Order Details.**
   - **Expected:** the "Download Invoice" button is **not shown**, even though the toggle is ON. The existing status gate (only show on closed/delivered) takes precedence.

---

## Manual test steps (iOS)

### ✅ A. Default state — Download Invoice button is visible

1. Open the Haper iOS app (a recent build with this feature, or an old build).
2. **Log in as a customer** for a store where the toggle is ON (or default).
3. **Navigate to Orders** → **Open a closed/delivered order**.
4. **Expect:** the "Download Invoice" button is **visible** on the Order Details screen.

### ✅ B. Admin toggles Download Invoice OFF — button disappears (iOS Order Details)

1. **Admin:** toggle the store's "Download Invoice" setting to OFF. Wait a few minutes.
2. **iOS app:** close and reopen (or refresh the Order Details screen).
3. **Expect:** the "Download Invoice" button is **no longer visible**.

### ✅ C. Admin toggles Download Invoice back ON — button reappears (iOS Order Details)

1. **Admin:** toggle the setting back to ON. Wait a few minutes.
2. **iOS app:** close and reopen.
3. **Expect:** the "Download Invoice" button is **visible again**.

---

## Manual test steps (Web)

### ✅ A. Default state — Download Invoice button is visible

1. Open Haper Web (e.g., `dapi.haper.in` or localhost dev build). A recent build with this feature.
2. **Log in as a customer** for a store where the toggle is ON (or default).
3. **Navigate to Orders** → **Open a closed/delivered order**.
4. **Expect:** the "Download Invoice" button (or link) is **visible** on the Order Details page.

### ✅ B. Admin toggles Download Invoice OFF — button disappears (Web Order Details)

1. **Admin:** toggle the store's "Download Invoice" setting to OFF. Wait a few minutes.
2. **Web:** navigate away from the order page and back (or hard-refresh the page) to clear caching.
3. **On the same order:**
   - **Expected:** the "Download Invoice" button is **no longer visible** on the Order Details page.

### ✅ C. Admin toggles Download Invoice back ON — button reappears (Web Order Details)

1. **Admin:** toggle the setting back to ON. Wait a few minutes.
2. **Web:** navigate away and back (or hard-refresh).
3. **Expect:** the "Download Invoice" button is **visible again**.

---

## Edge cases

| Case | Expected |
|---|---|
| Store toggle is ON, order status is NOT closed/delivered (e.g., "Confirmed", "In Transit") | Invoice button never shows — existing status gate still applies. The toggle only affects closed/delivered orders. |
| Store toggle is OFF, but customer has an old cached app build (before this feature) | Old build does not know about the toggle; it always shows the button. This is safe/backward-compatible — the feature is client-side gating only. Once the new app build is installed, the button will respect the toggle. |
| Store toggle is switched while customer has the order page open | On older/slow networks, the cached config may not refresh immediately. Closing and reopening the order page will pick up the latest config (within the cache TTL, now a few minutes at most). |
| Two stores with different invoice settings | Each store's toggle is independent. A customer can see the button for Store A's orders but not Store B's (if Store B has the toggle OFF). |
| Admin saves the toggle but forgets to deploy the backend | The admin UI saves the setting, but the customer-facing config endpoint (`GET /config`) will not return the new flag. Customers will behave as if the flag is ON (fail-safe default) until the backend is deployed. |

---

## Client behavior (old app backward-compatibility)

**Old app builds** (before this feature) do not know about the `invoiceDownloadEnabled` flag. They always show the "Download Invoice" button on closed/delivered orders, regardless of the store admin's toggle setting.

### ✅ Old app always shows Download Invoice button (safe default)

1. **Admin:** toggle the store's setting to OFF.
2. **Old app build:** open an order on that store.
3. **Expect:** the "Download Invoice" button is **still shown** (old build does not know the flag exists).
4. **Regression:** this is expected and safe. Once users upgrade to the new build, the button will respect the toggle.

---

## Hardening checks (code-level)

These protections are implemented in code:

1. **Flag defaults to true.** If the flag is missing or null in the store config, the button shows by default (fail-safe, backward-compatible).
2. **The toggle is per-store, not global.** Each store has its own independent `invoiceDownloadEnabled` setting.
3. **Existing order status gate is not bypassed.** The button never shows on non-closed/non-delivered orders, even if the toggle is ON. Both gates must be satisfied.
4. **Cache coherence window is defined.** The short-TTL cache ensures that changes propagate within a few minutes. Parallel work is reducing the window further; this guide documents the current behavior.

---

## Deploy / rollout

### What needs to deploy

1. **Backend (`haper-backend`):**
   - `packages/admin/src/routes/config` — add the write handler for `invoiceDownloadEnabled` on the store-config update endpoint.
   - `packages/user/src/routes/config` — add the read of `invoiceDownloadEnabled` to the `GET /config` response (keyed by `x-store-id`). Include short-TTL cache.
   - **Redeploy required** to activate the feature on dev.

2. **Admin UI (`haper-admin`):**
   - `src/pages/Config/ConfigSettings.tsx` — add the "Download Invoice" toggle UI in the Store Controls section.
   - Wire it to the store-config update endpoint.
   - **Redeploy required.**

3. **Android app (`haper-android`):**
   - Gate the Order Details Download Invoice button and the Orders list quick-download action on the `invoiceDownloadEnabled` flag from `GET /config`.
   - **App-store release required** for new installs to pick up the feature.

4. **iOS app (`haper-ios`):**
   - Gate the Order Details Download Invoice button on the `invoiceDownloadEnabled` flag.
   - **App-store release required.**

5. **Web (`haper-web`):**
   - Gate the Order Details page Download Invoice button on the `invoiceDownloadEnabled` flag.
   - **Deployment required.**

### Rollback safety

Removing the toggle is backward-compatible:
- Old config endpoints that do not return `invoiceDownloadEnabled` default it to `true` (fail-safe).
- Old app builds always show the button (expected).
- No database migration is needed; the flag is stored in the store config document.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Admin toggles the setting but button still shows on customer app | Backend not yet deployed OR cache TTL has not expired. Wait a few minutes and try again. | Wait for cache or restart the app (clears local memory cache). |
| Button disappears on one store but not another | Each store has its own independent setting. Admin did not toggle the second store, or toggled the wrong store. | Check which store is selected in the admin Config page when toggling. |
| Old app build shows the button even though toggle is OFF | Old builds do not know about the flag. | User must upgrade to the new app build. |
| Download Invoice button never appears, even on old app | Likely a regression — the button's presence is broken on the app itself, independent of this feature. | Verify the order status is closed/delivered. Check the app build contains the Download Invoice feature. |
| Admin UI has no "Download Invoice" toggle in Store Controls | Admin UI not yet deployed. | Deploy haper-admin. |
| Backend logs show `invoiceDownloadEnabled` is undefined on customer config requests | Backend not yet deployed, or store config document does not have the field. | Deploy backend. Restart the app to refresh config. |

---

## Notes for dev/QA

- **All platforms (Android, iOS, Web) must be deployed together with backend + admin for the feature to work end-to-end.** Until they are, the toggle has no effect and the button always shows (backward-compatible).
- **Default is ON (show button).** Admin must explicitly toggle OFF to hide the button.
- **Per-store, not global.** Test with at least two stores to confirm independence.
- **Cache coherence window is "few minutes."** Admin write-through updates cache immediately on save, plus a 5-minute TTL cap, so toggles are visible on the next config fetch and worst case self-correct within 5 minutes.
- **Critical regression test:** orders that are not closed/delivered must never show the invoice button, even if the toggle is ON. The status gate must remain in place.
- **Backward-compatible:** old app builds will always show the button. No user-facing breakage when the feature rolls out; the button is gated only on new builds.
- **No DB migration.** The flag is stored in the store config document (no schema change needed).

---

## Known limitations (accepted for Phase 1)

1. **Cache TTL delay:** the admin write-through immediately updates the cache with the new value on save. A 5-minute TTL cap ensures worst-case self-correction within that window.
2. **All-or-nothing per store:** the toggle is a boolean (ON/OFF). It is not a per-customer, per-order, or per-time-window setting. If the admin toggles it OFF, all customers for that store lose the button immediately (within the cache window).
3. **Web coverage complete:** Web order details is now included in the implementation across all platforms.

