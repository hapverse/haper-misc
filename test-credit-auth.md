# Test: haper-credit — phone + OTP login, sessions and devices

**Area:** haper-credit Android + iOS + web (login screen, and every authenticated screen).
**Backend:** `haper-credit/apps/backend/src/auth`.
**Apps:** Android, iOS, Web.
**Needs:** `dev` backend with the SMS gateway configured. **DLT is done** — haper-credit reuses
the Haper fleet's existing registration (sender `iHaper`, same entity and OTP template), so a real
SMS is sent. If the gateway is not configured on that environment, the OTP appears on screen
instead; that fallback never runs in production.

## What this covers

Signing in with nothing but a mobile number. No forms, no documents, no password. The first
login for a number **creates that shopkeeper's book**; every later login opens the same one.

---

## Manual test steps

### ✅ First login creates the book

1. Open the app. Enter a number that has never been used, in the form `+919876543210`.
2. Tap **Send OTP**.
   - **Expect:** the screen moves to the code step.
   - **Expect:** a real SMS arrives from sender **iHaper** within a few seconds.
   - **Expect:** the text reads "Your OTP for logging into your **HAPER** account is …". It says
     HAPER, not Haper Credit, because it reuses the fleet's registered DLT template — see
     "Known limitations".
   - **If the gateway is unconfigured on this environment:** a "dev code: …" line appears on
     screen instead. Use that.
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

### ✅ Request several OTPs in a row — the throttle

Every SMS is billed, so the request endpoint is throttled. Limits match the rest of the fleet.

1. Request an OTP, then immediately tap **Send OTP** again.
   - **Expect:** refused, with a message asking you to wait (about 2 minutes).
   - **Expect:** no second SMS arrives.
2. Wait 2 minutes and request again.
   - **Expect:** a new SMS arrives and the newest code works.
3. Request a third time within the same 15 minutes.
   - **Expect:** refused until the window passes.
4. On a **different** number, request an OTP immediately.
   - **Expect:** it works. The throttle is per number, never global — one shopkeeper must not
     be able to lock out another.

**Known UX cost:** a shopkeeper signing in on a second device within 2 minutes of the first is
asked to wait. That is deliberate (each SMS costs money) but it is a real tradeoff, and worth
raising if testers find it painful in practice.

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

- **The SMS says "HAPER account", not "Haper Credit".** DLT only delivers a message whose text
  matches the registered template exactly, and haper-credit reuses the fleet's existing OTP
  template rather than waiting days for its own. Rewording it needs a **new template
  registration**, not a code change. Raise it if the wording confuses shopkeepers.
- **No "change my number"** flow yet.
- **No staff / multi-user per shop** — one phone number is one shop, and anyone logging in with
  that number has full access.

## What this needs to ship

`dev` backend deploy with the SMS gateway env set (same API key as haper-backend; sender, entity
and template ids are in `.env.example`). **No new DLT registration needed** — the fleet's existing
one is reused.

Note the statement link does **not** need DLT clearance in v1: reminders are sent by the
shopkeeper from their own phone via WhatsApp or their SMS app, which is person-to-person, not
bulk A2P messaging. A domain whitelist and a new template are only needed if server-sent
reminders ship in v1.1.
