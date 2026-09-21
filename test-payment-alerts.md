# Test: Payment / webhook alerts actually reach a human

**Area:** cron service (no UI) → email to `PAYMENT_ALERT_EMAILS`, or super admins when it is unset
**Backend (new):** `packages/cron/src/jobs/payment-alert-digest.js`,
`packages/cron/src/lib/{cron-job-state,payment-alert-codes,payment-alert-notify}.js`,
registered in `packages/cron/src/scheduler.js`
**Reads (never writes):** the `logs` collection — rows written by
`packages/user/src/routes/razorpay/controller.js` (`alertLog`) and
`packages/admin/src/routes/order/controller.js` (`convertAlertLog`)
**Indexes:** `scripts/migrations/create-logs-indexes.js` — now builds **three** indexes on `logs`
(the new one, `logs_webhook_alert_window`, is what this cron reads through)
**Tests:** `packages/cron/__tests__/payment-alert-digest.test.js` (41),
`packages/admin/__tests__/create-logs-indexes.test.js` (18)
**Related guide:** `test-order-cod-conversion.md`
**Apps (Android / iOS / web / picker / delivery):** NO change, NO release needed.

## 🚨 Must be live BEFORE convert-to-COD is enabled for anyone

The convert-to-COD action can, by design, switch an order to cash **without** verifying
Razorpay when the gateway is unreachable and the order is small (`outcome:
"converted_unverified"`). That is only an acceptable trade because a human gets told about it
within the hour. Do not grant the `orders.convert_to_cod` permission to anybody until this cron
is deployed and you have seen a test mail arrive.

## What this does

The Razorpay webhook and the convert-to-COD endpoint have always written "a human needs to look
at this" rows into `logs` (`type: 3` = `WEBHOOK_ERROR`, `meta.alert: true`, `meta.code: "…"`).
**Nothing read them.** If a refund silently failed, or an order went to cash without checking
the gateway, the system recorded it perfectly and told nobody.

This job reads those rows and mails super admins. In plain words: it is the postman for a
mailbox that nobody had ever opened.

### Two tiers

| Tier | Runs | Contains |
|---|---|---|
| **URGENT** | hourly at **:25 IST** | money is at risk right now and nothing else will fix it |
| **DIGEST** | daily at **7:30 AM IST** | everything else, incl. any alert code added in future |

The digest filter is the exact complement of the urgent one, so every alert row lands in
**exactly one** tier — never both (no duplicate pages), never neither (no silent drop).

One consolidated email per tier per run: counts per code, up to **10** affected ids per code
(the count stays exact even when the list is trimmed), and a "what to do" line per code.
Zero rows ⇒ **no email at all**.

### Code → what to do

| Code | Tier | What to do |
|---|---|---|
| `capture.retry_budget_exhausted` | URGENT | A real payment was never settled. Check it in the Razorpay dashboard and credit the customer's wallet manually. |
| `capture.processing_failed` (`transient: false`) | URGENT | The webhook crashed permanently on this payment — it will never retry itself. Settle by hand. |
| `capture.processing_failed` (`transient: true` / absent) | digest | Retried itself. Only interesting as a burst. |
| `capture.refund_suppressed` | URGENT | A refund note already carries this payment id but we did not write it. Verify manually whether the customer was refunded. |
| `capture.dispatch_unresolved` | URGENT | The system read the order twice and still could not decide. Check the order + payment, settle manually. |
| `capture.gateway_refund_present` | URGENT | Already refunded **at Razorpay**. Do NOT refund again in the dashboard. |
| `convert.gateway_unverifiable` (`outcome: converted_unverified`) | URGENT | Order was switched to cash **without** verifying Razorpay. Check the payment status — the customer may pay twice. |
| `convert.gateway_unverifiable` (`outcome: refused`) | digest | The conversion was correctly blocked. Nothing to do. |
| `capture.exceeds_expected` | digest | Full amount was refunded anyway; look only if the gap is large. |
| `capture.second_capture` | digest | Customer appears to have paid twice — confirm the extra one was returned. |
| `capture.unexpected_status` | digest | Look the payment up in Razorpay; nothing was moved. |
| `capture.not_captured` | digest | No money was taken. Usually harmless. |
| `capture.foreign_currency` | digest | Not handled automatically. Check in Razorpay. |
| `capture.order_id_mismatch` | digest | Payment references a different Razorpay order than the one stored. Reconcile by hand. |
| `capture.unroutable` | digest | Notes carried no usable order id. Find the order via Razorpay's notes. |
| `capture.order_not_found` | digest | Money arrived for an order we cannot find. Reconcile manually. |
| `capture.currency_missing` | digest | Unexpected gateway payload. Check in Razorpay. |
| `capture.retry_budget_check_failed` | digest | A DB blip left the webhook's give-up guard off briefly. Look for a burst of other alerts around that time. |
| anything not in this table | digest | Falls through with a generic "this code is not in the table yet — treat as needing a human" line. |

### Who gets the mail

**`PAYMENT_ALERT_EMAILS` if it is set, active super admins otherwise.** Not both.

- `PAYMENT_ALERT_EMAILS` (comma separated, e.g. `finance@haper.in,ops@haper.in`) is the
  **primary** target: a shared ops mailbox outlives any one person's admin account.
- When it is unset (or every address in it is malformed), the mail goes to every **active super
  admin** (`roles` includes `super_admin`, `status: 1`) with an email — so an install that never
  set the env var still alerts somebody.
- An entry that is not a valid address (`a@b.c` shape) is **dropped with a masked log line**
  (`f***@haper.in`) instead of being passed to the mail server, because one unparseable address
  makes the relay reject the **entire** message — a typo would otherwise mean total silence.

Push is deliberately not used: `sendAdminStoreNotification` is store-scoped and explicitly
excludes super admins.

If there is **nobody** to mail, the run is treated as a **failure** — the rows are kept and
re-sent once a recipient exists. Silence is never the outcome. Same if the mail server
**accepts nobody** (every address rejected): a resolved send is not a delivered mail, so the
rows are kept. A *partly* rejected send counts as delivered (it reached someone) and logs each
rejected address, masked.

### What is in the mail (and what is not)

Ids and amounts only, via an **allow-list** of `meta` fields: `orderDisplayId`, `orderId`,
`paymentId`, `razorpayOrderId`, `gatewayOrderId`, `outcome`, `transient`, `status`, `amount`,
`capturedAmount`, `expected`, `cashToCollect`, `failures`.
Everything else in `meta` is dropped — that includes the gateway `notes` blob, `error` strings
and `stack` traces, which on live rows can contain customer data.
**Note on units — the mail now says which is which.** The writers disagree on purpose:
`amount` is copied verbatim from Razorpay (**paise**), while `capturedAmount`, `expected` and
`cashToCollect` are computed by us (**rupees**). Side by side that used to read
`amount=12000 · capturedAmount=120 · expected=100` — three scales, one line. It now renders:

| Stored | Printed in the mail |
|---|---|
| `amount: 12000` | `amount=12000 paise (₹120.00)` |
| `capturedAmount: 120` | `capturedAmount=₹120.00` |
| `expected: 100` | `expected=₹100.00` |
| `cashToCollect: 250.5` | `cashToCollect=₹250.50` |
| anything else (`status`, `failures`, ids) | exactly as stored |

Reader-side only: **nothing stored is changed or converted**, the raw number is always still
shown for `amount` so it can be matched against the log row.

### Idempotency — how it cannot double-send or lose a row

- A row per tier in a small `cron-job-state` collection holds a **watermark** (the exclusive
  upper bound already reported) and an expiring **run lock**.
- Window is `createdAt > watermark AND createdAt <= now − 5s`. The 5s lag is a clock-skew guard:
  `createdAt` is stamped by whichever API box wrote the row.
- The watermark advances **only after the email is accepted**. A failed send re-sends the same
  rows next run.
- Two cron instances: the lock is taken with `findOneAndUpdate`, so one wins and the other skips
  the tick. The lock is released by `(key, lockToken)`, so an overrunning instance cannot clear
  or overwrite a lock that was taken over from it.
- Backlog bigger than 500 rows per run is **carried to the next run**, cut at a clean timestamp
  boundary so rows sharing a millisecond are never split.
- **The alert rows are never modified.** They are append-only by intent.
- A notification failure is logged and returned — it never throws into the scheduler.
- **The window read is pinned to the PRIMARY.** Every service connects `secondaryPreferred`.
  The webhook writes the alert row on the primary and this job reads it seconds later; an
  unpinned read can land on a replica that has not caught up, see nothing, and move the
  watermark past a row that is then **never** mailed. (Replication lags most during Atlas index
  builds, backups, elections and webhook storms — exactly when alert rows get written.) The 5s
  window lag is a clock guard, not a replication guard. Same for the `cron-job-state` reads.
- **The window read has a 30s time limit** (`maxTimeMS`). On timeout the run logs and stops
  **without** moving the watermark, so the same window is retried next tick — nothing is lost.

### Health signal — because email cannot report its own failure

At the **start of every run of either tier** the job checks when each tier last delivered
successfully. If a tier has been silent for more than **2× its schedule** (urgent: 2 hours,
digest: 48 hours) it logs:

```
[payment-alert] delivery stale — the digest tier last succeeded 2950 minute(s) ago (...), over its 2880 minute limit.
```

It does **not** try to email about email being broken. A tier that has never run yet is not
"stale" — it is new. The cron service has no health/status route today (it is a scheduler
process, not an HTTP server), so this line in the cron service log is the whole signal — grep
for `delivery stale`.

## How to seed an alert row on dev and see the mail

There is no UI for this. Use whichever you can do:

**(a) Naturally (preferred, exercises the real writer).** On dev, run the convert-to-COD flow
with Razorpay unreachable (see `test-order-cod-conversion.md`, "⚠️ Razorpay unreachable") — a
≤ ₹5,000 order converts and writes the `converted_unverified` row, a > ₹5,000 one is refused and
writes the `refused` row.

**(b) By hand.** Ask someone with write access to insert one row into the dev `logs` collection
(read-only rules apply to everyone else — do not run this yourself against any DB you only have
read access to):

```js
db.logs.insertOne({
  type: 3,
  userId: null,
  meta: { alert: true, code: "capture.refund_suppressed",
          orderDisplayId: "HP1234567", paymentId: "pay_devtest1", amount: 12000 },
  createdAt: new Date()
})
```

Then wait for the next :25 (urgent) or 7:30 AM (digest) tick on the dev cron box.

## Checks

### Tiers and content
✅ Seed one urgent row (e.g. `capture.refund_suppressed`) → within the hour, ONE mail subject
`[URGENT] Payment alerts — 1 issue(s) need a human`, containing the code, the order/payment id
and the "what to do" line.
✅ Seed one digest-tier row (e.g. `capture.not_captured`) → NOT in the urgent mail; appears in
the next 7:30 AM mail, subject `[Payment alert digest] …`.
✅ Seed `capture.processing_failed` with `transient: true` → digest, not urgent.
✅ Seed `capture.processing_failed` with `transient: false` → urgent.
✅ Seed `convert.gateway_unverifiable` with `outcome: "refused"` → digest.
✅ Seed `convert.gateway_unverifiable` with `outcome: "converted_unverified"` → urgent.
✅ Seed a made-up code (`capture.not_a_real_code`) → appears in the digest with the generic
"not in the table yet" line. It is never silently dropped.
✅ Seed 14 rows of the same code → mail shows the count **14**, lists 10 ids, and says
"…and 4 more."
✅ Seed 3 rows of code A and 2 of code B → **one** mail with two sections, not five mails.

### Nothing happens when nothing is wrong
❌ No alert rows in the window → **no email is sent at all** (check the cron log line
"no alert rows in window — no message sent").
❌ A `WEBHOOK_ERROR` row **without** `meta.alert` (the invalid-signature row the webhook writes)
→ never mailed.
❌ A row of a different `type` that happens to carry `meta.alert` → never mailed.

### Idempotency / failure paths
❌ Let two ticks run over the same rows → the second sends **nothing** (the rows were already
reported).
❌ Break SMTP (wrong `SMTP_PASS` on dev) and let a tick run → no mail, an error line in the cron
log, and the watermark does **not** move. Fix SMTP → the **same** rows arrive on the next tick.
Nothing is lost.
❌ Deactivate every super admin and unset `PAYMENT_ALERT_EMAILS`, seed a row, let a tick run →
the run is logged as failed. Re-activate a super admin → that same row is delivered.
❌ Run two cron instances → exactly one mail per batch; the loser logs "another instance holds
the lock — skipping this tick."
❌ Check the alert rows after a successful send → **unchanged** (no flag written on them).
❌ Seed 502 alert rows of the same tier at once → the first tick mails **500** and logs
"(more waiting — next run)", the next tick mails the remaining **2**, the third mails nothing.
No row appears in both mails.
❌ Point `PAYMENT_ALERT_EMAILS` at one good address and one dead one (e.g.
`ops@haper.in,nosuchbox@haper.in`) → the mail still arrives at the good address, and the cron
log carries `recipient(s) rejected by the mail relay: n***@haper.in`. The rows are **not**
re-sent. If **every** address is dead, the run fails and the rows **are** kept.
❌ Put a typo in `PAYMENT_ALERT_EMAILS` (`ops@haper.in,ops.haper.in`) → the typo is dropped
(log: `dropped 1 malformed entry`, masked), the rest still get the mail. Before this it made
the whole send fail.

### Recipients
✅ Set `PAYMENT_ALERT_EMAILS=finance@haper.in` → the mail goes to **that address only**, super
admins are NOT copied.
✅ Unset it → the mail goes to every **active** super admin (an inactive one, and a store admin,
get nothing).

### Health
✅ Stop the digest tier from succeeding for >48h (e.g. break SMTP) → every urgent run logs
`[payment-alert] delivery stale — the digest tier …` in the cron log.
❌ A tier that has never run at all → **no** stale line (it is new, not broken).
✅ A tier that has **never** succeeded (e.g. SMTP broken or the `logs` index missing so every read
times out, from its very first run): once it has been running longer than its window (urgent 2h /
digest 48h) the cron log shows `[payment-alert] delivery has never succeeded — <tier> tier: N
run(s) since <time>`.
❌ The same tier still inside its window → no such line. Once it succeeds, the line stops.
(State row now records `firstRunAt` + `runCount`; older rows are backfilled on their next run.)

### Recipient lookup
✅ Super-admin fallback reads from the primary (a just-created / just-deactivated super admin is
seen immediately).

### Privacy
❌ Seed a row whose `meta` also carries `email`, `contact`, `card`, `notes`, `error`, `stack` →
none of those values appear in the mail subject, body, or recipient list. Only the allow-listed
ids/amounts do.

## Deploy / rollout

- Cron service redeploy only. No app release, no admin FE change.
- **Index (run it before/with the redeploy, standalone):**
  `node scripts/migrations/create-logs-indexes.js` (dry run) then `--apply`. It now builds
  **three** indexes on `logs`; the new `logs_webhook_alert_window`
  `{ type, meta.alert, createdAt }` (partial on `type: 3`) is the one this cron's hourly window
  read needs — without it every tick is a full scan of every webhook-error row plus an
  in-memory sort, and those rows are also written for unsigned POSTs (i.e. anyone can inflate
  them). ⚠️ That script also carries the **TTL that deletes webhook bodies older than 90 days**
  (`type: 5` rows only, unchanged here) — read its banner before `--apply`. It is NOT part of
  `npm run migrate`. Re-running is safe: same name+key+options is a no-op, any conflict is
  reported and nothing is dropped.
- The `cron-job-state` collection is created on first run. No index needed (`_id` is the key).
- **First run backfills at most the last 24 hours** — switching the job on does not mail out the
  entire history of `logs`.
- Env (`.env.example` has all three; `PAYMENT_ALERT_EMAILS` ships commented out — set it, e.g.
  `finance@haper.in,ops@haper.in`, to override; unset = active super admins), and SMTP must be configured on the cron box (`SMTP_USER` /
  `SMTP_PASS`) — the same transport the inventory red-stock mails already use.

## Decisions made (previously open)

1. **Hourly is kept** for the urgent tier (not every 15 minutes).
2. **Email only** — no SMS/WhatsApp page for `capture.retry_budget_exhausted`.
3. **`meta.reason` stays out** of the allow-list: it is free text, and free text must never
   leave the system in an alert mail.
4. **Recipients:** `PAYMENT_ALERT_EMAILS` when set, super admins as the fallback (above).
