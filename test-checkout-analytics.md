# Test: `checkout_error` — attributing checkout funnel drops

**Area:** Checkout funnel analytics (Firebase Analytics / GA4) — Android + iOS + web.
**Why:** the funnel tracked only *attempts* (`begin_checkout` → `add_payment_info` →
`place_order_attempt` → `purchase`) with no failure event. A payment timeout or an API error
is a *handled* error — invisible to both the funnel AND Crashlytics — so a 60–80% checkout
drop could be seen but not diagnosed. This one event makes the cause queryable.

## The event
`checkout_error` — fired on every failed checkout attempt. Params (IDENTICAL across all three
platforms so the funnel unifies):

| Param | Values |
|---|---|
| `step` | `address` · `payment_init` · `payment` · `place_order` |
| `error_type` | `network_timeout` · `api_error` · `validation` · `payment_declined` · `payment_cancelled` · `not_serviceable` |
| `error_code` | HTTP status / exception name / Razorpay code (or `""`) |
| `message` | error text, trimmed to **100 chars** (GA drops longer params) |
| `payment_method` | e.g. `RAZORPAY`, `WALLET` (or `""`) |
| `value` | payable amount (or `0`) · `currency` = `INR` |

Key split: **`payment_cancelled`** (user dismissed the sheet — "changed their mind") vs
**`payment_declined`** (real gateway/card failure). And **`not_serviceable`** = the order-time
delivery-area block, surfaced as its own bucket.

## Where it fires (per platform)
- **Android** (`6dee982`): `AnalyticsTracker.trackCheckoutError` + `CheckoutStep`/`CheckoutError`
  constants. Call sites: `OrderViewModel.placeOrder` (non-2xx → not_serviceable/api_error by
  message + HTTP code; catch → network_timeout for `SocketTimeoutException` else api_error);
  `CheckoutScreen` (Razorpay fail → cancelled/declined by "cancel" in message; payment_init
  missing session / no activity).
- **iOS** (`4bb5c17`): `AnalyticsManager.trackCheckoutError`. `OrderViewModel.placeOrder`
  (`.httpError` statusCode → not_serviceable/api_error; no-status → network_timeout for
  `URLError.timedOut` else api_error); `CheckoutView.placeOrderTapped` (Razorpay
  cancelled/declined; payment_init missing session). NOTE: no `validation`/"no activity" case
  (iOS resolves the payment presenter internally); `address` step not fired (matches Android).
- **Web** (`aa75338`): `trackEvent('checkout_error', …)` gtag helper + `CheckoutStep`/`CheckoutError`.
  All in `pages/Checkout.tsx`: address guard → address/validation; empty-cart → place_order/
  validation; missing rzpOrder → payment_init/api_error; place-order catch → not_serviceable/
  api_error (HTTP status) or network_timeout (status-less fetch reject); Razorpay `payment.failed`
  → cancelled/declined by code; `modal.ondismiss` → payment_cancelled (guarded against
  double-count after success/failure).

## How to verify — Firebase **DebugView** (not a tap-through)
Analytics is validated in DebugView, per device:
- **Android:** `adb shell setprop debug.firebase.analytics.app com.bheldi` → open the app.
- **iOS:** run the app with launch arg `-FIRDebugEnabled`.
- **Web:** GA4 DebugView via the GA Debugger extension, or `?debug_mode=1`.
Then in Firebase console → **DebugView**, force each failure and confirm `checkout_error` shows
with the right `step` + `error_type` + `error_code`:

### ✅ Cases to force
1. **Payment declined** — use a Razorpay test card that fails → `payment` / `payment_declined`.
2. **Payment cancelled** — open the Razorpay sheet and close it → `payment` / `payment_cancelled`.
3. **Not serviceable** — (needs `ENFORCE_ADDRESS_SERVICEABILITY=true` on backend) place an order
   to an out-of-area address → `place_order` / `not_serviceable`.
4. **API error** — kill/500 the place-order endpoint → `place_order` / `api_error` + `error_code`.
5. **Timeout / network** — airplane mode mid-place-order → `place_order` / `network_timeout`
   (Android/iOS distinguish a true timeout; **web can't** — see caveats).

## Known caveats
- **Web has no true timeout signal:** the fetch wrapper has no `AbortController`, so all
  status-less network failures are bucketed as `network_timeout` (closest match). Android/iOS
  distinguish an actual timeout.
- **cancel-vs-decline** on payment relies on the gateway error string containing "cancel";
  exact Razorpay payloads weren't exercised live. Pure sheet-close is covered independently
  (web `modal.ondismiss`).
- iOS/web builds are **compile/typecheck-verified only**, not click-through verified — do one
  DebugView pass per platform.

## Analysis (to actually use this)
The events land in Firebase, but the version-comparison + auto-alerting the original feedback
wanted come from **BigQuery export → Looker Studio**:
- Enable the free Firebase → BigQuery Analytics export.
- Chart `checkout_error` by `error_type` × `step`, segmented by `app_version` (already collected
  automatically) — the side-by-side view GA's default dashboards can't do.
- Alerting: try Firebase/GA4 **built-in anomaly detection** on the purchase conversion first;
  build custom BigQuery + Cloud Monitoring alerts only if that's not enough.

## Rollout
- Android: ship the updated build. iOS: ship. Web (`aa75338`): deploys with the next web deploy.
- No backend change needed for the event itself. (`not_serviceable` only fires at volume once
  `ENFORCE_ADDRESS_SERVICEABILITY=true`; until then it's rare/absent — expected.)
