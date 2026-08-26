# Test: Order cancellation reason (customer) + DELETE-bypass security fix

**Area:** User app → "Cancel order". Admin → order detail (reads the stored reason).
**Backend:** `packages/user/src/routes/order/router.js`, `.../order/validator.js`,
`.../order/controller.js`, `packages/shared/models/orders.schema.js`.
**Apps:** Android now sends a reason (feat/cancel-reason branch). iOS / Web unchanged; old clients still work.
**Platform coverage:**
- ✅ **Android:** optional reason capture in bottom-sheet dialog (shipped on feat/cancel-reason branch)
- ⏸ **iOS:** no changes yet
- ⏸ **Web:** no changes yet

---

## What the feature does

When a customer cancels an order, they can optionally say **why**. The reason is stored on the
order in a new `cancellation` block so the team can count real reasons instead of guessing:

```
cancellation: { code, text, by, at }
```

- `code` — one value from a fixed list (e.g. `CHANGED_MY_MIND`, `FOUND_CHEAPER`,
  `DELIVERY_TOO_SLOW`, `NO_LONGER_NEEDED`, `WRONG_ITEMS_ADDRESS`, `OTHER`).
  The list lives in the validator — anything outside it is rejected.
- `text` — free text, **only** allowed when `code` is `OTHER`, max 180 characters.
- `by` — `"user"`, `at` — the time of cancel.

The old `reason` field ("Cancelled by user") is untouched — nothing that reads it changes.

### Two routes, one handler

| Route | Purpose | Can carry a reason? |
|---|---|---|
| `POST /user/order/:orderId/cancel` | new route, used by updated apps | **Yes** |
| `DELETE /user/order/:orderId` | legacy route, used by shipped apps | **No — ever** |

Both run the same `controller.cancel`, so cancel + refund + stock-restore + slot-release behave
identically. Only the reason capture differs.

---

## The security bug this fixes (found in code review)

**What was wrong:** the controller read the reason straight off `req.body`, no matter which route
called it. `express.json()` fills in `req.body` on a `DELETE` too, and the DELETE route only
validates the URL parameter — not the body. So anyone could send the *old* verb with a body and
skip the whole whitelist:

- `DELETE /user/order/<id>` with `{"reasonText": "Z" x 5000}` → **200**, and all 5000 characters
  were saved. The 180-char cap was pointless.
- `DELETE /user/order/<id>` with `{"reasonCode": "<img src=x onerror=alert(1)>ADMIN_FRAUD"}` →
  **200**, saved word for word. The fixed list was pointless.

Why that matters: unlimited-size text growing on the busiest collection we have (`orders`),
junk values polluting a field meant to be countable, and attacker-written HTML sitting in a record
the admin panel will later display.

**The fix (structural, not a filter):** the validator now hands the *already-checked* values to the
controller on `req.validatedCancel`, and the controller reads **only** that — never `req.body`.
Because only the new POST route runs that validator, the DELETE route always arrives with nothing
set, so both values are null and the `cancellation` block is simply not written. There is no body a
client can send to DELETE that changes this. Sanitizing was deliberately not chosen — the route
simply has no path to the field any more.

**Two smaller fixes in the same pass:**

- The audit-log failure handler used `auditErr.message`. If something that isn't a real Error got
  thrown, reading `.message` threw *again*, escaped to the outer handler, and that handler tried to
  roll back a transaction that was already committed — so a **successful** cancel and refund could
  be reported to the customer as a 500. Now it falls back to the raw value.
- The 180-character limit was measured *before* trimming, but the controller trimmed afterwards. So
  exactly 180 characters plus a trailing space or newline (very easy to produce on a phone keyboard)
  was rejected for no visible reason. The validator now trims first, like the controller does.

---

## How to test — Backend

Automated: `cd packages/user && NODE_ENV=test npx jest order-cancel-reason.test.js`
(in-memory Mongo, 14 tests). Regression: `... npx jest order.test.js` must stay 59/59.

Manual (dev, `dapi.haper.in`) — place a test order, keep it in OPEN, then:

### ✅ Should pass

1. **Old app still works.** `DELETE /user/order/<id>` with no body → 200, order CANCELED,
   `reason` = "Cancelled by user", no `cancellation.code`. Refund lands in the wallet as before.
2. **New app, no reason picked.** `POST /user/order/<id>/cancel` with `{}` → identical to step 1.
3. **A normal reason.** `POST .../cancel` with `{"reasonCode":"CHANGED_MY_MIND"}` → 200,
   `cancellation.code` = `CHANGED_MY_MIND`, `cancellation.text` = null, `by` = `user`.
4. **"Other" with text.** `{"reasonCode":"OTHER","reasonText":"the app kept crashing"}` → 200, both
   saved.
5. **"Other" with nothing typed.** `{"reasonCode":"OTHER"}` → 200. An empty box must never block a
   cancel.
6. **Exactly 180 characters plus a newline** on `OTHER` → 200, saved trimmed to 180 (the L1 fix).
7. **Scheduled order + reason** → 200 and the delivery slot is freed (capacity `orderIds` empty).
8. **Refund parity** — cancel two identical paid orders, one via DELETE and one via POST with a
   reason. `refundedAmount` and the refund entry must match exactly. A reason must never move money.

### ❌ Should fail (403, and the order must stay OPEN — check it afterwards)

9. `{"reasonCode":"NOT_REAL"}` → 403, order untouched.
10. `{"reasonCode":"OTHER","reasonText":"x" x 181}` → 403, order untouched.
11. `{"reasonCode":"CHANGED_MY_MIND","reasonText":"x"}` → 403. Free text is `OTHER`-only.

### 🔒 The bypass probe (the actual bug — re-run this one)

12. `DELETE /user/order/<id>` with body `{"reasonCode":"OTHER","reasonText":"Z" x 5000}`
    → **200** (the cancel itself is legitimate and must still succeed), and then read the order
    back: `cancellation.code` and `cancellation.text` must both be **null**. Before the fix this
    saved all 5000 characters.
13. `DELETE /user/order/<id>` with `{"reasonCode":"<img src=x onerror=alert(1)>ADMIN_FRAUD"}`
    → **200**, and `cancellation.code` must be **null**. Nothing from the body is stored.

Both are covered by automated tests in `order-cancel-reason.test.js`.

---

## Edge cases / notes

- **Old clients:** nothing to release. A shipped app that calls DELETE keeps cancelling exactly as
  before; it just never records a reason.
- **Android:** `cancellation` is a new nullable block. Old orders have no `cancellation` at all, so
  any client reading it must handle a missing key (Gson gives null, not a default).
- **Audit log:** every cancel writes an `order.cancel` audit entry with `source: "user_app"` and
  the reason in `metadata`. If that write fails, the cancel still returns 200 — it is best-effort by
  design and must never fail a customer's refund.
- **Delivery app's `reasonCode`** (`packages/delivery/.../order/controller.js`) is a *different*
  field for delivery-partner rejections, with its own whitelist. Unrelated, untouched.

---

## How to test — Android manual QA

**Prerequisites:**
- Build the Android app from branch `feat/cancel-reason` (`./gradlew assembleDebug`).
- Have at least 2 test orders ready on dev (Status OPEN, paid or COD — doesn't matter).
- Know a valid referral code or reason code to test with (examples: `CHANGED_MY_MIND`, `FOUND_CHEAPER`, etc.; full list in backend validator).

**The feature on Android:** when a user taps the cancel button on an order, they see a new bottom sheet instead of a plain "Are you sure?" dialog. The sheet has:
- Title "Cancel Order?" + same cancel-reason subtitle as before
- Caption "Help us improve — why are you cancelling? (optional)"
- 7 single-select reason buttons: **Ordered by mistake**, **Changed my mind**, **Found it cheaper elsewhere**, **Delivery is taking too long**, **Wrong item(s) or address added**, **Don't need it anymore**, **Other**
- Selecting "Other" reveals a free-text field (180-char limit with live counter; typing past 180 truncates)
- "Yes, Cancel" (always enabled) and "No" buttons at the bottom
- Two entry points: the 60-second free-cancel button AND the scheduled-order cancel button

---

### ✅ A. Cancel with no reason (backward-compatible, no reason selected)

1. **Open an OPEN order** on the Android app (dev).
2. **Tap the "Cancel Order" button** (the red/orange cancel button, or the menu option for a scheduled order).
   - ✅ **Expect:** the new bottom sheet appears with "Cancel Order?" title and the 7 reason options.
3. **Do not select any reason.** Tap **"Yes, Cancel"** immediately.
   - ✅ **Expect:** the order cancels (status OPEN → CANCELED).
   - ✅ **Expect:** the order's `cancellation` block is NOT set (not sent to backend; reason is omitted).
   - ✅ **Expect:** the refund is processed as before.
4. **Verify in admin:** order detail shows no `cancellation` data. The `reason` field still says "Cancelled by user" (unchanged).

### ✅ B. Cancel with a predefined reason (each single-select option)

1. **Open another OPEN order.**
2. **Tap the "Cancel Order" button.**
3. **Select one of the 7 predefined reasons:**
   - Tap **"Ordered by mistake"** (or any of the other 6).
   - ✅ **Expect:** the button is visually selected (e.g., highlighted, checkmark, or color change).
   - ✅ **Expect:** **the "Other" free-text field does NOT appear** when a non-"Other" reason is selected.
4. **Tap "Yes, Cancel."**
   - ✅ **Expect:** 200 response, order CANCELED.
   - ✅ **Expect:** admin shows `cancellation.code` = `CHANGED_MY_MIND` (or whichever reason was tapped).
   - ✅ **Expect:** `cancellation.text` = null (no free text).

**Repeat for all 7 reasons** (test at least 3 to ensure the list is wired correctly):
- Ordered by mistake → `CHANGED_MY_MIND` (verify the enum mapping in the code)
- Changed my mind → `CHANGED_MY_MIND`
- Found it cheaper elsewhere → `FOUND_CHEAPER`
- Delivery is taking too long → `DELIVERY_TOO_SLOW`
- Wrong item(s) or address added → `WRONG_ITEMS_ADDRESS`
- Don't need it anymore → `NO_LONGER_NEEDED`
- Other → `OTHER` (and then test the free-text field, see section C below)

### ✅ C. Cancel via "Other" with free text (180-char limit)

1. **Open an OPEN order.**
2. **Tap the "Cancel Order" button.**
3. **Select "Other".**
   - ✅ **Expect:** a free-text field appears below the reason list (or inline with "Other").
   - ✅ **Expect:** the field is initially empty and focused (or the keyboard opens).
4. **Type a short reason:** `"The app kept crashing when I tried to checkout"`
   - ✅ **Expect:** text appears in the field, a live character counter shows (e.g., "45 / 180").
5. **Tap "Yes, Cancel."**
   - ✅ **Expect:** 200 response, order CANCELED.
   - ✅ **Expect:** admin shows `cancellation.code` = `OTHER`, `cancellation.text` = `"The app kept crashing when I tried to checkout"`, `by` = `"user"`.

### ✅ D. Cancel via "Other" with empty text (optional text, must not block)

1. **Open an OPEN order.**
2. **Tap the "Cancel Order" button.**
3. **Select "Other."**
   - The free-text field appears.
4. **Leave the field empty.** Tap "Yes, Cancel."
   - ✅ **Expect:** 200 response, order CANCELED (blank text is valid; not an error).
   - ✅ **Expect:** admin shows `cancellation.code` = `OTHER`, `cancellation.text` = null or empty string (backend trims it).

### ✅ E. Exactly 180 characters in "Other" text (boundary condition)

1. **Open an OPEN order.**
2. **Tap the "Cancel Order" button.**
3. **Select "Other."**
4. **Type (or paste) exactly 180 characters.**
   - Use: `"A"` repeated 180 times, or a real reason with spaces up to 180 chars.
   - ✅ **Expect:** the counter shows "180 / 180". The field does NOT reject the input.
5. **Tap "Yes, Cancel."**
   - ✅ **Expect:** 200 response, order CANCELED.
   - ✅ **Expect:** admin shows `cancellation.text` = exactly 180 characters (no truncation; exactly at the limit is fine).

### ❌ F. Paste 181+ characters into "Other" field (truncation, not rejection)

**Regression test:** in the original bug, pasting more than 180 characters into the field would DROP THE ENTIRE EDIT (return an error or silently fail). This is now fixed to **truncate instead**.

1. **Open an OPEN order.**
2. **Tap the "Cancel Order" button.**
3. **Select "Other."**
4. **Paste (or type) a long string:** `"AAAAA...AAAAA"` (200+ 'A's).
   - ✅ **Expect:** the field **truncates to 180 characters** as you type/paste. The counter caps at "180 / 180".
   - ✅ **Expect:** the field does NOT show an error, does NOT reject the input entirely, and does NOT leave the field blank.
   - ✅ **Expect:** the field shows the first 180 characters of what you pasted.
5. **Tap "Yes, Cancel."**
   - ✅ **Expect:** 200 response, order CANCELED.
   - ✅ **Expect:** admin shows `cancellation.text` = first 180 chars of your paste (truncated, not dropped).

### ❌ G. Small screen or keyboard open: buttons must stay tappable (visibility regression)

**Regression test:** when the on-screen keyboard is open (while typing in the "Other" field), the "Yes, Cancel" and "No" buttons at the bottom must remain visible and tappable. In the original bug, the buttons would scroll off-screen and become unreachable.

1. **Open an OPEN order on a small device or emulator** (e.g., 360x640dp Pixel 3a emulation, or a real small phone).
2. **Tap the "Cancel Order" button.**
3. **Select "Other" to show the free-text field.**
4. **Tap the text field to open the on-screen keyboard.**
   - Type a few characters: `"The app"`
   - ✅ **Expect:** the keyboard opens. The bottom sheet should **scroll or resize** to keep the "Yes, Cancel" / "No" buttons visible at the bottom (NOT hidden behind the keyboard).
   - ✅ **Expect:** you can see the button footer and tap "Yes, Cancel" without dismissing the keyboard or scrolling down.
5. **Tap "Yes, Cancel" while the keyboard is open.**
   - ✅ **Expect:** 200 response, order CANCELED (the button was tappable).

### ❌ H. Rotate device while "Other" is selected with partial text

**Regression test:** rotating the device (portrait ↔ landscape) while the sheet is open with partial text in the "Other" field must NOT close the sheet or lose the text.

1. **Open an OPEN order.**
2. **Tap the "Cancel Order" button.**
3. **Select "Other."**
4. **Type a partial reason:** `"Found a cheaper deal"` (20 chars).
5. **Rotate the device** to landscape (or portrait if you started in landscape).
   - ✅ **Expect:** the sheet is **still open** (does not dismiss).
   - ✅ **Expect:** the text "Found a cheaper deal" is **still in the field** (not cleared).
   - ✅ **Expect:** the counter still shows "20 / 180".
6. **Tap "Yes, Cancel."**
   - ✅ **Expect:** 200 response, order CANCELED.
   - ✅ **Expect:** admin shows the correct text (the text was not lost during rotation).

### ❌ I. Select "Other", type text, then switch to a different reason (stale text must clear)

**Regression test:** selecting "Other" and typing some text, then tapping a different predefined reason (e.g., "Changed my mind"), must clear the stale free-text. The new reason should be sent alone; the old "Other" text must not be attached to it.

1. **Open an OPEN order.**
2. **Tap the "Cancel Order" button.**
3. **Select "Other."**
4. **Type some text:** `"Very expensive"`
   - ✅ **Expect:** the counter shows "14 / 180", the text is in the field.
5. **Tap a different reason:** "Delivery is taking too long."
   - ✅ **Expect:** the free-text field **disappears** (because we're no longer in "Other" mode).
   - ✅ **Expect:** the previously typed text is **cleared / discarded** (not stored in memory).
   - ✅ **Expect:** the new reason is now visually selected (highlighted).
6. **Tap "Yes, Cancel."**
   - ✅ **Expect:** 200 response, order CANCELED.
   - ✅ **Expect:** admin shows `cancellation.code` = `DELIVERY_TOO_SLOW`, `cancellation.text` = null (the old "Very expensive" text is NOT attached).

### ✅ J. Two entry points work (60-second free-cancel AND scheduled order cancel)

**Test that both the immediate-cancel button and the scheduled-order cancel path use the same sheet:**

**Entry point 1: 60-second free-cancel button (on a just-placed order)**
1. Place an order and immediately (within 60 seconds, while it's still in OPEN state).
2. **Tap the red "Cancel for Free" button** (or the quick-cancel button on the order card).
3. ✅ **Expect:** the new reason-capture bottom sheet appears (not the old plain dialog).

**Entry point 2: Scheduled order cancel**
1. Place a scheduled order (future delivery slot).
2. Tap the cancel/menu button for that order.
3. **Tap "Cancel Order."**
4. ✅ **Expect:** the same reason-capture bottom sheet appears.

---

## System behavior (not changed by this feature)

- **Razorpay-payment-failure auto-cancel:** when the payment gateway fails and the system auto-cancels the order, this is a **system rollback, not a customer choice**. No reason sheet appears, and no reason is sent. The order cancels silently with `reason: "Cancelled by payment failure"` and no `cancellation` block.

---

## Old client behavior (backward-compatible)

**Old Android builds** (before feat/cancel-reason) continue to work:
- When the user taps "Cancel Order," they see the old plain dialog ("Are you sure?").
- They send a DELETE request (the old endpoint) with no reason.
- The backend accepts it (the DELETE route is still active) and stores no `cancellation` data.
- No regression.

---

## Deploy

**Both require deployment for end-to-end function:**

1. **Backend:** deploy `packages/user` to dapi.haper.in (dev). This activates the new `POST /user/order/:orderId/cancel` route and the reason validator. Older builds calling DELETE will continue to work.
2. **Android:** release the new build (feat/cancel-reason branch) to testers / users. Old builds keep using DELETE (harmless fallback forever).

**Deployment order:** Deploy backend first, then roll out the Android app. The backend accepts both old and new requests, so there is no breaking change.

**Rollback:** If a rollback is needed, disable the Android build release. Existing old builds and new builds (if downloaded before rollback) will keep using the old DELETE endpoint, which keeps working unchanged on the backend.
