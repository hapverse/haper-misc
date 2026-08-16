# Test: Set pricing at Receive Goods, fan it out to the warehouse's stores

**Area:** Admin panel → Warehouses → a warehouse → **Receive Goods** (goods receipt)
**Backend:** `POST /admin/procurement/receive` (`packages/admin/src/routes/procurement/*`)
**Permission:** receiving is unchanged — `receive_goods` (warehouse **staff**, warehouse **manager**,
super admin). **New:** the `sellingPrice` field itself is **manager-only** — a `warehouse_staff`
caller sending it gets **403**; and for a **manager / super admin** it is **compulsory only for a
product this warehouse has never priced** (blank on a never-priced sku = **400**; blank on a top-up
of an already-priced sku is fine and keeps the existing price). See "Who may set the selling price"
below.
**Deploy needed:** backend **redeploy** + admin **web deploy** (the form needs a new
**Selling price** box). **No DB migration** — the two new warehouse fields are additive and default
to `null`.
**Tests (green):** `packages/admin/__tests__/procurement-pricing-fanout.test.js` (36 tests) +
`haper-admin/src/pages/Warehouse/WarehousesPage.test.tsx` (21 tests — 10 selling-price UI
(incl. "a blank box submits fine" and "the server's sku-specific 400 is shown verbatim"),
3 pricing-sync toast, 2 label/attribute consistency, 1 "Repeat last" prefill, 5 pre-existing).
**Admin FE status:** BUILT and **in sync with the backend rule**. The **Selling price / piece (₹)**
box is on the Receive Goods line card, between MRP and Expiry, marked
**(required for new items)** for manager / super admin and **not rendered
at all** for `warehouse_staff`. A blank box is **never blocked in the browser** — the browser has no
way to know whether that sku already has a price here, so the server decides and its sku-naming
400 is shown as-is. The `storePricingSync` result is surfaced as a **second, warning toast**
when something is worth knowing (see "What the clerk sees after Receive").

---

## What this is (real example)

The **selling price is decided per warehouse**, not per product. Chapra warehouse may sell Amul
Butter at ₹58 while another Bihar warehouse sells the same pack at ₹60 — same state, different
price. So the price can't live on the Product Master (one product = one global price would be
wrong). It lives where a human is already typing numbers off the supplier's bill: **Receive Goods**.

Real example: 20 packs of **Amul Butter 100g** arrive at the Chapra warehouse. The clerk keys in
**cost ₹48**, **MRP ₹62**, **selling price ₹58** and hits Receive. Two things happen:

1. The **warehouse's own stock row** records all three prices (before, it only kept the cost).
2. **Every active store that this warehouse serves** has its catalogue row for that same barcode
   repriced to MRP ₹62 / selling ₹58 — automatically. Nobody opens each store and retypes the
   price. The store's **cost price is deliberately left alone** (see the rules below).

## The rules (what it does and deliberately does NOT do)

- **Match is on the barcode.** The warehouse `sku` IS the barcode, and that's what the store's
  catalogue row is matched on.
- **Update only — it never creates a store item.** If a served store doesn't stock that product
  yet, it is **skipped** and counted. Putting a product into a store's catalogue stays the
  **Assign / Product Master** job; a goods receipt must not quietly widen a store's catalogue.
- **MRP is optional for everyone, always** — no role, and no "was it priced before" check, applies
  to MRP. **Selling price** is optional too, with ONE exception: a manager / super admin receiving a
  product this warehouse has **never priced** must type one (**400** otherwise). Leave them blank
  and the receipt records stock + cost only, and the **previous prices are left alone** — both on
  the warehouse row and in the stores. A blank box must never blank a live shelf price.
  **Cost price is mandatory** (it is the warehouse's own cost).
- **A blank box is not a ₹0 price.** MRP and selling price must be **greater than 0** when typed —
  the same rule cost price has always had. Sending `0` is a **400**, because a ₹0 selling price is
  what the customer would actually be charged at every store the warehouse feeds. "No change" is
  expressed by leaving the key out, never by `0`.
- **Cost price does NOT reach the stores from a goods receipt.** A store's `costPrice` is worked
  out from **that store's own open batches** and is what profit/COGS and the discount margin-guard
  read. Real example: Chapra store still has 12 packs it got at ₹40; the warehouse today takes a
  delivery at ₹55. If the receipt overwrote the store's cost, those 12 old packs would suddenly be
  "worth" ₹55 and every profit number for them would be wrong. The store gets the ₹55 cost the
  correct way — **when a lot is actually transferred to it** (FEFO batch allocation at
  transfer-receive). The **warehouse's** own stock/batch rows do record the ₹55, as always.
- **Delisted store items are never repriced.** A store row with `status: 0` matches the barcode but
  is skipped — a discontinued product must not quietly acquire a live price.
- **`price` on a store item is the MRP**; `sellingPrice` is what the customer actually pays. Same
  mapping the "Assign to stores" flow already uses.
- **The last receipt wins.** Receiving the same product again with new prices overwrites — same
  rule the cost price has always followed.
- **The prices are NOT stored per lot/batch.** Cost genuinely differs lot to lot (that's why it's
  averaged per batch), but MRP and selling price are one business decision for the product at that
  warehouse — they live only on the warehouse's roll-up stock row. This works identically on
  batch-ledger warehouses and legacy ones.
- **The fan-out can never fail the receipt.** It runs *after* the stock transaction has committed.
  If a store update errors, the receipt is still **200**, the stock is still in, and the problem is
  reported in the response instead of being swallowed. One bad line doesn't cost the other lines
  their pricing.
- **Which stores count?** The same routing the rest of the system uses: a store's explicit
  *serving warehouse*, **or** — when it has none — the oldest active warehouse in the store's
  **region**. Region-fallback stores are included (most stores are onboarded without the explicit
  link, so leaving them out would mean pricing nobody). **Inactive stores are out of scope.**

## Who may set the selling price

Receiving goods is still open to **warehouse staff** — quantity, **cost price** and **MRP** have no
restriction at all. But the **selling price** is what the customer pays, and one line of it
reprices every store the warehouse feeds, so only a **warehouse manager** or a **super admin** may
type it.

Real example: a floor clerk at Chapra receives 20 packs of Amul Butter. They can key cost ₹48 and
MRP ₹62 as always. If they also fill **Selling price ₹58**, the whole receive is refused with:

> Only a warehouse manager or super admin can set the selling price. Remove the selling price and
> try again, or ask a manager to receive this line.

**Nothing is saved** — not the stock, not the cost, not even the other lines on the same bill. The
clerk either clears the selling price and receives normally, or a manager does that line.

**Why refuse instead of quietly ignoring the field?** Because the clerk saw "Received" and would
walk away believing ₹58 was recorded, while the shelf price never changed. A loud 403 is the only
honest answer.

### …and for a manager it is COMPULSORY — but only for a NEVER-PRICED product

The same field has two opposite rules, one per role:

| Who receives | `sellingPrice` |
| --- | --- |
| `warehouse_staff` | **forbidden** — sending it = **403**, nothing saved |
| `warehouse_manager` / `super_admin`, sku **never priced here** | **required** — leaving it blank = **400**, nothing saved |
| `warehouse_manager` / `super_admin`, sku **already priced here** | **optional** — blank = "keep the existing price", exactly like MRP and cost |

"Never priced here" means this warehouse has **no selling price on record** for that barcode: either
there is no stock row for it at all (a brand-new product), or the row exists but its selling price
is still empty (it was only ever received by staff, or received before this feature existed).

Real example A — **new product**: the Chapra **manager** receives 20 packs of a butter Chapra has
never stocked, types cost ₹48 + MRP ₹62, and leaves Selling price empty. Refused with:

> Selling price is required for Butter 100g (8901234567894) — this item has no price on record yet
> at this warehouse.

Nothing is saved — not the stock, not the cost, not the other lines. The message **names the product
and the exact barcode**, so on a 20-line bill the manager knows which line to fix instead of decoding
barcodes. If two lines are new, both are listed.

**A price typed on ANY line counts for the whole bill.** A bill can carry the same sku on two lines
(two batches / two expiries) and a clerk types the shelf price only once. Example: line 1 is
10 packs of butter at ₹58 (batch L1), line 2 is 6 more packs of the **same** butter with the price
box blank (batch L2). That is **200**, not 400 — the price *is* on the bill, just on the other line.
Only a sku that is blank on **every** line of the bill **and** has nothing on record is refused.

Real example B — **routine top-up**: a week later 40 more packs of that same butter arrive. Chapra
already sells it at ₹58 and nothing about the price is changing. The manager keys **only** quantity
and cost and hits Receive → **200**. The ₹58 stays exactly as it was, at the warehouse and at every
store it feeds. Nobody retypes 20 unchanged prices to file a stock top-up.

**Why this shape?** The first time a product is priced at a warehouse, somebody genuinely has to
decide the shelf price — a blank box there is a mistake, not a choice. After that, a blank box means
what it has always meant everywhere else on this form: leave it alone. (The earlier, blanket
"required on every line" version was wrong in practice: it made a manager's routine top-up harder
than a `warehouse_staff` member's, since staff can always receive without touching price.)

**Why 400 and not 403?** 403 means "you're not allowed to do this"; a manager IS allowed — they
just left a required box empty. That's a plain validation error, and the message says what to fill.

**Knock-on for anything that calls the API directly** (scripts, Postman, saved drafts): a
super-admin receive body without `sellingPrice` still works for any product that already has a price
at that warehouse, and only 400s for a first-ever receive of a product there.

**Request body (new field: `sellingPrice` per line):**
```json
{
  "warehouseId": "…",
  "supplierId": "…",
  "invoiceNumber": "TS6826",
  "items": [
    { "sku": "8901234567894", "name": "Amul Butter 100g", "costPrice": 48,
      "mrp": 62, "sellingPrice": 58, "quantity": 20 }
  ]
}
```

**Response (new block, additive — everything else is unchanged):**
```json
{ "msg": "Goods received",
  "data": { "warehouseId": "…", "items": [ … ],
            "storePricingSync": { "stores": 3, "updated": 2, "skipped": 1, "failed": 0, "warnings": [] } } }
```
- `stores` — active stores this warehouse serves.
- `updated` — store catalogue rows repriced.
- `skipped` — served stores that don't carry that product (normal, not an error).
- `failed` / `warnings` — something went wrong downstream; the receipt still succeeded.

## What the clerk sees after Receive

The goods receipt itself is the primary message and never changes: **"Goods received"** (success).
On top of that, when the price fan-out is worth talking about, a **second warning toast** appears —
the receipt already succeeded, so it never blocks anything:

- some store failed or was skipped → *"Prices reached 2 of 3 served stores — 1 failed, 0 skipped."*
- the warehouse serves **no active store** and the clerk actually typed an MRP / selling price →
  *"This warehouse serves no active store — prices weren't synced anywhere."*
- **a fully clean run stays ONE toast** — nothing extra. Silence means everything landed.

Real example: Chapra warehouse feeds 3 stores; one of them is offline when the bill is received.
Before, the clerk saw the same green "Goods received" as always and walked away believing all three
shelves were repriced. Now the second toast names the counts, so they know to re-check that store.

---

## ✅ Steps (`cd packages/admin && NODE_ENV=test npx jest procurement-pricing-fanout`)

**Warehouse side**
- ✅ Receive with `costPrice` + `mrp` + `sellingPrice` → `warehouse_stocks` has all three.
- ✅ Receive the same sku again with different prices → the new ones overwrite.
- ✅ Receive again with **no** `mrp`/`sellingPrice` (**as warehouse staff** — the only role that
  may file a price-less receipt now) → cost moves, the two prices survive (**not** wiped to null).
- ✅ Batch-ledger warehouse → the lot (`warehouse_batches`) keeps only the cost; no price on it.

**Store fan-out**
- ✅ Served store WITH an item for that barcode → `price` + `sellingPrice` updated; its **own**
  `costPrice` is **unchanged**.
- ❌ Store holding stock at cost ₹40 + a receipt at cost ₹55 → store cost stays **40**, MRP/selling
  still fan out, warehouse row records 55.
- ❌ Store item with `status: 0` (delisted) → **not** repriced, counted as skipped.
- ✅ Served store WITHOUT that item → nothing created, counted as **skipped**, no error.
- ❌ Store served by a **different** warehouse → untouched, not counted at all.
- ✅ Three served stores (two carry the product) → `updated: 2, skipped: 1, stores: 3`.
- ✅ Store with **no** explicit serving warehouse but a matching **region** (`"bihar"` vs
  `"Bihar"` — casing tolerated) → still priced.
- ✅ Receive without `mrp`/`sellingPrice` (**as warehouse staff**) → **no store row is touched** (shelf price and
  store cost both unchanged); only the warehouse row's cost moves.
- ❌ `mrp: 0` / `sellingPrice: 0` (or both) → **400**, and nothing is written anywhere — no stock,
  no ledger row, no store reprice. A negative value is still rejected; `1` is accepted.
- ❌ **Inactive** store (status 0) → out of scope; `stores: 0`.
- ✅ Batch-ledger warehouse → same fan-out via the stock-in/roll-up path.

**Never breaks the receipt**
- ✅ Store pricing update throws → still **200**, stock committed, `failed: 1` + a warning.
- ✅ One line fails → the other line's stores are still repriced.
- ❌ Blank/whitespace sku → matches **nothing** (guard: it must never wildcard-match every
  barcode-less item in a store and reprice the whole catalogue).

**Who may set the selling price**
- ❌ `warehouse_staff` sends a line WITH `sellingPrice` → **403**, and **nothing** is written: no
  warehouse stock row, no ledger row, store items untouched.
- ✅ `warehouse_staff` sends a line WITHOUT `sellingPrice` (qty + cost + MRP) → **200**, normal
  fan-out; the store's live `sellingPrice` is untouched.
- ✅ `warehouse_manager` sends a line WITH `sellingPrice` → **200**, fans out as before.
- ✅ `super_admin` sends a line WITH `sellingPrice` → **200**, fans out as before.
- ❌ `warehouse_staff` sends **two** lines where only the second has `sellingPrice` → the **whole**
  request is 403; the clean first line is **not** partially received.

**Selling price is MANDATORY only for a never-priced sku (revised)**
- ❌ `warehouse_manager` receives a **brand-new** sku (no stock row at this warehouse) with **no**
  `sellingPrice` → **400** *"Selling price is required for Butter (8901234567894) — this item has no
  price on record yet at this warehouse."* — the message **names the product name and barcode** —
  and **nothing** is written:
  no warehouse stock row, no ledger row, store items untouched.
- ❌ `super_admin` receives a **brand-new** sku with **no** `sellingPrice` → the same **400**.
- ✅ **The core case:** a sku that was received earlier **with** a selling price is topped up by a
  manager with **only** qty + cost (no `sellingPrice`, no `mrp`) → **200**. The warehouse row's
  `sellingPrice`/`mrp` and **every served store's** `sellingPrice`/`price` are **unchanged**; qty and
  the warehouse cost move. This is a routine top-up and must not demand a price.
- ❌ A stock row **exists but its `sellingPrice` is null** (e.g. the product was only ever received
  by `warehouse_staff`, or before this feature) and a manager receives it blank → **400**, same as a
  brand-new sku. "Row exists" is not the test; "has a price on record" is.
- ❌ **Two lines**: line 1 is a blank top-up of an already-priced sku (fine alone), line 2 is a blank
  **never-priced** sku → the **whole** receipt is 400 and the message names **only** the never-priced
  barcode. The acceptable line is **not** partially received.
- ✅ **Same sku on two lines, priced on only ONE of them** (different batch numbers) → **200**, and
  the warehouse row **and** every served store end on that typed price. Works whichever line carries
  it — first or last. This used to be a false **400**.
- ✅ **Same sku on two lines, MRP on one and selling price on the other** → **200**, and the store's
  `price`/`sellingPrice` match the warehouse row on **both** fields (neither is lost).
- ❌ **Same sku on two lines, blank on BOTH**, never priced here → still **400**. The "priced
  elsewhere on this bill" exception is **per sku**, not per bill.
- ❌ Sku A priced on the bill, sku B blank and never priced → still **400** naming **only** sku B.
- ✅ `warehouse_manager` **and** `super_admin` with `sellingPrice` on **every** line → **200**,
  warehouse row + fan-out exactly as before (regression).
- ✅ An **explicit** `sellingPrice` on an **already-priced** sku still overwrites it (₹58 → ₹61 at
  the warehouse and at every served store) — the exception only relaxes a blank box, it never
  ignores a typed price.
- ✅ `warehouse_staff` receiving a **never-priced** sku with **no** `sellingPrice` → still **200** —
  the "was it priced before?" check never runs for them (they're barred from the field; requiring it
  would block them from receiving).
- ❌ `warehouse_staff` **with** `sellingPrice` → still **403** (not the 400) — the permission answer
  wins over the validation one.

**Admin form — the Selling price box** (`npx vitest run src/pages/Warehouse/WarehousesPage.test.tsx`)
- ❌ Logged in as `warehouse_staff` → the **Selling price** box is **not on the screen at all**
  (not greyed out, not there — same "hide, don't disable" rule as the Verify Bill edit pencil).
  Cost / piece and MRP are still there and still work.
- ✅ Logged in as `warehouse_manager` or `super_admin` → the box shows between MRP and Expiry
  labelled **Selling price / piece (₹) (required for new items)**, takes ₹25.50, and that line is
  sent as `sellingPrice: 25.5`. A blank **MRP** on the same line is still left out entirely.
- ✅ Manager or super admin leaves the box **blank** and clicks Receive → the request **goes
  through** (no client-side toast, no block); the `sellingPrice` key is simply omitted, exactly like
  a blank MRP. This is the routine top-up case and it must not be stopped in the browser.
- ❌ The server refuses that blank (the sku has never been priced at this warehouse) → the clerk
  sees the server's own message **word for word**: *"Selling price is required for 8901234567894 —
  this item has no price on record yet at this warehouse."* Not a generic *"Something went wrong"*,
  and it does **not** open the duplicate-invoice "Add to this bill anyway" banner (that branch keys
  off the `DUPLICATE_INVOICE` code, not off message text).
- ✅ Before the click, the footer says **nothing** about a missing selling price and the
  **Receive 1 item** button is **enabled** — the FE can't know which lines need one, so it must not
  claim the receive will be refused.
- ✅ The **Selling price** label carries the soft *(required for new items)* qualifier, **not** the
  red **Required** badge that Cost / piece and Qty still carry (their rule didn't change).
- ✅ Logged in as `warehouse_staff` with **no** selling price anywhere → still submits normally
  (200, no `sellingPrice` key, no error toast) — the mandatory rule does not apply to them.
- ❌ A staff member opens a **saved draft** a manager had typed a selling price into → the value is
  never sent, so the receipt still goes through instead of 403-ing on something they can't see.
- ✅ **Labels say "/ piece" on all three money boxes** — *Cost / piece (₹)*, *MRP / piece (₹)
  (optional)*, *Selling price / piece (₹) (required for new items)* — so nobody reads them as a
  line total.
  The test derives the qualifier from Cost price's own label, so the three can't drift apart.

**Admin form — pricing-sync feedback + the ₹0 guards** (same vitest file)
- ✅ Response says `stores: 3, updated: 2, skipped: 0, failed: 1` → **two** toasts: the usual green
  "Goods received" **and** a warning naming *2 of 3 served stores — 1 failed, 0 skipped*.
- ❌ Response is fully clean (`stores: 3, updated: 3, skipped: 0, failed: 0`) → **only** the single
  success toast; no warning at all.
- ✅ Response says `stores: 0` and the clerk had typed an MRP → warning *"This warehouse serves no
  active store — prices weren't synced anywhere."* (No warning if no price was typed — nothing was
  being synced in the first place.)
- ✅ **MRP** and **Selling price** boxes carry the **same `min` / `step`** as **Cost / piece**
  (`min="0.01" step="0.01"`), so the browser refuses a `0` before the round-trip. Blank is still
  allowed — blank means "don't touch the price".
- ❌ **"Repeat last from supplier"** on an old receipt whose line has `mrp: 0` → the MRP box is
  prefilled **empty**, not `0`. Otherwise the clerk would be rejected on submit for a field they
  never touched. Cost / batch / expiry still prefill as before; selling price stays blank as before.

## Manual check on dev (damin.haper.in)

1. Warehouses → pick a warehouse → **Receive Goods**. Add a line with a barcode that at least one
   of its stores already carries. Fill cost **48**, MRP **62**, selling **58**. Receive.
2. Open that warehouse's stock row → cost/MRP/selling all show the values you typed.
3. Open the **store's** catalogue → the same product now shows MRP 62 / selling 58. Its **cost
   price is whatever that store's own stock cost** — it does not become 48.
4. Open a store served by a **different** warehouse → its price is unchanged.
5. Receive the same product again leaving MRP and selling **blank** → **200** (this sku already has
   a price at this warehouse, so a blank box is allowed even as a manager / super admin); the store
   row does not change at all; only the warehouse's cost changes.
5b. Now receive a product this warehouse has **never** had, leaving Selling price blank → **400**
   naming that product's name and barcode, and nothing is saved. Fill the box and it goes through.
6. Receive a product that no store carries → succeeds, and the response summary reports it as
   skipped (nothing is added to any store's catalogue).
7. Type `0` into MRP or Selling price → the **browser itself** refuses it before submitting (the box
   is `min 0.01`, same as Cost / piece); the backend rejects it too. Leave the box blank to keep the
   current price.
8. Receive against a warehouse that serves a store which doesn't carry the product → green "Goods
   received" **plus** a warning toast naming how many stores were skipped.
9. Pick a supplier whose last bill was received before this change and hit **Repeat last from
   supplier** → the MRP boxes come back **empty** on any line whose old MRP was 0 (never `0`).

## Edge cases / notes

- **Same sku on two lines of one bill** (two batches) — the pricing fan-out runs **once** for that
  sku, merging the lines **field by field**: the last line that actually *typed* an MRP wins the
  MRP, the last line that typed a selling price wins the selling price. That is exactly how the
  warehouse row itself behaves (a blank box means "leave that price alone"), so the stores always
  match the warehouse row. Merging whole lines instead would silently drop a price whenever the
  last line for a sku left one of the two boxes blank.
- **Existing consumers are safe** — `data.storePricingSync` is a new key; `data.warehouseId` and
  `data.items` are untouched, and the duplicate-invoice **409** path is unchanged.
- **Not built on purpose:** no stock is moved to the stores (this is pricing only), no store item
  is created, and `sellingPrice` is not written to the `stock-movements` ledger row (only `mrp`
  is, as before).
- **Admin FE (done):** the **Selling price (₹)** input sits between MRP and Expiry on each line
  card of `haper-admin/src/pages/Warehouse/WarehousesPage.tsx` (`GoodsReceiptModal`). It is gated by
  a **role** check (`can.role('super_admin', 'warehouse_manager')`) that mirrors the backend's
  `canSetSellingPrice()` — a role gate, not a permission, because that is what the server checks.
  For `warehouse_staff` the field is **absent from the page** and the payload builder also refuses
  to include the key, so a stale saved draft can't 403 them either.
- **"Repeat last from supplier" does not prefill the selling price** (cost / MRP / batch still do).
  It is a fresh manager decision each time, and the last-receipt endpoint doesn't return it. A
  historic **`mrp: 0`** (legal before this change) is also prefilled **blank**, so the grid can
  never start out holding a value the server would now reject.
- **The `storePricingSync` warning toast is advisory, never blocking** — the goods receipt has
  already committed by the time it shows. It is deliberately a *second* toast so the primary
  "Goods received" confirmation reads exactly as it always has.
- **The 403 message needs no special handling in the form** — it already shows the server's own
  sentence through the existing error toast. In normal use staff can't reach it.
- **The selling-price role check runs before any write** — it is not a partial save. A 403 leaves
  the bill completely un-received, so the fix is "clear the box and receive again".
- **Both role rules for this field live side by side in the controller**, not in the Joi schema:
  the schema only sees the request body and can't say "required for this caller, forbidden for
  that one". `sellingPrice` stays `Joi.number().greater(0).optional()` in `validator.js`. The
  "already priced?" half can't live in Joi either — it needs a **database read**, not just the body.
- **The requiredness check costs one extra query, and only sometimes.** It runs only for
  manager / super_admin callers, only when at least one line left the box blank, and it is a
  **single** `warehouse_stocks` lookup (`{warehouseId, sku: {$in: [...blank lines]}}`) — not one per
  line. A fully-typed bill does no extra read at all. It runs **before** the transaction, so a
  rejection still leaves nothing behind.
- **"No price on record" includes an absent field, not just `null`.** The lookup is `.lean()`, which
  skips schema defaults, so a row written before `sellingPrice` existed has the key **missing**
  entirely. The check is `!= null`, which treats missing and null the same.
- **ADMIN FE FOLLOW-UP — DONE (2026-08-16).** The browser-side hard block is **removed**, so the FE
  is no longer stricter than the server. `GoodsReceiptModal` now sends the receipt even when the
  selling price is blank on some or all lines, and the **server is the single source of truth** for
  the "never priced here" rule. Deliberately **not** implemented: a per-sku "does this warehouse
  already price it?" pre-check. It would need an extra round-trip per line, could still be stale by
  submit time, and would duplicate a rule that already lives (correctly) in one place. The cost of
  getting it wrong is now small in the right direction — a rejected receipt with a message naming
  the exact barcode, instead of a manager blocked from a receipt the API would have accepted.
  Removed with it: the `sellTouched` / `sellMissing` per-line state, the inline red
  *"Selling price required"*, the footer reason, and the `requireSelling` collapse flag on
  `lineComplete` / `uiForLines` (a blank selling price must no longer hold a line card open —
  on a top-up there is nothing to fill in).
- **Why a soft label, not the Required badge.** The box reads *(required for new items)* using the
  same muted parenthetical style the *(optional)* fields already use — no new badge style was
  invented for one field. The hard red **Required** badge would be wrong on most receipts (top-ups),
  and dropping the marker entirely would hide a real rule from the one person who can act on it.
- **ADMIN FE — DONE (2026-08-16, first pass; the "Required" half above supersedes it).** For a
  manager / super admin the Selling price box in `GoodsReceiptModal`
  (`haper-admin/src/pages/Warehouse/WarehousesPage.tsx`) briefly carried the same **Required** badge
  as Cost / piece and Qty and blocked submit before any API call. The payload builder was and stays
  unchanged (`...(canSetSellingPrice && l.sellingPrice.trim() ? …)`) — a blank has always omitted the
  key, which is exactly what "keep the existing price" now means. **Older saved drafts** with a blank
  `sellingPrice` restore and submit normally again.
- **The receive-count / submit button gate was deliberately NOT changed.** "Receive N items" still
  counts lines with sku + name + cost + qty, so the button stays clickable and the clerk gets an
  explicit toast naming what's missing — the same treatment the existing zero-cost check gets.

## What deploy this needs

- **Backend → `dapi.haper.in`** (new `sellingPrice` field + the fan-out).
- **Admin → `damin.haper.in`** (Selling price input on Receive Goods + the `storePricingSync`
  warning toast + the `min 0.01` price boxes).
- **No DB migration.** `warehouse_stocks.mrp` / `.sellingPrice` are additive, default `null`.
- Deploy backend first, then admin.
