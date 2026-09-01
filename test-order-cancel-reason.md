# Test: Order cancellation reason (customer) + DELETE-bypass security fix

**Area:** User app → "Cancel order". Admin → order detail (reads the stored reason).
**Backend:** `packages/user/src/routes/order/router.js`, `.../order/validator.js`,
`.../order/controller.js`, `packages/shared/models/orders.schema.js`.
**Apps:** Android, Web, and iOS now send a reason. Old clients still work.
**Platform coverage:**
- ✅ **Android:** optional reason capture in bottom-sheet dialog (shipped on feat/cancel-reason branch)
- ✅ **iOS:** optional reason capture in `.sheet` (`CancelOrderReasonSheet.swift`)
- ✅ **Web:** optional reason capture in modal dialog (`CancelOrderDialog.tsx`)

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

## How much a customer cancel refunds  (real-money bug fix, 2026-09-01)

Same bug class as `test-order-status.md` §8, but on the **customer** cancel path
(`DELETE`/`POST /user/order/:orderId/cancel`). How much to refund now comes from the order's
`refundedAmount` field, not from searching old refund notes for a `(pay <id>)` marker.

Why it mattered: an admin **Reopen** claws the refund back out of the wallet and resets
`refundedAmount` to 0, but keeps the `refunds[]` history — so the old marker goes **stale**. The
customer's next cancel saw that stale marker, decided "already refunded" and credited **₹0** while
returning 200. Only reachable on **scheduled** orders, whose cancel window is slot start − 8h (a
normal order's 60-second window has usually closed long before a reopen).

Set-up for steps 2-4: a **scheduled** prepaid order 5 days out, ₹90 captured on Razorpay + ₹10 of
wallet coins = ₹100 of the customer's money.

1. **Straightforward first cancel** (control). Customer cancels it in the app:
   ✅ ₹100 credited to the wallet, `refundedAmount: 100`, one `refunds[]` entry, one refund push.
2. **Reopen, then cancel again** (the bug). Admin → **Reopen** that cancelled order (₹100 clawed
   back out of the wallet, `refundedAmount` → 0, the old `refunds[]` row kept as audit), then the
   customer cancels again from the app while the slot is still >8h away:
   ✅ ₹100 credited again, `refundedAmount: 100`, a **second** `refunds[]` entry.
   ❌ Must **not** return 200 with ₹0 credited — that was the live bug (the customer had paid ₹90
   at the gateway and spent ₹10 of coins, and got nothing back).
3. **No double refund.** Cancel an order that was genuinely already refunded (marker present **and**
   `refundedAmount: 100`, no reopen in between):
   ✅ 200, wallet untouched, no new `refunds[]` entry, `refundedAmount` stays 100.
4. **Sub-₹1 residue** (e.g. ₹0.50 of coins left owing): ✅ cancel succeeds (200), no wallet credit,
   no error — refunds are whole rupees only.
5. **COD order with no coins** → cancel: ✅ refund ₹0, wallet untouched, no push (unchanged).

Covered by automated tests in `packages/user/__tests__/scheduled-change-cancel.test.js`
("DELETE /user/order/:orderId — refund amount owed").

**Note on the `(pay <id>)` marker:** it stays in the refund note, but now means only "this refund
settled that gateway capture". It is stamped only when there really was a capture and no earlier
entry already claimed it. The Razorpay late-capture webhook
(`packages/user/src/routes/razorpay/controller.js`) still reads it as a **yes/no** skip-duplicate
guard on a single payment id — that use is correct and was left alone.

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

## How to test — Web manual QA

**Prerequisites:**
- Run haper-web against dev (`dapi.haper.in`), and have at least one test order in OPEN status
  (paid or COD, doesn't matter) that is still inside the 60-second free-cancel window when needed,
  plus one older OPEN order that is safely past that window.

**The feature on Web:** tapping "Cancel Order" opens `CancelOrderDialog` (a bottom sheet on
mobile widths, a centered modal on `md:`+) instead of the old one-tap confirm. It has the same 7
single-select reason rows as Android, an "Other" free-text field capped at 180 characters with a
live counter, and "Yes, Cancel" / "No" buttons.

### ✅ A. Cancel with no reason (backward-compatible)

1. Open an OPEN order, tap "Cancel Order."
2. Do not select any reason. Tap "Yes, Cancel."
   - ✅ **Expect:** 200, order CANCELED, no `cancellation` block sent (matches the old plain-confirm
     DELETE behavior — nothing regresses for a user who ignores the new reason picker).

### ✅ B. Cancel with each predefined reason

1. Repeat for each of the 6 non-"Other" reasons ("Ordered by mistake," "Changed my mind," "Found it
   cheaper elsewhere," "Delivery is taking too long," "Wrong item(s) or address added," "Don't need
   it anymore").
   - ✅ **Expect:** the row highlights on select (visually, via `border-primary-500`/background), and
     is exposed to assistive tech via `role="radio" aria-checked` inside a `role="radiogroup"`.
   - ✅ **Expect:** the "Other" text field never appears for these rows.
   - ✅ **Expect:** 200, admin shows the matching `cancellation.code`, `cancellation.text` = null.

### ✅ C. Cancel via "Other" with text

1. Select "Other," type `"The app kept crashing"`. Counter shows live count.
2. Tap "Yes, Cancel."
   - ✅ **Expect:** 200, admin shows `cancellation.code` = `OTHER`, `cancellation.text` = the typed
     string.

### ❌ D. Paste 181+ characters into "Other" (truncate, not reject)

1. Select "Other," paste 200+ characters.
   - ✅ **Expect:** the field truncates to 180 as you paste (component slices on every keystroke/paste
     event) — it does NOT reject the paste or clear the field. Counter caps at "180/180" and turns
     amber past 160.
2. Tap "Yes, Cancel" → 200, `cancellation.text` is exactly the first 180 characters.

### ✅ E. Selecting "Other," typing, then switching to a different reason clears stale text

1. Select "Other," type `"Very expensive"`.
2. Tap a different reason, e.g. "Delivery is taking too long."
   - ✅ **Expect:** the free-text field disappears, and the typed text is discarded from state (not
     just hidden) — re-selecting "Other" afterwards shows an empty field, not the old text.
3. Tap "Yes, Cancel" → admin shows `cancellation.code` = `DELIVERY_TOO_SLOW`, `cancellation.text` =
   null (the old "Other" text is never attached to a different code).

### ✅ F. 60-second-window-expired cancel now shows the server's real error (regression, was ❌)

**Before this fix:** any failed cancel — including a plain "window expired" 403 from the backend —
showed a generic "Could not cancel order. Please try again." toast. Since this dialog adds several
extra taps (reading 7 options, optionally typing free text) before submitting, users spend more of
the 60-second window in the UI, making an expired-window failure common rather than rare. A generic
message gave no way to tell an expired window (unrecoverable, stop retrying) from a transient
network blip (retry might work).

1. Place a fresh order, then deliberately wait past 60 seconds (for a non-scheduled order) before
   tapping "Cancel Order" and submitting (with or without a reason selected).
2. Tap "Yes, Cancel."
   - ✅ **Expect:** the toast now shows the backend's actual message, e.g. *"Cancellation window has
     expired. Orders can only be canceled within 1 minute of placement."* — not the generic fallback.
   - ✅ **Expect:** the same real-message behavior for any other actionable rejection, e.g. *"Order
     cannot be canceled in its current status."*
3. ✅ **Expect:** the dialog stays open after the failed submit, and any reason/free-text the user had
   selected/typed is preserved (not reset) so they can back out via "No" without losing input.

---

## How to test — iOS manual QA

**Prerequisites:**
- Build the iOS app from `dev` (`haper/Views/CancelOrderReasonSheet.swift`), run against dev
  (`dapi.haper.in`).
- Have at least 2 test orders ready on dev (Status OPEN, paid or COD — doesn't matter).

**The feature on iOS:** tapping "Cancel Order" presents `CancelOrderReasonSheet` (`.sheet` at
`.medium`/`.large` detents) instead of a plain confirm alert. Same 7 single-select reason rows as
Android/Web, an "Other" free-text field capped at 180 characters (counted in UTF-16 code units, to
match the backend's Joi `.max(180)` and Android's `String.take` — not Swift's default
grapheme-cluster count) with a live counter, and "Yes, Cancel" / "No" buttons in a pinned footer.

### ✅ A. Cancel with no reason (backward-compatible)

1. Open an OPEN order, tap "Cancel Order."
2. Do not select any reason. Tap "Yes, Cancel."
   - ✅ **Expect:** 200, order CANCELED, no `cancellation` block sent (matches the old DELETE
     behavior — nothing regresses for a user who ignores the reason picker).

### ✅ B. Cancel with each predefined reason

1. Repeat for each of the 6 non-"Other" reasons.
   - ✅ **Expect:** the row highlights on select, the "Other" field never appears for these rows.
   - ✅ **Expect:** 200, admin shows the matching `cancellation.code`, `cancellation.text` = null.

### ✅ C. Cancel via "Other" with text (including Hindi/emoji — UTF-16 fix)

1. Select "Other," type `"The app kept crashing"`. Tap "Yes, Cancel."
   - ✅ **Expect:** 200, admin shows `cancellation.code` = `OTHER`, `cancellation.text` = the typed
     string.
2. **Regression test for the UTF-16 truncation fix:** select "Other," type (or paste) roughly 150
   Devanagari/Hindi characters (e.g. repeat "नमस्ते ऐप बहुत धीमा है" until the counter reads close
   to 150), or a string with emoji.
   - ✅ **Expect:** the counter tracks `.utf16.count`, not grapheme count, and never lets the text
     exceed 180 UTF-16 units.
   - ✅ **Expect:** the text is **not silently over-truncated** well below the visible character
     count, and is **not rejected by the server with a 403** on submit — confirm the same string
     round-trips into `cancellation.text` in admin. Before the fix, Swift's default `.count`
     (grapheme clusters) could pass client-side while the UTF-16 length sent to the backend's Joi
     `.max(180)` was already over the limit, causing a hard 403 the user could not work around.

### ✅ D. Whitespace-only "Other" text (must behave like no text)

1. Select "Other," type only spaces/newlines (e.g. `"   "`). Tap "Yes, Cancel."
   - ✅ **Expect:** 200, order CANCELED, `cancellation.code` = `OTHER`, `cancellation.text` = null
     (trimmed client-side before send — matches Android's `trim().takeIf { isNotBlank() }` and the
     backend's own `.trim()`, instead of sending a whitespace string that resolves to `""` server-side).

### ❌ E. Failed cancel shows the error without scrolling (regression, was invisible)

1. Trigger a failed cancel (e.g. wait past the 60-second free-cancel window, or use an order in a
   non-cancelable state), optionally with a reason selected.
2. Tap "Yes, Cancel."
   - ✅ **Expect:** the sheet stays open, the spinner stops, and the inline error message is
     **immediately visible above the "Yes, Cancel" button** in the pinned footer — no scrolling
     required. Before this fix, the error rendered below the reason list inside the scrollable
     content and was invisible at the `.medium` detent unless the user manually scrolled down.
   - ✅ **Expect:** any reason/text already selected/typed is preserved (sheet does not reset).

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
2. **Android / iOS:** release the new build to testers / users. Old builds keep using DELETE (harmless fallback forever).

**Deployment order:** Deploy backend first, then roll out the Android app. The backend accepts both old and new requests, so there is no breaking change.

**Rollback:** If a rollback is needed, disable the Android build release. Existing old builds and new builds (if downloaded before rollback) will keep using the old DELETE endpoint, which keeps working unchanged on the backend.
