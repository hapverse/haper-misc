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
   - **undo (reset) + partial-pick endpoints** — haper-backend **PR #96** (merged; the dev
     box must be **deployed** for §J / §L to work). If a step below "does nothing", the dev
     box is a build behind.
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

### J. Partial pick (short stock)  (feat: partial pick — needs picker PR #4 + backend PR #96 deployed)
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
5. ❌ Try to step **above** required → the **+** is disabled (and the server rejects >
   required). Quantity **0** isn't possible (min 1 — use Out of stock instead).

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
4. ✅ Admin side: order status is **PACKED** (or **CANCELED** if every line went OOS).

### N. Products Without Scan report  (feat: #6)
1. From the task-list top bar, tap the **audit icon** (Products without scan).
2. ✅ It lists every line you **picked via override / without a scan** across your **active
   + completed** pickings, each with the order id, qty, and an **Active / Completed** chip.
3. ✅ If everything was scan-verified, it shows "Every product was scan-verified…".

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
| **Partial pick** (prepaid) | wallet credited the shortfall; order line qty reduced; `refundedAmount`/`hasPartialRefund` set; item stock = 0 |
| **Partial pick** (COD) | order total reduced; no wallet credit; item stock = 0 |
| **Out of stock** (prepaid) | item removed from order; wallet refunded full line; item stock = 0; line `oosReason` set |
| **Undo a picked line** | task line back to PENDING (`pickedQty` 0, `scanVerified`/override cleared); **no** order/refund change |
| **Complete** | order PICKING → PACKED (or CANCELED if all OOS) |

---

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| Order never appears in Available | Store `pickingEnabled` off, order not OPEN, or wrong `storeId`; orders placed *before* picking was enabled need a backfill |
| Quantity stepper missing on a line | Picker **PR #4** not merged (partial-pick UI) |
| Undo button does nothing / 404 | Backend **PR #96** not deployed on dev (the reset endpoint) |
| OOS reason not shown in history | Backend `oosReason` (PR #95) not deployed on the running dev build |
| Scanner opens then closes immediately | Camera permission denied — grant it (Settings → app → Permissions) |
| "Wrong product scanned ✗" on the right item | The item's on-file barcode differs from the physical one — re-enroll via manual entry |
| Nothing in Products Without Scan | Everything was scan-verified (expected) — do an override pick (§I) to populate it |
