# Test guide — bulk receive of every DISPATCHED transfer

One-off operation that fully **receives** every stock transfer sitting at
`DISPATCHED` for one store — by default `"Haper - Bhagwan Bazar"` — instead of
clicking **Receive** once per transfer in the admin Stock Transfers screen.

**Script**
- `haper-backend/scripts/migrations/bulk-receive-dispatched-transfers.js` — real run (dry-run by default, `--apply` to write)

**Tests**
- `haper-backend/packages/admin/__tests__/bulk-receive-dispatched-transfers.test.js` (in-memory Mongo)

There is **no offline simulator** for this one (unlike the MRP/SP and bulk-transfer
scripts). Those planned from a static CSV / bsondump export; this one's input is
the live set of `DISPATCHED` transfer documents, so an offline "preview" would be
of made-up data. The in-memory Jest tests are the safe rehearsal instead.

## What it does

For every `DISPATCHED` transfer of the resolved store, in the order they were
created (oldest first), it builds the same request body the admin UI sends when a
receiver confirms **every line at its full dispatched quantity**, and calls the
real admin controller
(`packages/admin/src/routes/transfer/controller.js → receive`) with a synthetic
`req`/`res`/`next`, after passing the body through the real Joi validator.

Nothing about receiving is re-implemented, so the bookkeeping is what a human
would have produced:

- store `items.quantity` incremented per line (or per-lot `store_batches` when the
  line carries `batchAllocations` from a batch-enabled warehouse),
- one `stock-movements` `TRANSFER_IN` row per received line
  (`refType: "transfer"`, `refId` = the transfer `_id`, `refLabel` = `TRxxxxxx`),
- the dispatched units cleared from the warehouse's `inTransitQty`,
- `receivedAt` / `receivedBy` stamped,
- a linked replenishment request closed to `FULFILLED`.

### The receive request body (why it looks like this)

`POST /transfer/:transferId/receive` takes:

```json
{ "items": [ { "storeItemId": "…", "receivedQty": 7, "scannedBarcode": "8901234567890" } ] }
```

`items` is **optional** to the Joi validator — omitting it means "receive
everything in full". **The script never relies on that.** The controller enforces
a **mandatory barcode match** for every line with `receivedQty > 0`: the scanned
value must equal the line's `sku` (which is the product barcode a receiver's
scanner would emit). An omitted body carries no scans, so it would be rejected
with *"Scan the barcode for … to confirm receipt."*

So the body is always built **explicitly from the transfer's own stored lines**:

| field | value | meaning |
|---|---|---|
| `storeItemId` | the line's `storeItemId` | which store item to increment |
| `receivedQty` | the line's `quantity` | a **FULL** receipt — never partial |
| `scannedBarcode` | the line's `sku` | the match the controller demands |

A line whose `sku` is blank needs **no** scan (the controller skips the check for
it) and still receives in full; the dry run flags such lines with a `⚠️`.

### Scope

| Thing | How it is decided |
|---|---|
| store | resolved **by name** at runtime (default `"Haper - Bhagwan Bazar"`, override with `--store="<name>"`); **aborts** on 0 or 2+ matches |
| which transfers | `stock-transfers` for that store with `status: "DISPATCHED"`, oldest first |
| quantity per line | the full dispatched `quantity` |
| actor | a real `super_admin` `_id` (`SEED_ACTOR_ID` / `--actor=`), verified to exist and hold the role |

If **other** stores also have `DISPATCHED` transfers, the script prints a loud
warning naming them and their counts, and **does not touch them**. It neither
includes them silently nor pretends they do not exist. To act on one of those,
re-run with `--store="<that store's name>"`.

`CANCELLED` and already-`RECEIVED` transfers are never in the work list, and are
skipped (not an error) if a stale list still hands one over.

## How to dry-run

Dry run is the default — there is no flag to add and nothing is written.

```bash
cd haper-backend
node scripts/migrations/bulk-receive-dispatched-transfers.js
```

It prints the DB **host** and **name** it connected to (never the URI, never
credentials) and shouts `⚠️` if either looks like production. **Read those two
lines before doing anything else.**

Then it prints the resolved store, the transfer/line/unit totals, every transfer
with every line it would receive (`sku`, name, qty, `storeItemId`), any other
stores holding `DISPATCHED` transfers, and confirms every receive payload passes
the real `POST /transfer/:id/receive` validator.

✅ Expected on the run this was built for (7 pre-existing DISPATCHED transfers):

```
   transfers : 7
   lines     : 118
   units     : 1886

   TR000001   DISPATCHED   12 line(s) ·    269 unit(s)   dispatched …
   TR000002   DISPATCHED    5 line(s) ·     33 unit(s)   dispatched …
   TR000003   DISPATCHED    1 line(s) ·     23 unit(s)   dispatched …
   TR000004   DISPATCHED    5 line(s) ·     86 unit(s)   dispatched …
   TR000006   DISPATCHED   43 line(s) ·    538 unit(s)   dispatched …
   TR000007   DISPATCHED   30 line(s) ·    245 unit(s)   dispatched …
   TR000008   DISPATCHED   22 line(s) ·    692 unit(s)   dispatched …

   ✅ all 7 receive payload(s) pass the real POST /transfer/:id/receive Joi validator.
DRY RUN — nothing was written. Re-run with --apply to receive them.
```

`TR000005` (CANCELLED) and `TR000009` (already RECEIVED) must **not** appear —
they are terminal.

❌ Stop and investigate if:
- the store does not resolve to exactly one doc (name typo / duplicate store),
- a transfer you expected is missing, or one you did **not** expect appears,
- the DB banner does not name the database you meant.

## How to apply (real run)

```bash
cd haper-backend
SEED_ACTOR_ID=<super admin _id> node scripts/migrations/bulk-receive-dispatched-transfers.js --apply
```

Options: `--apply`, `--yes` (skip the typed confirmation), `--store=<name>`,
`--sample=<n>` (lines printed per transfer, default 200), `--actor=<id>`.

It re-prints the banner, verifies the actor is a real `super_admin`, asks you to
type `yes`, then receives the transfers **one at a time**.

**Failures are isolated.** Each receive runs in its own Mongo transaction (opened
by the controller), so a failing transfer rolls back completely and stays
`DISPATCHED` — the remaining transfers still run. The summary lists every
success, every skip and every failure with its reason. Exit code is `1` if
anything failed, `0` otherwise.

**Safe to re-run.** The work list is "whatever is DISPATCHED right now", and each
transfer's status is re-read immediately before acting, so a re-run retries only
what did not make it and skips what is already `RECEIVED`.

## How to verify in admin

1. **Stock Transfers list** — every transfer that was `DISPATCHED` for the store
   now shows **RECEIVED**, with the same item/unit counts as before. `TR000005`
   is still `CANCELLED`, `TR000009` still `RECEIVED`.
2. **Open a transfer** — every line shows `received = dispatched` (no short
   lines), and the receiver is the super admin you passed as `--actor`.
3. **Transfer discrepancies report** — should list **nothing new**; a short line
   there means a receive did not go in at full quantity (investigate, do not
   re-run blindly).
4. **Stock ledger (stock-movements)** — filter by the store: one `TRANSFER_IN`
   row per received line, `refLabel` = the `TRxxxxxx` id, quantity = the line
   quantity, actor = the super admin. Cross-check the ledger count against the
   line count printed in the summary.
5. **Item quantities** — spot-check 2–3 items from the dry-run preview: the store
   quantity must be the pre-run value **plus** exactly the transferred quantity.
6. **Warehouse stock** — the `in transit` figure for those SKUs drops to 0
   (`availableQty` is untouched: it was already decremented at dispatch).

## Edge cases covered by the tests

| # | Case | Expected |
|---|---|---|
| a | DISPATCHED transfers received | status → `RECEIVED`, `receivedQty == quantity` on every line, `receivedBy`/`receivedAt` stamped |
| b | store item quantities | rise by **exactly** the dispatched amounts (no double-apply) |
| c | ledger | one `TRANSFER_IN` row per line, correct `refType`/`refId`/`refLabel`/`storeId`/`actorId`/`balanceAfter`; **no** `TRANSFER_OUT` invented at receive |
| d | already `RECEIVED` / `CANCELLED` transfer | **skipped**, not an error; no stock moved, no ledger row |
| e | one transfer fails (line points at a missing store item) | that transfer rolls back fully (still `DISPATCHED`, `receivedQty` 0, no ledger row, in-transit intact); the other transfers still receive; a re-run retries only the broken one |
| f | other stores have DISPATCHED transfers | target store only is touched; the others are **reported**, not silently included or ignored |

Run them:

```bash
cd haper-backend/packages/admin
NODE_ENV=test npx jest __tests__/bulk-receive-dispatched-transfers.test.js
```

In-memory Mongo only — the shared `__tests__/setup.js` prod-abort guard makes a
real database connection impossible.

## Deploy

**None.** This is a one-off operational script run by hand from a machine with DB
access. No API, no client, no deploy needed.
