# Flaky backend tests ("pass alone, fail in a busy full run"): root-cause investigation

Date: 2026-10-16 · Investigator: byomkesh (debugger) · Tree: haper-backend `dev` @ 0d61fe8, clean before and after

## Verdict
**NOT REPRODUCED. No root cause is proven.** Under every load setup I tried, all the named tests passed.
The evidence log (`scratchpad/test-all.log`) no longer exists: the machine rebooted at about 00:52 IST
(`uptime` showed 3 min at 00:55), and the reboot cleared `/private/tmp`. Because of that I could not see
what status codes or error messages the failures actually produced. The next step is to re-capture that
log (see "What the fixer needs" below).

## What I ran (Node 22.18.0, 10 cores) and what happened
| Setup | Result |
|---|---|
| `razorpay` + `print-upload` + `order-serviceability` (user) ×2, with 14 `while(1)` CPU burners | 72/72 green both times |
| The same 3 files in 2 concurrent jest processes ×2 | 72/72 green, all 4 runs |
| Full user suite (`--runInBand --detectOpenHandles --forceExit --verbose`, coverage on) in **2 concurrent processes** | 98 suites / 1682 tests green in **both**, about 1185 s each |
| Admin `config` + `delivery-boy` + `procurement-receipt-search` in 3 concurrent processes + 12 burners | 155/155 green ×3 |

## Hypotheses ruled out (verified)
- **H1, stale read from a lagging secondary: impossible in this harness.** Both setups start
  `MongoMemoryReplSet` with `replSet: { count: 1 }`, which is a single node with no secondaries
  (`packages/user/__tests__/setup.js:175`, `packages/admin/__tests__/setup.js` beforeAll). Both also mock
  `connectDb` to `readPreference: "primary"` (user setup.js:96-99, admin setup.js equivalent). So no
  read can be served by a lagging copy.
- **CPU load on its own** does not trigger these failures (table above).
- **H3, TTL caches.** The user-auth status cache (`shared/utils/jwt.utils.js:59-71`, 60 s) is keyed by a
  fresh user `_id` in every test. The rate limiters (`max: 1000 / 5 min`) are created per app
  instance. Neither can produce a 404.
- **Keep-alive cross-talk between supertest servers.** A probe ran 3000 sequential requests across
  6 express apps using Node 22's keep-alive `globalAgent`. Zero requests went to the wrong app.

## Real hazards found (VERIFIED mechanisms, NOT proven to cause the reported failures)
1. **Port sharing between mongod and supertest on macOS.** Verified with a probe: while one socket
   holds `127.0.0.1:P`, a default `listen(P)` (which binds `::`) still succeeds. Connections to
   `127.0.0.1:P` then reach the 127.0.0.1 socket. mongodb-memory-server 11.0.1 looks for a free port
   with a default-host listen and then closes it (`mongodb-memory-server-core/lib/util/getport/index.js`
   `tryPort`, around line 95). It then starts mongod with `--bind_ip 127.0.0.1`. That probe cannot see
   ports held on 127.0.0.1, and there is a gap between the probe closing and mongod binding.
   Supertest opens a new `listen(0)` server for every request and always connects to `127.0.0.1:<port>`.
   With two concurrent runs, a supertest request can therefore land on the other run's mongod. mongod
   8.2 answers HTTP with an empty reply (`curl` exit 52), so the test sees a socket hang-up, not a 404.
   Two mongod instances on the same port would fail with "address already in use", which matches the
   **30 s beforeAll timeout while booting** signature.
   Fix (test-only): give mongod `ip: "::1,127.0.0.1"` or probe ports on 127.0.0.1, or stop running two
   suites at once on one host.
2. **Fixed sleeps after a handler that replies before it finishes its work.**
   `user/src/routes/razorpay/controller.js:145` sends `200 Acknowledged` for any event other than
   capture, then keeps processing. `__tests__/razorpay.test.js` lines 113, 165, 212, 252, 304, 355/357,
   423, 469, 556, 571 and 641 wait a fixed 100-150 ms and then assert. The user setup's `afterEach`
   (setup.js, last block) deletes every collection, so work that has not finished leaks into the next
   test. This only affects the **webhook** tests, and it is a test-only problem.
   Fix: replace each sleep with a poll until the condition holds, for example
   `await waitFor(() => OrderModel.findById(id))` with a deadline of about 5 s.
3. **Async work that outlives its test file.** Seen in both full-run logs:
   `[discount] store flag lookup failed … stores.findOne() buffering timed out after 10000ms`
   (`shared/utils/discount.utils.js:781`). This is fire-and-forget work from an earlier file that
   kept running after that file's `mongoose.disconnect()`. It cannot touch the next file's data
   (each file gets its own mongoose instance and its own mongod), but it adds 10 s timers and noise.
4. **Admin fixtures shared across a whole file** (`admin/__tests__/setup.js` afterEach never wipes).
   If any test times out at 30 s, its leftover work keeps running while later tests use the same
   `beforeAll` admins and stores. This is a plausible link to the print-admin "30 s timeout followed by
   401" pair, but I could not confirm it.

## Signatures and their best explanations (all HYPOTHESES)
| Signature | Best explanation |
|---|---|
| razorpay webhook asserts | Hazard 2 (fixed sleeps) |
| 30 s beforeAll timeout while booting | Hazard 1 (port collision) |
| razorpay "401 no-token", "403/404 Joi" | Not explained. These routes never touch the DB before replying 401. If they fail, suspect the file's `beforeAll`/`beforeEach` (app boot or fixtures) timing out or throwing, not the route. Check the real error text. |
| print-upload "consent" 404, nearest-store 404, admin 403/401 | Not explained. The only 404 sources are `app.all("*")` ("You are lost"), the `getServingStores().catch(() => [])` path in `user/src/routes/store/controller.js:127` (any DB error becomes "No stores found", 404), and admin `auth.js` "Store not found". The message text in the real log decides which one. |

## Production bugs exposed
None proven. One smell: `store/controller.js:127` turns **any** DB error from `getServingStores`
into an empty list, which the user sees as a 404 "No stores found near your location". An outage
therefore looks like "no store serves you". This is a fail-safe that hides errors, not a race.

## What the fixer needs (to close this out)
Re-run the original failing condition and **keep the log outside /tmp** (for example in `~/haper-logs/`):
`npm run test:all 2>&1 | tee ~/haper-logs/test-all.log`, while a second `test:all` runs.
Then run `grep -a -A25 '●' ~/haper-logs/test-all.log`. For each 404, the response `message`
("You are lost" / "No stores found" / "Store not found") tells you which hypothesis applies.
