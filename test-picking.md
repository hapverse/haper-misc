# Picker app — End-to-End Test Guide

A single **sequential** walkthrough for the tester on the **Android picker app** (Kotlin/
Compose), against **dev** (`dapi.haper.in`). You set up one pickable order in the admin/
customer side, then exercise every picker change in order. Each step says **what to do**
and **what to expect** (✅ good / ❌ should be blocked). The `(feat)` tags map a step to the
change it exercises.

> Companion to `test-inventory.md` (admin/inventory). That guide explicitly **doesn't**
> cover the picker app — this one does.

---

## 0. Prerequisites (read once)

1. **Backend on dev** with the picking improvements deployed:
   - `oosReason` persistence — haper-backend **PR #95** (merged).
   - **undo (reset) endpoint** — haper-backend **PR #96** (merged; the dev box must be
     **deployed** for §L to work).
   - **partial-pick (short-pick) endpoint + order-audit logging** — haper-backend **new PR**
     (the `pick` endpoint now accepts a quantity < required and reduces/refunds the line;
     OOS + short-pick now write an `order_audit_logs` row). Needed for §J and the §K audit
     check. If "Pick 3 of 5" returns 400 on dev, this PR isn't deployed yet.
   - If a step below "does nothing", the dev box is a build behind.
   - Health check: `GET https://dapi.haper.in/picking/health` → `200 {"ok":true}`.
   - **Picker-app PRs:** scan-gate / OOS / scanner / scan-anything / urgency = **#1 / #2**
     (merged); **undo** = **#3** (merged); **partial pick (quantity stepper)** = **#4**
     (merge before testing §J).
2. **Picker app** — a **debug** build (its `BuildConfig.API_BASE_URL` points at dev,
   `dapi.haper.in`), installed on a **real Android device or an emulator with a camera**.
   Build: `cd haper-picker && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/`.
3. **A store with picking ON** — `config.pickingEnabled = true`. A super admin sets this
   (Stores → Edit), or it's set in the DB. Without it **no pick task is ever created**
   and the order never reaches the queue. (On dev, **Haper Mart** is already enabled.)
4. **A picker account** assigned to that store (the `pickers` collection: `email`/
   `username` + `storeId` = the store). On dev: `raunakbbs@gmail.com` → Haper Mart.
5. **Seed pickable orders** in that store (place via the customer app or POS), so a pick
   task is created on each order reaching **OPEN**:
   - **Order A** — **prepaid (Razorpay)**, with a line of **quantity ≥ 3** (for partial
     pick + refund) and at least one other item.
   - **Order B** — any order with **2+ different items** (for mixed in-stock/OOS).
   - One item should have **no barcode on file** (to test inline enroll), and one **with**
     a barcode (to test scan match/mismatch + the scan gate).

> If an order you placed isn't in the queue: confirm the store has `pickingEnabled`, the
> order is **OPEN**, and its `storeId` matches the picker's. (A backfill may be needed for
> orders placed *before* picking was turned on — they don't auto-create a task.)

---

## The walkthrough

### A. Login + the three tabs  (feat: IA rename 7/10)
1. Log in with the picker's username + password.
2. ✅ Three tabs read **Available · My Pickings · Picking History** (not "My picking /
   Completed").
3. ✅ **Available** lists unclaimed orders for this store, oldest first; each row shows
   `#orderId · N item(s) · Pending`.

### B. Order urgency timer  (feat: urgency timer)
1. On an Available row, ✅ a **"⏱ Waiting Xm"** line shows how long it's waited (from the
   pick task's `createdAt`).
2. ✅ Past **10 minutes** it turns **red + bold** (pick the oldest first). "just now" under
   a minute; "1h 5m" format past an hour.

### C. Claim an order  (feat: existing flow)
1. Open **Order A** → **Start picking**.
2. ✅ It moves to **My Pickings**; the bottom bar shows "N item(s) left to pick".
3. ✅ Admin side: the order status is now **PICKING** (was OPEN).

### D. Scan-to-reveal gate  (feat: #2)
On a fresh, unscanned line:
1. ✅ The product **name / image / quantity are hidden** — the card shows **"Scan to
   reveal product"** + only the **📍 location**.
2. ✅ Actions available: **Scan to verify / register**, **Enter barcode manually**, **Out
   of stock**, **Confirm without scan (override)**.

### E. The scanner screen  (feat: #1 + torch + polish)
Tap **Scan to verify** (or **Scan to register barcode**):
1. ✅ A full-screen camera scanner opens with a **Back arrow** (top-left) **and** a
   **Cancel** button (top-right) — you can always get out without scanning.
2. ✅ First run prompts for **camera permission**; denying shows a "Grant camera access"
   screen (still has Cancel).
3. ✅ A **torch/flashlight** toggle (top bar) turns the light on/off.
4. ✅ **Tap** the preview = focus; **pinch** = zoom.
5. ✅ On a successful decode: a **beep + haptic**, then it returns to the line.
6. ❌ Back / Cancel returns without changing the line.

### F. Scan to verify / mismatch / enroll  (feat: existing + error tone)
1. Scan the **correct** barcode → ✅ toast **"Product verified ✓"**; the card now **reveals
   name/image/qty** and a **"Pick N"** button.
2. Scan a **wrong** barcode on a barcoded line → ✅ **"Wrong product scanned ✗"** (distinct
   error tone), line stays unverified.
3. On the **no-barcode** item, scan any code → ✅ **"Barcode registered ✓"** (enrolled
   inline); the line reveals and is pickable.

### G. Scan-anything (continuous) mode  (feat: scan-anything)
1. From the order's top bar, tap the **scan icon** ("Scan order items").
2. ✅ The scanner stays open; scan items **one after another without reopening**.
3. ✅ Per scan, a bottom **overlay**: **green "✓ <product>"** for a match, **red "Not in
   this order"** / "out of stock" otherwise — with matching success/error tones.
4. ✅ No toast spam (the overlay is the feedback). Tap **Done** to exit.
5. ✅ Back on the list, scanned lines are now revealed/verified.

### H. Manual barcode entry  (feat: existing fallback)
1. On a line, **Enter barcode manually** → type the code → **Verify**.
2. ✅ Same result as a camera scan (match / mismatch / enroll). Use this when the camera/
   scanner gun is unavailable.

### I. Confirm without scan (override)  (feat: #2 + report)
1. On an unscanned line, tap **Confirm without scan (override)**.
2. ✅ The line is **picked but marked un-scanned**; the chip reads **"Picked (no scan)"**.
3. ✅ It will appear in **Products Without Scan** (§N).

### J. Partial pick (short stock)  (feat: partial pick — needs picker PR #4 + backend partial-pick PR deployed)
On **Order A**'s line with quantity ≥ 3 (reveal it first via scan):
1. ✅ A **quantity stepper** (−/+) shows `qty / required`, defaulting to the full quantity
   (only when required > 1).
2. Step it **down** (e.g. 3 of 5). ✅ The button reads **"Pick 3 of 5"**.
3. Tap it → ✅ toast **"Picked 3 of 5 — rest adjusted"**; the chip reads **"Picked 3/5"**.
4. ✅ Backend (admin/DB):
   - The **order line quantity** is reduced to 3.
   - **Prepaid (Order A):** the shortfall is **refunded to the wallet** (₹ = short units ×
     price); `refundedAmount` + `hasPartialRefund` set. (COD order: no wallet credit — the
     **total is reduced**.)
   - The item's **stock is forced to 0** (the picker took all that was on the shelf).
   - An **order-audit row** is written (`action: "order.line.short_pick"`, `metadata`:
     itemId/pickedQty/shortQty/refundAmount, `actor.roles: ["picker"]`) so the reduction
     is traceable in the order history — see §K note.
   - **NEW — customer sees it:** an `adjustments[]` entry is written **on the order**
     (`reason: "short_pick"`, `originalQty` → `newQty`) for **every** payment method — so the
     **customer app** shows it, not just admin. Verify in §O.
5. ❌ Try to step **above** required → the **+** is disabled (and the server rejects >
   required). Quantity **0** isn't possible (min 1 — use Out of stock instead).

> ⚠️ **Until the backend partial-pick PR is deployed on dev**, stepping below the required
> quantity returns **400** ("Picked quantity must be between 1 and the required quantity").
> The picker UI shipped first (picker PR #4); the backend that *accepts* a short quantity is
> the new partial-pick PR. If "Pick 3 of 5" errors on dev, the backend box is a build behind.

### K. Out of stock + reason  (feat: #3/#4/#5/#9)
On **Order B**, mark one line out of stock:
1. Tap **Out of stock** → ✅ a **reason dialog** opens (it no longer fires immediately).
2. ✅ Fixed reasons: **Not on shelf · Damaged · Expired · Near expiry · Wrong location ·
   Other**. Picking **Other** reveals a free-text box.
3. Pick a reason → **Confirm**.
4. ✅ The line card turns a **distinct error/red tint** (stands out from in-stock lines in
   a mixed order) and shows **"Reason: <chosen>"**; chip reads **"Out of stock"**.
5. ✅ Backend: for a **prepaid** order the OOS item is **removed + refunded**; for COD the
   total drops. The reason is persisted (`oosReason`).
6. ✅ **Audit trail (new):** an **order-audit row** is written
   (`action: "order.line.out_of_stock"`, `metadata.oosReason` = the chosen reason,
   `actor.roles: ["picker"]`). Previously a picker-removed line vanished from the order with
   no record — now the removal/short-pick is logged on the order itself, not just the pick
   task. **Three ways to view it in admin** (all show it in chronological order):
   - **Order modal → "Order Activity"** section (lists action, reason, who, when) + an
     **"Open full page ↗"** link.
   - **Order list → the history (⟳) icon** next to the eye icon on each row.
   - **Sidebar → "Order Activity"** page (Sales & Orders): search any order by id / `HP…`
     display id (`GET /admin/order/audit-trail/:query`).
   Or directly in the `order_audit_logs` collection (by `orderDisplayId`). Note: only rows
   written *after* the audit logging is deployed appear — orders OOS'd before that have no row.
7. ✅ **NEW — customer sees it:** an `adjustments[]` entry is written **on the order**
   (`reason: "out_of_stock"`, `newQty: 0` = removed) so the **customer app** shows the removal,
   not just admin. Verify in §O.

### L. Undo a picked line  (feat: undo — needs backend PR #96 deployed)
1. On a **PICKED** line (full or partial), ✅ an **"Undo — move back to to-do"** button
   shows (while the order is in progress).
2. Tap it → ✅ toast **"Pick undone"**; the line returns to **PENDING** (hidden again until
   re-scanned) and is **re-pickable**.
3. ✅ **OOS** lines have **no Undo** button (undoing a refund is a separate phase).

### M. Complete → Picking History  (feat: #8 + #5)
1. Resolve every line (pick or OOS) → the bottom bar shows **Complete picking** → tap it.
2. ✅ Toast "Picking complete — ready for dispatch"; you're taken to **Picking History**
   and the just-completed order is **visible immediately** (no manual tab reload).
3. ✅ Open it from history → OOS lines still show their **reason** (§K).
4. ✅ Admin side: order status is **PACKED**. (If **every** line went OOS the order is already
   **CANCELED** — it auto-cancels the moment the last item is OOS'd, see §Q — so you won't be
   completing an empty order in the normal flow.)

### N. Products Without Scan report  (feat: #6)
1. From the task-list top bar, tap the **audit icon** (Products without scan).
2. ✅ It lists every line you **picked via override / without a scan** across your **active
   + completed** pickings, each with the order id, qty, and an **Active / Completed** chip.
3. ✅ If everything was scan-verified, it shows "Every product was scan-verified…".

### O. Customer sees the change in their order  (feat: order adjustments — needs backend adjustments PR + android build with the change)
> **Why:** before this, a picker short-pick / OOS only showed in **Admin → Order Activity**.
> For a **COD** order there was **no refund entry**, so the customer app showed the new lower
> quantity with **no indication it had changed** — they had no visibility (original bug
> HP50999049). Now the change is recorded on the order itself (`adjustments[]`) for **every**
> payment method and rendered in the customer app.
1. Place a **COD** order with an item at qty ≥ 2, then short-pick it (§J) or mark it OOS (§K).
2. Open the **customer app → Orders → that order's details**.
3. ✅ A **"Changes while preparing your order"** card appears (above Wallet refunds), listing
   each changed item with a badge: **"Qty 3 → 1"** for a reduction, **"Removed"** for OOS, plus
   a plain-language reason ("Reduced — limited stock available" / "Out of stock — removed…").
4. ✅ **Prepaid** order: the card shows **and** the existing "Wallet refunds" card shows (the
   refund is the money-back; the adjustments card is the what-changed). COD: only the
   adjustments card (no money moved).
5. ✅ A **full** pick (no short/OOS) adds **no** card (nothing changed).
6. ✅ **Android, iOS, and web** all render this card (same copy + "Qty X → Y" / "Removed" badge).
   **Admin** doesn't need it — it already shows the change (richer) in **Order Activity**. Old app
   builds without the field decode it to null/empty and simply don't show the card (no crash —
   the field is nullable / always-emitted).

### P. Admin assign + close a packed order — notification integrity  (fix: Issue 2, no push on a failed op)
> **Why:** after a pick the order is **PACKED**; admin then assigns a rider and later closes it.
> Previously the customer "success" push fired from the DB write hook the instant `status` was
> written — and the close runs inside a **transaction**, so a "Delivered 🎉" push went out *before
> commit*. If the close then failed (it could: the invoice number was written without the
> transaction's session, conflicting with the order's own lock → **"Failed to close"**), the order
> rolled back to PACKED but the customer was already (wrongly) notified (bug HP50999049, Issue 2).
1. Pick + complete an order so it is **PACKED** (§J–§M).
2. **Assign** a rider (Admin → order → assign). ✅ Status → **ASSIGNED**; rider gets the new-job
   push; customer gets **"Order Assigned 📦"**. (Assign is non-transactional, so it only ever
   notifies on a write that actually landed.)
3. **Close** the order (Admin → mark status **Delivered/CLOSED**). ✅ It **succeeds** (no "Failed to
   close"); status → **CLOSED**; an **invoice number** (`INV-…`) is assigned; customer gets
   **"Delivered 🎉"** — fired **after** the commit, exactly once.
4. ❌ **Failure path (the bug):** if a close/assign **fails** on the admin side, the customer must
   get **NO** push and the order must stay in its prior status. The push is now queued on the DB
   session and only flushed **after** `commitTransaction()` succeeds — an aborted transaction emits
   nothing. (Covered by `packages/admin/__tests__/order-close-notification.test.js`.)
5. ✅ The same post-commit rule applies to **admin cancel**, **user cancel** (1-min window), and the
   **payment-abandonment cron** — all transactional status writers.

### Q. All items out of stock → the order auto-cancels  (fix: Issue 3)
> **Why:** before this, OOS'ing the **only** item left the order stranded in **Preparing** with an
> empty Items list, a live **Delivery OTP**, and a phantom **₹2** (delivery + platform) bill — even
> though there was nothing to deliver (bug HP70989050). Now an order that loses its **last** item
> cancels itself the instant that item is marked OOS.
1. Place an order with a **single** item (or a few). In the picker, mark the last remaining item
   **Out of stock** (§K).
2. ✅ The order **auto-cancels immediately** (no need to tap Complete): status → **Cancelled**, the
   **pick task auto-completes** (leaves your queue), and a follow-up **Complete** returns **409**.
3. ✅ **Customer app (Orders → that order):**
   - Status shows **Cancelled** (not "Preparing").
   - **No Delivery OTP** (it's cleared — the order isn't deliverable).
   - **Bill is ₹0** — delivery + platform fees are zeroed (not the misleading ₹2).
   - The **"Changes while preparing your order"** card (§O) shows the item **Removed — Out of stock**.
4. ✅ **Money:** **COD** → nothing was collected, nothing to refund (bill just goes to ₹0).
   **Prepaid** → the wallet is refunded **everything**, including the delivery + platform fees (each
   item's amount was already refunded as its line went OOS; the cancel adds back the leftover fees).
5. ✅ A **multi-item** order stays **active** (PICKING) while it still has at least one item — it only
   cancels on the OOS that removes the **last** one.
6. ✅ **Backstop:** if an order somehow reaches **Complete** already empty (e.g. an order stuck from
   before this fix), Complete runs the same full cancel (status/OTP/fees/refund).

---

## Negative / edge cases to confirm
- **Partial above required** → **+** disabled; server 400 if forced.
- **Pick quantity 0** → not possible (min 1).
- **Scan gate on a partial pick** of a *barcoded* line → must scan or override first (400
  without).
- **Undo an OOS line** → no Undo button; server returns **409** if called directly.
- **Undo after Complete** → not offered; server **409** (task no longer in progress).
- **Another picker** acting on your claimed task → **403**.
- **Mark OOS on an already-picked line** (or vice-versa) → **409**.
- **Mixed order**: one line OOS (red), others in-stock (normal) → visually distinct.
- **Empty states**: "No orders waiting", "You have no active pickings", "No completed
  pickings yet".

---

## Backend verification (admin panel / DB) — spot checks
| After… | Check |
|---|---|
| **Partial pick** (prepaid) | wallet credited the shortfall; order line qty reduced; `refundedAmount`/`hasPartialRefund` set; item stock = 0; `order_audit_logs` has `order.line.short_pick` |
| **Partial pick** (COD) | order total reduced; no wallet credit; item stock = 0; `order_audit_logs` has `order.line.short_pick` |
| **Out of stock** (prepaid) | item removed from order; wallet refunded full line; item stock = 0; line `oosReason` set; `order_audit_logs` has `order.line.out_of_stock` |
| **Order audit trail** | every picker-driven removal/reduction shows in the admin order modal's **Order Activity** section (and as a row in `order_audit_logs`, `actor.roles: ["picker"]` + reason in `metadata`) |
| **Customer-visible change** (any payment method) | the **order** has an `adjustments[]` entry (`reason` short_pick/out_of_stock, `originalQty`→`newQty`); the **customer app order details** shows the "Changes while preparing your order" card. This is the ONLY in-app record for COD (no refund entry). |
| **Undo a picked line** | task line back to PENDING (`pickedQty` 0, `scanVerified`/override cleared); **no** order/refund change |
| **Complete** | order PICKING → PACKED (all-OOS orders are already CANCELED from §Q) |
| **All items OOS** (Issue 3) | order auto-**CANCELED** on the last OOS; `deliveryOtp` **null**; `price`/`actualOrderValue`/`charges.*` all **0**; pick task COMPLETED; **prepaid** wallet refunded incl. delivery+platform fees; **COD** no refund (`refunds[]` empty) |
| **Close a PACKED order** | succeeds (no "Failed to close"); status CLOSED; `invoiceNumber` (`INV-…`) set **post-commit**; customer "Delivered 🎉" push fires **once, after commit** |
| **Any failed/rolled-back status op** (close, assign, cancel) | order keeps its prior status **and** the customer gets **no** push — order-status pushes are queued on the txn session and flushed only after a successful commit (`order-event.utils.js`) |

---

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| Order never appears in Available | Store `pickingEnabled` off, order not OPEN, or wrong `storeId`; orders placed *before* picking was enabled need a backfill |
| Quantity stepper missing on a line | Picker **PR #4** not merged (partial-pick UI) |
| "Pick 3 of 5" returns **400** ("must be between 1 and the required quantity") | Backend **partial-pick PR** not deployed on dev (the `pick` endpoint still requires the full qty) |
| Undo button does nothing / 404 | Backend **PR #96** not deployed on dev (the reset endpoint) |
| OOS reason not shown in history | Backend `oosReason` (PR #95) not deployed on the running dev build |
| Item silently gone from an order, no record | Backend **partial-pick PR** not deployed — order-audit logging for OOS/short-pick ships with it |
| **"Failed to close"** on a packed order + customer still got "Delivered" | Pre-Issue-2 build: invoice number was written inside the close transaction (no session) → conflict; and the push fired from the DB hook before commit. Fixed — invoice gen + pushes now run **post-commit** (`order-event.utils.js`, `order.handler.js`). |
| All-OOS order **stuck in "Preparing"** with an OTP + a ₹2 (fees-only) bill | Pre-Issue-3 build: OOS'ing the last item left the order in PICKING (it only cancelled if the picker tapped Complete, and even then fees/OTP weren't cleared). Fixed — the order now auto-cancels on the last OOS (`cancelEmptiedOrder`). **Already-stuck orders** (e.g. HP70989050) need a one-off resolve: have the picker tap **Complete** (runs the backstop cancel) or cancel from Admin. |
| Scanner opens then closes immediately | Camera permission denied — grant it (Settings → app → Permissions) |
| "Wrong product scanned ✗" on the right item | The item's on-file barcode differs from the physical one — re-enroll via manual entry |
| Nothing in Products Without Scan | Everything was scan-verified (expected) — do an override pick (§I) to populate it |
