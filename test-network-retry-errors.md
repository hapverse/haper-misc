# Test: Transient network retry + friendly error messages (Android)

**Area:** Android user app → every API call (network layer), most visible on Login / OTP
**Apps:** Android (iOS unchanged — see "Cross-platform" below)
**Added:** 2026-08-22

## What the change is

Two things, both in the network layer, no business logic touched:

1. **Retry**: a request that fails *before it ever reaches the server* (phone couldn't
   resolve `v1.api.haper.in`, or the TCP connect failed) is now retried automatically —
   up to 2 extra attempts, waiting 500 ms then 1000 ms.
2. **Friendly message**: if the retries still fail, the user sees
   **"Check your internet connection and try again"** instead of the raw technical text.

### The bug this fixes

A real user screenshot showed this on the login screen, word for word:

> Unable to resolve host 'v1.api.haper.in': No address associated with hostname

The DNS record itself is fine (checked in Route 53). It was an occasional hiccup on the
user's mobile network. Before this change the app gave up on the very first hiccup and
printed the developer text. Now it quietly tries again and usually succeeds.

### Which requests get retried (the safety rule)

| Failure | GET | POST / PUT / PATCH / DELETE |
|---|---|---|
| DNS could not resolve the host | ✅ retry | ✅ retry |
| Connection refused / unreachable | ✅ retry | ✅ retry |
| Timeout | ✅ retry | ❌ **never retried** |
| Server answered with 4xx/5xx | ❌ no retry | ❌ no retry |

**Why POST is not retried on a timeout:** a timeout can mean "the server already did the
work but the reply got lost". Sending it again could place the **same order twice** or
send **two OTP SMSes**. DNS/connect failures are different — nothing left the phone, so
resending is provably safe.

## How to test

### ✅ 1. Login recovers from a DNS blip
1. Turn wifi/data off, open the app, go to the login screen, enter a phone number, tap
   Continue **and turn data back on within ~1 second**.
2. Expected: the OTP is requested successfully (the retry caught it). Slight delay is normal.

### ✅ 2. Truly offline shows the friendly message
1. Airplane mode ON. Login screen → enter a phone number → Continue.
2. Expected error text: **"Check your internet connection and try again"**.
3. ❌ Fail if you see any hostname, "Unable to resolve host", "Failed to connect to
   /x.x.x.x:443", or a class name.

### ✅ 3. No duplicate OTP SMS
1. On a weak/flaky network, request an OTP repeatedly.
2. Expected: never two SMSes for one tap. (A retry only happens when nothing reached the
   server.)

### ✅ 4. No duplicate orders
1. Place an order on a very slow network so the request times out.
2. Expected: the order is placed **at most once**. Check the admin order list — exactly
   one order, never two identical ones seconds apart.

### ✅ 5. Server errors still show the server's message
1. Trigger a normal API error (e.g. wrong OTP).
2. Expected: the backend's own message ("Invalid OTP"), NOT "Check your internet
   connection". Retry must not kick in here.

### ✅ 6. Other screens got the same treatment
Offline, check that Cart, Wallet, Orders, Addresses, Profile, Notification settings all
show the friendly message instead of raw exception text.

### ✅ 7. Not signed out by a blip
1. With an expired access token, cause a DNS blip during the silent token refresh.
2. Expected: the refresh retries once and the user stays logged in.
3. On a *dead* network the refresh must give up within ~12 seconds (it holds a global
   lock while it runs). It must not sit there for 20+ seconds freezing every other call.

### ✅ 8. Invoice download still works (redirect path)
The app no longer follows HTTP redirects on its main connection — that is what makes the
retry safe. The invoice endpoint is the one place that *needs* a redirect (it bounces to a
temporary S3 link), so it now uses its own separate connection.
1. Open a **delivered** order → "Download Invoice". Expect the PDF to open.
2. Tap it a **second** time (the first download makes the backend cache the PDF, and the
   cached path is the one that redirects). Expect the PDF to open again — this is the
   case that would break if the separate client were wired wrong.
3. On a flaky network, a failed invoice download shows "Check your internet connection"
   and can simply be tapped again (this one call is deliberately not auto-retried).

### ✅ 9. No duplicate order from a redirect (developer check)
Covered automatically by `NetworkModuleClientConfigTest`. Not manually testable today —
no POST endpoint on the backend redirects. If one is ever added, the test suite is what
stops it from silently becoming a double-order bug.

## Edge cases / known limits

- The whole call has a hard 20-second ceiling (`callTimeout`). Retries live inside that
  budget. DNS failures fail almost instantly, so 3 attempts fit easily; a *timeout*-driven
  GET retry can hit the ceiling and surface "The connection is taking too long. Please try
  again." That is still a friendly message — acceptable.
- A cancelled request (user leaves the screen) is never retried.
- Anything that is not a transport failure (e.g. malformed JSON) keeps its previous
  message — we don't want to blame the user's wifi for a backend bug.
- **Behaviour change:** ~14 places (order actions, all 6 address actions, 2 profile
  actions) used to show *nothing* when a failure carried no message text — the error
  dialog was skipped entirely and the action just appeared to do nothing. They now always
  show at least "Something went wrong. Please try again." Expect an error dialog in some
  rare cases where the screen previously stayed silent. This is intended.
- Redirects are OFF app-wide except for the invoice download. If a future backend endpoint
  starts answering the app with a 301/302, the app will show it as an error instead of
  following it — that endpoint must be routed through its own client, like invoices.

## Cross-platform

Android only. iOS has the same class of problem but a separate networking stack — needs a
matching change there (flag to setu-ios). No backend change, no API change, no deploy
needed: this ships in the next Android build.

## Automated coverage

`ConnectionRetryInterceptorTest` (retry/no-retry matrix, backoff, cancellation, a real
OkHttp client recovering from an injected DNS failure), `NetworkModuleClientConfigTest`
(redirects off + retry interceptor position + refresh-client timeout budget, plus a real
MockWebServer probe proving a POST answered with a 302 to a dead host is delivered exactly
once — and a counter-example showing it would be delivered 3 times with redirects on),
`NetworkErrorMessagesTest` (message mapping incl. EOF / http2 stream reset),
`AuthViewModelTest` (login/OTP show the friendly text), `OrderViewModelTest`
(a message-less exception now produces a visible error).
Run: `./gradlew testDebugUnitTest` in `haper-android` — 279 tests, all green.
