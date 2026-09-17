# Test: haper-credit — phone + OTP login, sessions and devices

**Area:** haper-credit Android + iOS + web (login screen, and every authenticated screen).
**Backend:** `haper-credit/apps/backend/src/auth`.
**Apps:** Android, iOS, Web.
**Needs:** `dev` backend. **DLT registration is NOT yet done**, so dev builds show the OTP on
screen instead of sending an SMS — see "Known limitations".

## What this covers

Signing in with nothing but a mobile number. No forms, no documents, no password. The first
login for a number **creates that shopkeeper's book**; every later login opens the same one.

---

## Manual test steps

### ✅ First login creates the book

1. Open the app. Enter a number that has never been used, in the form `+919876543210`.
2. Tap **Send OTP**.
   - **Expect:** the screen moves to the code step.
   - **Expect (dev only):** a "dev code: 123456" line appears. Use it.
3. Enter the 6-digit code → **Verify**.
   - **Expect:** you land on the home screen.
   - **Expect:** the book is empty — *You will get* ₹0.00, no customers.
   - **Expect:** you were never asked for a name, shop name, email or document.

### ✅ Logging in again returns the SAME book

1. Add a customer and an entry. Note the balance.
2. Log out (or reinstall) and log in with the **same number**.
   - **Expect:** the same customer and the same balance come back.
   - **Expect:** no duplicate book, no empty book.

### ✅ A different number gets a different book

1. Log in with a second, unused number.
   - **Expect:** an empty book — none of the first shopkeeper's customers are visible.
   - **This is the most important isolation check in the app.** If you can see another
     shopkeeper's customers, stop and report it immediately.

### ✅ Wrong code is refused

1. Request an OTP, then enter `000000`.
   - **Expect:** a clear message in your app language ("That code is not right. Try again.").
   - **Expect:** you stay on the code screen; you are NOT logged in.
   - **Expect:** the message is in plain language, never a technical error or English-only string
     when the app is in Hindi.

### ✅ Too many wrong tries burns the code

1. Request an OTP. Enter a wrong code **5 times**.
2. Now enter the **correct** code.
   - **Expect:** it is **rejected** — "Too many tries. Ask for a new code."
   - **Expect:** requesting a fresh OTP works normally.

### ✅ A code can only be used once

1. Request an OTP and log in successfully on device A.
2. On device B, try to log in using the **same** code.
   - **Expect:** rejected. Device B must request its own code.

### ✅ Two devices on one shop

1. Log in on Android and on web with the **same number**.
   - **Expect:** both work at the same time. Logging in on the second does **not** sign the first out.
   - **Expect:** both show the same customers and balances.
2. Add an entry on one.
   - **Expect:** it appears on the other (see `test-credit-offline-sync.md`).

### ✅ Signing out on one device does not affect the other

1. With two devices logged in, sign out of device A.
   - **Expect:** device A returns to the login screen.
   - **Expect:** device B **keeps working** — it can still add entries and sync.
2. On device A, log in again.
   - **Expect:** the book and balances are intact.

### ✅ Local entries survive a signed-out state

1. On a logged-in device, go offline and add two entries.
2. Sign out while still offline (if the UI allows), or let the session expire.
   - **Expect:** the app shows "Please sign in again. Your entries are safe."
   - **Expect:** the entries are **not** deleted.
3. Sign back in with the same number.
   - **Expect:** the queued entries sync up and appear on the other device.

### ✅ Phone number format

1. Try `9876543210` (no country code).
   - **Expect:** rejected with a clear message; no OTP is sent.
2. Try `+919876543210`.
   - **Expect:** accepted.

---

## Edge cases

### ✅ Request several OTPs in a row

1. Tap **Send OTP** three times for the same number.
   - **Expect:** the most recent code works.
   - **Expect:** no crash, no lockout of the number itself.

### ✅ Let the code expire

1. Request an OTP and wait **more than 5 minutes**, then enter it.
   - **Expect:** "That code has expired. Ask for a new one." — not a generic failure.

### ✅ Airplane mode at the login screen

1. Go offline and tap **Send OTP**.
   - **Expect:** a clear "no internet" message, not a spinner that hangs forever.
   - **Expect:** no crash.

### ✅ Long-running session

1. Stay logged in and use the app over several days (or have the backend shorten the token TTL on dev).
   - **Expect:** the app keeps working without asking you to log in again.
   - **Expect:** you are never shown a raw "401" or "token expired" string.

---

## Known limitations (not bugs)

- **No SMS is actually sent.** DLT (India's mandatory sender/template registration) is not
  complete, so dev builds display the code on screen. Until DLT clears, a real shopkeeper could
  not log in — this is the single biggest launch blocker and it is paperwork, not code.
- **No "change my number"** flow yet.
- **No staff / multi-user per shop** — one phone number is one shop, and anyone logging in with
  that number has full access.

## What this needs to ship

`dev` backend deploy. **Production launch is blocked on DLT registration**, which also requires
the public statement domain to be chosen and whitelisted (see `test-credit-statement-payments.md`).
