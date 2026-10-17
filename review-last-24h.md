# Review: last 24h on dev + uncommitted work (2026-10-16)

Reviewer: mayank-reviewer. Read-only. Tests run in-memory only, Node 22.18, one jest process at a time.

## Short answer

All okay. Nothing is CRITICAL, HIGH or MEDIUM. There are 7 LOW items (polish), and none of them blocks anything.
The uncommitted test-harness work and the SAC-code lock are both fine to commit.

## Tests run

| Suite | Result |
|---|---|
| admin: print-admin, order-refund-destination, events | 61/61 pass |
| user: razorpay, auth-google, auth-otp, auth-refresh, print-pricing.utils, print-upload (`--detectOpenHandles`) | 214/214 pass, no open handles |
| picking: picking-lifecycle (`--detectOpenHandles`) | 31/31 pass, no open handles |
| haper-admin vitest: RefundBox, PrintServiceCard, printServiceValidation | 14/14 pass |
| haper-admin `tsc -b`, eslint on touched files | clean |
| Out-of-tree probe: razorpay router really uses the tracked `events` handler; `start()` app gets a server bound to 127.0.0.1 | pass |

## Scope A: committed

### 0aead5c + haper-admin d1ca47a + misc af6d718: refund destination / wallet credit. OK to keep
- Money meaning is right. Every refund entry in the code is written by `refundToWallet` (shared/utils/refund.utils.js:33-95). It credits the wallet and writes the log row in the same transaction, and puts that log's `_id` in `walletLogId`. So "log row exists" does mean "wallet was credited". No code anywhere refunds to the card/UPI gateway, so `ORIGINAL_PAYMENT` cannot appear today (the helper comment says so).
- Old orders are safe: no refunds, `walletLogId: null`, or a lookup error all degrade to UNKNOWN / null and never throw. `getOrderDetailForAdminScoped` uses `.lean()`, so the object spread is safe. A missing order (null) passes straight through.
- Performance: one `_id $in` query per order-details view. No N+1 queries. The order list is not annotated.
- Permissions/PII: same route and permission as before. Only two derived fields are added; no new personal data.
- Labels match the backend `refundReason` enum exactly.

### f38e7e2 / f470392: print-admin concurrency tests. OK
- The forced race is as described: a spy holds both reads until both have arrived, then checks exactly one 200 and one 409, the winner's values, one version bump and one audit row. There is also a direct stale-version repository test and a 3-way any-interleaving test.
- f470392 removed every debug log. `grep DBG|process.stderr.write` across all `__tests__` finds nothing.

### 1facb55 / b923d99: fake S3 creds. OK
- They are set only in `__tests__/setup.js` (jest setupFilesAfterEnv), so app code can never see them. In the test env, s3.utils.js / print-s3.utils.js use these explicit creds instead of the developer's real `~/.aws` chain. That is safer than before.

### e35a41f: user test shards. OK
- Only the two workflow files changed. Shard jobs plus the aggregate "User Service Tests" gate are correct. The deploy job `needs` all user shards.

### c73f47e: SlowBuffer shim. OK
- On Node 22, `buffer.SlowBuffer` is a function, so the `if` never fires and the shim does nothing. On Node 26 it is undefined, and the shim adds it. It only adds a missing property, so it cannot hide a failing test.

### 0d61fe8: lockfile. OK
- It only removes two `extraneous: true` entries (packages/boilerplate, packages/inventory) that no longer exist.

### Print-on-demand commits (e6db0b1, ac15e3a, client commits): spot-check only
- The non-print files they touch are the expected wiring points (routes, menus, order models, order details).
- ac15e3a's `PRINT_NOT_PRINTED` guards appear in review-2 and security re-audit-2.
- Review-2's one blocker, N1 (worker slot leak), is fixed in committed code: `new Worker` is now created before the Promise (shared/utils/print-normalise.utils.js:339-343, 371-378).

## Scope B: uncommitted

### Test-harness hardening. OK to keep
- The jest.mock wrapping is correct. `jest.mock` is hoisted in the setup file, and the factory uses `jest.requireActual`. Every mocked `index.js` (admin/auth/user/delivery/picking) exports `start` returning `app`. Cron has no HTTP and correctly gets no mock.
- `wrapSupertest` copies supertest's static exports and wraps `agent`. A pre-listening server makes supertest skip `listen(0)` and not close it, which is what we want. `closeLoopbackServers()` runs in every afterAll, and `--detectOpenHandles` reports nothing.
- The `isolateModules` / `resetModules` users (product-upload-image-limit, discount-*) do not re-require `index.js`, so they are unaffected.
- `keepAliveTimeout = 0` is sound. Node 20+ clients reuse keep-alive sockets, so the server never closes an idle socket under them. The sockets are destroyed by `closeAllConnections()` at teardown.
- Port picker: 20000-31999 is below the Linux (32768+) and macOS (49152+) ephemeral ranges. It probes both 127.0.0.1 and the default host. It retries on MMS's real message (`Port "X" already in use`, mongodb-memory-server-core 11.0.1 MongoInstance.js:386). All setups use `count: 1`, so pinning only the first instance is enough. A GitHub Ubuntu runner has nothing listening there by default.
- `settled()` in razorpay.test.js really waits. The handler awaits all of its processing after the early ack, and the probe confirmed the router uses the tracked function. Assertions are not weakened; they only get stricter (sleeps replaced by a real wait).
- The 35 picking `.expect(200)` additions are all on set-up calls (claim / pick / oos) that must succeed before the real assertion. All 31 tests pass.

### SAC-code lock. OK to keep
- `sacCode` is no longer settable: the PUT validator rejects it (400, tested), `resolveConfig` always returns `998912` (tested), and the admin form shows it read-only and never sends it (tested).
- A stored value cannot reach invoices. `sacCode` is not used by `computeQuote`, `computeOrderQuote`, `toFrozenQuote` or any invoice code. Its only use is display through `resolveConfig`.
- Old admin builds are not broken: `buildPatch` sends only changed fields, so a normal save from an old build never includes `sacCode`.
- No leftover editable spot in admin/web/android/ios (grep).
- No agent names, finding IDs or worklog comments in the uncommitted diffs.

## Findings (all LOW)

1. **RefundBox duplicates the existing refund table.** `haper-admin/src/pages/Orders/OrderDetailsModal.tsx:1002` adds the new box, while `:1341-1374` still renders the old "Wallet refunds" table for the same refunds. The old table shows the raw code (`ADMIN_CANCEL`) and the new box shows the label. Fix: move destination and the Credited chip into the old table, or drop the table.
2. **"Credited" only checks that a log row with that id exists.** `haper-backend/packages/admin/src/routes/order/helper.js:74-88` + `shared/repositories/logs.repository.js:47-56`. Fix: also filter `type: ORDER_REFUND_TO_WALLET` and the order's user. Note `order.userId` is populated in getOrder, so use `order.userId._id`.
3. **No HTTP-level test that `getOrder` returns `destination` / `walletCredited`.** Wiring is at `packages/admin/src/routes/order/controller.js:825`; reverting that line breaks no test. Fix: add one GET `/admin/order/:id` assertion.
4. **The test guide is out of date.** `haper-misc/test-order-cancel-reason.md` (af6d718) says the backend test was "Not verified"; it now passes (3/3). It also talks about refunds "to the card or UPI", but no such code path exists. Fix: update both notes.
5. **The `PrintConfigUpdate` type still allows `sacCode`.** `haper-admin/src/api/print.ts:63`. Fix: `Omit<PrintConfig, 'configVersion' | 'updatedAt' | 'sacCode'>`.
6. **`request.agent` wrapper is an arrow function.** `packages/shared/test/loopback-supertest.js:33`, so `new request.agent(app)` would throw. There are no callers today. Fix: make it a normal `function`.
7. **The SlowBuffer shim only covers tests.** Tests can go green on Node 25+ while the real app (jsonwebtoken -> jwa -> buffer-equal-constant-time) would still crash at boot. CI and prod are on Node 20, so nothing is wrong now. Fix: before any runtime move to Node 25+, upgrade that dependency chain.

Info: f38e7e2's commit message is just "test". That cannot be changed on dev now; only worth knowing.

## Verdict per item

| Item | Verdict |
|---|---|
| Refund destination (backend 0aead5c, admin d1ca47a, misc af6d718) | OK to keep (LOW 1-4 optional) |
| Print-admin concurrency tests + debug-log removal | OK to keep |
| Fake S3 creds in test setup | OK to keep |
| User CI shards | OK to keep |
| SlowBuffer shim | OK to keep (LOW 7 for the future) |
| Lockfile cleanup | OK to keep |
| Print-on-demand commits (spot-check) | Match what was reviewed; OK |
| Uncommitted test-harness hardening | OK to commit (LOW 6 optional) |
| Uncommitted SAC-code lock (backend + admin) | OK to commit (LOW 5 optional) |
