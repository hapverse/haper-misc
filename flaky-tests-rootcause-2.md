# Flaky tests root cause #2 (2026-10-16)

Covers: admin `config.test.js` (2 of 81 red now and then), picking `picking-lifecycle.test.js`
(OOS audit row missing), admin `item-catalog-store-scope.test.js` #13 (401), plus the older
"404/401/403 / `res.body.data` undefined" failures. **One cause covers all of them. It is a test-harness
problem. Production code is not affected.**

## Root cause (proven)

`node_modules/supertest/lib/test.js:63`: `request(app)` starts a fresh server for EACH request with
`app.listen(0)`. With no host given, Node binds it to `::` (all addresses, IPv6 plus IPv4). But line 67 always
sends the request to `http://127.0.0.1:<port>`.

On macOS the kernel can give that `::` server a port that another process already holds on
`127.0.0.1` only. When that happens, the connection to `127.0.0.1:<port>` goes to the OTHER process, not
to our app. Every dev machine has such listeners. On this one there are 13 in the ephemeral range
(49152-65535, the range the OS picks "any free port" from):

| holder | 127.0.0.1 ports | what an HTTP request gets back |
|---|---|---|
| VS Code helper processes | 49714, 49719, 49832, 59838, 60116 | **401** or **404**, no `data` in the body |
| Gradle / Kotlin daemons (`java`, from Android builds) | 49615, 49848, 50805, 50819, 55374, 59050, 59073 | **connection reset** / empty reply (`read ECONNRESET`, `socket hang up`) |

A simple example: request #37 in the file gets port 49719. The kernel lets our `::` server bind it,
but `GET 127.0.0.1:49719/admin/config` reaches VS Code's helper, which answers `401`. The test
sees 401 instead of 200.

**Why it looks random, even on a quiet machine with one file running:** the kernel hands out ports
one after another, and the counter is shared by the whole machine. Every supertest request uses up
about 2 ports (one for the server, one for the client socket), plus the Mongo connections. So each run
moves the counter a few hundred ports along. A run only fails when the counter passes one of
the held ports at the moment a supertest server is binding. Which test fails depends on where the
counter happens to be, not on the test. The rate also changes during the day, as agents start
and stop Gradle daemons or VS Code windows. Node 22 and Node 26 behave the same way: this is the
macOS kernel, not Node.

## Evidence

All logs and probes are in `~/haper-logs/flaky2/` (outside /tmp).

1. **Kernel probe** (`probe/port-probe.js`): 20,000 × `listen(0)` on the default host. **15 hits** on ports
   that other processes hold on 127.0.0.1, covering all 13 held ports.
2. **Supertest misroute** (`probe/supertest-misroute2.js`): an app that always returns 200, with a fake
   127.0.0.1 listener on the next port. Result: `401 body.data=undefined {"error":"FOREIGN 401"}`, and in
   the reset variant `ERR ECONNRESET: Connection reset by peer`. Same on Node 22.18 and Node 26.8.
3. **The real, unchanged test files**, with a helper (`probe/foreign-squatter.js`) that holds every
   3rd 127.0.0.1 port just ahead of the counter:
   - `config.test.js`: failed in 3 of 3 armed runs (`config.test-fail-squat-{1,4,5}.log`) with
     `read ECONNRESET`. This is the exact text from the full-run failure ("should fall back to the
     constants…": `read ECONNRESET`). Without the helper: **15/15 green** on Node 22 (`config.test-summary.txt`).
   - `picking-lifecycle.test.js`: 6 red (`picking-lifecycle.test-fail-squat-1.log`). Five are
     `read ECONNRESET`. One is `refuses to complete…` *Expected 400, Received 409*: the **unchecked** `claim`
     call was the one misrouted, so the task was never claimed. This is the silent variant.
4. **Real local services answer the way the failures look**: `curl 127.0.0.1:<port>/admin/config` gets 401/404 from
   the VS Code helpers and exit 52/56 (empty reply / reset) from the Gradle daemons.
5. **Fix check** (`probe/loopback-bind-check.js`): with 40 squatted ports, default `listen(0)` collided
   1 in 30 (401). An awaited `listen(0, "127.0.0.1")` collided **0 in 30, in 2 of 2 runs**. When the bind is
   IPv4 loopback, the kernel sees the conflict and skips the held port.

## Per failing test

| test | what happened |
|---|---|
| config › "fall back to the constants when the doc has no referral key" | its `GET /admin/config` reached a Gradle daemon → `read ECONNRESET` (seen in the full-run log) |
| config › "reject two-part version '1.2'" (expected 400) | the PUT reached a foreign server → 401/404/reset instead of our validator's 400 |
| config › "(store) store admin gets 403" | same: a foreign status instead of 403 |
| picking › "writes an order-audit row when a line is marked out of stock" | the `claim` or `/oos` POST (status **not asserted**, lines 650-654) went to a foreign server → no OOS happened → `findOne` returns null. The handler itself awaits the audit write before replying (`packages/picking/src/routes/task/controller.js:623`), so there is no fire-and-forget race |
| item-catalog #13 (expected 200, got 401) | reached a VS Code helper that answers 401 |
| older 404/401/403 / `res.body.data` undefined | same: those are the statuses the foreign listeners give |

Ruled out on the code paths read: `authenticate` (`packages/admin/src/middleware/auth.js`) has no cache
and no time-dependent logic, and the admin JWT lasts 1d. `getConfig` has no cache. The test order in config.test.js is fine,
because each referral test `$unset`s / `$set`s its own state first.

## Production impact

**None.** Production servers bind fixed ports (`app.listen(config.adminPort)`), and nothing in the app
code is wrong. Not verified: Linux CI is probably immune, because Linux returns EADDRINUSE when `::` overlaps
`127.0.0.1:P`. This is a local-macOS flake.

## Minimal fix (test harness only, owner: sumit-backend)

Make supertest talk to a server that is **already listening on 127.0.0.1**. Supertest then reuses it
and never calls `listen(0)` itself. Patching `listen(0)` to add a host does **not** work: with a host,
`listen` becomes async, and supertest reads `app.address().port` straight away (crashes with
`Cannot read properties of null`).

Suggested shape: one new `packages/shared/test/loopback-supertest.js`, wired in each package's `__tests__/setup.js`:

1. `jest.mock("../index.js", ...)`: wrap `start()`. After the real `start()` resolves, do
   `app.__testServer = http.createServer(app)` and
   `await new Promise(r => app.__testServer.listen(0, "127.0.0.1", r))`. Then return the **express app
   unchanged**. `events.test.js:46/81` call `app.listen(0, cb)` on it, and `print-privacy.test.js` uses
   its own app, so both keep working.
2. `jest.mock("supertest", ...)`: `(app) => real(app && app.__testServer ? app.__testServer : app)`.
   Also re-export `real.agent`.
3. `afterAll`: close `app.__testServer`.

Bonus: one port per file instead of about 2 per request, so files with many requests move the shared
port counter much less. Also worth adding: assert the status of the "setup" requests in the picking tests
(claim / oos / pick), so the next infra problem fails at the line that caused it, not at a later
`findOne`.

## How to check the fix

Run the unchanged test with the squatter armed. Today it is red every time; after the fix it should be green:

```
~/haper-logs/flaky2/probe/run-squatted.sh admin config.test.js <tag>
~/haper-logs/flaky2/probe/run-squatted.sh picking picking-lifecycle.test.js <tag>
```
